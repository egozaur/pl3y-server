// Bulgot: reguły runu. Czyste funkcje na zwykłym obiekcie `run` (JSON), bez dostępu do pamięci i sieci.
// Wszystkie losowania biorą ziarno z run.seed, więc ten sam run daje te same oferty i spotkania.
// Każda funkcja zwraca { ok: true, ... } albo { err, code }. Stan zapisuje i autoryzuje BgPlayer (player.js).
import { mix, hash, makeRng } from './rng.js';
import { SKILLS, TILES, RECIPES, BADGES, BADGE_OFFER, BADGE_POOL, AFFIXES, MODES, CHARS, TILE_BY_ID, ENEMIES, BOSSES, RULES, FLOOR_TPL, garnekRamp, RARITY_WEIGHTS, TYPE_WEIGHTS, DECREES, FLAWS, NEMESIS_TITLES, NEMESIS_NAMES, garnekMods, formFor, BOSS_POOL, SUPER_BOSSES, EXTRA_AT, EXTRA_DOG, ROUTES, CURSES, CURSE_MAX, cursePct, COMPANIONS, COMPANION_OFFER, KURNIK, KURNIK_MAX } from './data.js';
import { heroStats, setCounts, elemCounts } from './stats.js';
import { COUNTERS, COUNTER_OF, COUNTER_K, COUNTER_SLOT_K, ARCHETYPES } from './data.js';
import { runFight } from './sim.js';

const fl = Math.floor;
const fail = (err, code) => ({ err, code });

export const loadoutOf = run => ({
  char: run.char, tiles: run.tiles, skills: run.skills, coins: run.coins,
  bonusAtk: run.flags.bonusAtk, noRegen: garnekMods(run.garnek).noRegen, badges: run.badges || [],
  grow: run.grow || {}, flawed: run.flawed || [], decree: decreeOf(run), floors: run.done || 0, seed: run.seed,
  companion: run.companion || null, kurnik: run.kurnik || {}, curses: run.curses || [],
});

// ---------- Okólniki Zarządu ----------
// Okólnik jest JEDEN na cały run: losowany z ziarna na starcie (klient pokazuje losowanie) i nie zmienia się do końca.
// `decrees` zostaje tablicą (zapis runu, testy), ale liczy się tylko element [0].
export function decreesOf(seed) {
  const rr = makeRng(mix(seed, hash('decree')));
  return [rr.pick(Object.keys(DECREES))];
}
// run.decrees zapisuje się przy starcie runu (starsze runy liczą je z ziarna); null = brak okólnika.
export const decreeOf = run => (run.decrees || (run.seed === undefined ? [] : decreesOf(run.seed)))[0] || null;
const decreeIs = (run, id) => decreeOf(run) === id;
export const statsOf = run => heroStats(loadoutOf(run));

// ---------- Klątwy, Kurnik, bossowie z puli, trasy ----------
const hasCurse = (run, id) => (run.curses || []).includes(id);
export const maxSkillsOf = run => Math.min(RULES.maxSkills, (CHARS[run.char] || {}).skillSlots || RULES.maxSkills) - (hasCurse(run, 'ciasne-gniazdo') ? 1 : 0);   // Gigachad Bez Nóg ma 1 slot
const kLv = (run, id) => (run.kurnik && run.kurnik[id]) | 0;
// Boss tego piętra: wariant z puli miejsca (losowany z ziarna, oryginał ma wagę 2) albo super-boss Dogrywki (co RULES.superEvery pięter po limicie trybu).
export function bossFor(mode, seed, round) {
  const M = MODES[mode], slot = M.bosses[round];
  if (slot) { const pool = BOSS_POOL[slot]; return pool ? pool[makeRng(mix(seed, hash('bossvar'), hash(slot))).weighted(pool.map((_, i) => i === 0 ? 2 : 1))] : slot; }
  if (round > M.rounds && (round - M.rounds) % RULES.superEvery === 0) return SUPER_BOSSES[((round - M.rounds) / RULES.superEvery - 1) % SUPER_BOSSES.length];
  return null;
}
export const bossAt = (run, round = run.round) => bossFor(run.mode, run.seed, round);
const bossSlotOf = id => id && BOSSES[id] ? (BOSSES[id].slot || id) : id;
export const routeOf = run => { const r = run.routes && run.routes[zoneOf(run.mode, run.round)]; return r && ROUTES[r] ? ROUTES[r] : null; };
// Czy na początku tego piętra wybiera się trasę: pierwsze piętro strefy II i III (nie boss, nie Dogrywka).
const needsRoute = run => run.round > 1 && run.round <= MODES[run.mode].rounds && run.round === zoneStart(run.mode, run.round) && !bossAt(run) && !(run.routes && run.routes[zoneOf(run.mode, run.round)]);
export function routeOptions(run) {
  const rr = makeRng(mix(run.seed, run.round, hash('route'))), keys = Object.keys(ROUTES), out = [];
  while (out.length < 2) { const k = rr.pick(keys); if (!out.includes(k)) out.push(k); }
  return out;
}
export const compLevel = run => Math.min(3, 1 + ((run.kurnik && run.kurnik.pisklecarnia) >= 3 ? 1 : 0) + (run.bossWins | 0));

// Notatki bieżącej rundy (do historii gier): co zaoferowano, co wybrano, co dokupiono, ile rerolli.
const freshCur = run => ({ offer: run.offer.slice(), picked: null, rerolls: 0, bought: [], event: null });
const cur = run => run.cur || (run.cur = freshCur(run));

// ---------- Nowy run ----------
// Wersja reguł runu. Run zapisany w innej wersji serwer unieważnia (inne spotkania = niezgodna powtórka walki).
export const RUN_V = 21;

export function newRun({ mode, char, garnek, pool, seed, now = 0, nemesis = null, will = null, curses = [], kurnik = {} }) {
  const M = MODES[mode], ch = CHARS[char];
  if (!M) return fail('Nieznany tryb.', 'mode');
  if (!ch) return fail('Nieznana postać.', 'char');
  if (!Array.isArray(curses) || curses.length > CURSE_MAX || new Set(curses).size !== curses.length || curses.some(c => !CURSES[c])) return fail('Nieprawidłowe Klątwy Prezesa.', 'curses');
  const run = {
    v: RUN_V, id: String(seed), mode, char, garnek: garnek | 0, seed: seed >>> 0, round: 1, phase: 'offer',
    hp: 1, coins: ch.coins, tiles: [], skills: ch.startSkills.map(([id, lvl]) => ({ id, lvl })), offer: [], rerolls: 0, paid: 0, freeLeft: ch.freeRerolls,
    pending: null, rested: false, pool: pool.slice(), badges: [], started: now, ended: null, score: 0, timeBonus: 0, done: 0,
    flags: { bonusAtk: 0, bossHpBonus: 0, revived: false },
    stats: { riskPicks: 0, fox: 0, maxCoins: ch.coins, maxHit: 0, lowWin: false, maxRound: 1, bossKills: [], picks: 0, rerolls: 0, v2: 1, syn: false, rests: 0, skillUses: 0, flawless: 0, bossFlawless: false, maxChainsFight: 0, longWin: 0 },
    log: [],
    curses: curses.slice(), kurnik: Object.fromEntries(Object.keys(KURNIK).filter(k => (kurnik[k] | 0) > 0).map(k => [k, Math.min(KURNIK_MAX, kurnik[k] | 0)])), routes: [null, null, null], companion: null, bossWins: 0, arena: null, endless: false, cleared: null,
    grow: {}, flawed: [], flawAt: -1, pawned: null, foxDebt: 0, door: null, nemesis: null, will: null, willUsed: false,
  };
  run.decrees = decreesOf(run.seed);
  run.coins += kLv(run, 'spizarnia');   // Kurnik: Spiżarnia
  if (kLv(run, 'pisklecarnia') === 1) { const ks = Object.keys(COMPANIONS); run.companion = { id: makeRng(mix(run.seed, hash('startcomp'))).pick(ks), lvl: compLevel(run) }; }   // Kurnik: Pisklęcarnia
  if (ch.startTiles) run.tiles = ch.startTiles.slice();   // Dinozaur zaczyna z Jajkiem, Rzeźnik z Ostrogami, Wanda z Tykającym Jajem
  if (ch.startCompanion && !run.companion) { const ks = Object.keys(COMPANIONS); run.companion = { id: makeRng(mix(run.seed, hash('startcomp'))).pick(ks), lvl: compLevel(run) }; }   // Kurczak Pacyfista: towarzysz od początku
  if (ch.randomSkill) {   // Kurczak Mutant (1) i Skibidi (2): losowe umiejętności na start, bez powtórzeń
    const rr = makeRng(mix(run.seed, hash('mutskill'))), keys = Object.keys(SKILLS); run.skills = [];
    while (run.skills.length < Math.min(ch.randomSkill === true ? 1 : ch.randomSkill, maxSkillsOf(run), keys.length)) { const id = rr.pick(keys); if (!run.skills.some(s => s.id === id)) run.skills.push({ id, lvl: 1 }); }
  }
  if (nemesis && ENEMIES[nemesis.enemy]) run.nemesis = { ...nemesis, round: nemesisRound(run, nemesis), beaten: false };
  if (will && TILE_BY_ID[will]) run.will = will;
  run.stats.maxCoins = Math.max(run.stats.maxCoins, run.coins);
  run.hp = statsOf(run).maxHp;
  setOffer(run, 0);
  run.freeLeft = freeRerolls(run) + kLv(run, 'kantyna');
  run.cur = freshCur(run);
  if (kLv(run, 'pisklecarnia') >= 2) {   // Kurnik: Pisklęcarnia 2+: towarzysza wybierasz z 3 losowych jeszcze przed pierwszą ofertą
    const rr = makeRng(mix(run.seed, hash('startadopt'))), keys = Object.keys(COMPANIONS), opts = [];
    while (opts.length < Math.min(keys.length, COMPANION_OFFER)) { const k = rr.pick(keys); if (!opts.includes(k)) opts.push(k); }
    run.pending = { kind: 'adopt', opts, start: true }; run.phase = 'event';
  }
  return { ok: true, run };
}

// ---------- Oferta kafelków ----------
function tileAvailable(run, t) {
  if (t.hatched || t.boss) return false;
  if (t.minRound && run.round < t.minRound) return false;   // np. Arena Duchów dopiero od 3. piętra
  if (t.event === 'arena' && (bossAt(run) || isElite(run) || isNemesisRound(run) || riskyDoor(run))) return false;
  if (t.legend && (run.round - 1) / MODES[run.mode].rounds < 0.6) return false;   // legendarne przedmioty dopiero od 60% runu (strefa III w trybie pełnym)   // wyklute i legendarne z bossów nie trafiają do ofert
  if (t.dino && run.tiles.includes('dinozaur')) return false;   // Jajko Dinozaura tylko raz na run: po wyklutym Dinozaurze nie wraca do ofert
  if (t.repeat) return true;
  if (RECIPES.some(r => r.of.includes(t.id) && run.tiles.includes(r.out))) return false;   // składnik już wyklutego przedmiotu
  if (t.type === 'skill') {
    const s = run.skills.find(x => x.id === t.skill);
    if (!s && maxSkillsOf(run) === 1 && run.skills.length >= 1) return false;   // postać z 1 slotem nie dostaje cudzych umiejętności (byłyby martwe), tylko kopie własnej
    return !s || s.lvl < RULES.maxSkillLvl;
  }
  return !run.tiles.includes(t.id);
}

export function makeOffer(run, salt, opt = {}) {
  const size = opt.size || RULES.offerSize, minR = opt.minRarity || 0;
  const rr = makeRng(mix(run.seed, run.round, salt));
  const S = statsOf(run), M = MODES[run.mode], ch = CHARS[run.char];
  const prog = (run.round - 1) / M.rounds;
  const w = RARITY_WEIGHTS[prog < 0.3 ? 0 : prog < 0.6 ? 1 : 2].slice();
  const L = Math.max(0, S.luck + (routeOf(run) ? routeOf(run).luck || 0 : 0));
  w[0] = Math.max(10, w[0] - L); w[1] += fl(L / 2); w[2] += fl(L / 3); w[3] += fl(L / 6);
  const cands = run.pool.map(id => TILE_BY_ID[id]).filter(t => t && tileAvailable(run, t) && (!opt.noEvents || !t.event));
  const out = [], tc = {};
  for (let i = 0; i < size; i++) {
    let rem = cands.filter(t => !out.includes(t.id) && t.rarity >= minR && (size < 4 || (tc[t.type] || 0) < 3));
    if (!rem.length) rem = cands.filter(t => !out.includes(t.id) && t.rarity >= minR);
    if (!rem.length) rem = cands.filter(t => !out.includes(t.id));
    if (!rem.length) break;
    let rw = [0, 1, 2, 3].map(r => rem.some(t => t.rarity === r) ? w[r] : 0);
    if (!rw.some(x => x > 0)) rw = [0, 1, 2, 3].map(r => rem.some(t => t.rarity === r) ? 1 : 0);
    const ri = rr.weighted(rw), ofR = rem.filter(t => t.rarity === ri);
    const types = [...new Set(ofR.map(t => t.type))];
    const ti = rr.weighted(types.map(ty => TYPE_WEIGHTS[ty] * (ty === 'risk' ? ch.riskWeight : 1)));
    const pick = rr.pick(ofR.filter(t => t.type === types[ti]));
    out.push(pick.id); tc[pick.type] = (tc[pick.type] || 0) + 1;
  }
  // Postać z 1 slotem: kopia jej jedynej umiejętności (poziom 2, Mutacja) wpada w RULES.soloCopyPct% ofert w miejsce ostatniego kafelka niebędącego umiejętnością.
  if (maxSkillsOf(run) === 1 && run.skills.length === 1 && run.skills[0].lvl < RULES.maxSkillLvl && rr.int(100) < RULES.soloCopyPct) {
    const own = cands.find(t => t.type === 'skill' && t.skill === run.skills[0].id);
    if (own && !out.includes(own.id)) { const at = out.map(id => TILE_BY_ID[id].type !== 'skill' ? 1 : 0).lastIndexOf(1); if (at >= 0) out[at] = own.id; }
  }
  // Pierwsza oferta (i jej rerolle) zawsze zawiera umiejętność, żeby od razu było co klikać w walce.
  if (run.round === 1 && (salt === 0 || (salt >= 100 && salt < 200)) && !out.some(id => TILE_BY_ID[id].type === 'skill')) {
    const skills = cands.filter(t => t.type === 'skill' && !out.includes(t.id));
    if (skills.length && out.length) {
      const pick = rr.pick(skills);
      let at = out.map(id => TILE_BY_ID[id]).map(t => t.type === 'stat' ? 1 : 0).lastIndexOf(1);
      if (at < 0) at = out.length - 1;
      out[at] = pick.id;
    }
  }
  // Testament Pyrtka: zapisany kafelek jako piąta karta pierwszej oferty (także po rerollach), dopóki go nie weźmiesz.
  if (run.will && !run.willUsed && run.round === 1 && (salt === 0 || (salt >= 100 && salt < 200)) && !out.includes(run.will) && tileAvailable(run, TILE_BY_ID[run.will])) out.push(run.will);
  return out;
}

// Wadliwa Partia: w głównej ofercie czasem jeden kafelek (statystyka albo przedmiot z efektami) ma wadę fabryczną.
const flawable = t => t && !t.event && !t.hatched && !t.hidden && !t.grow && (t.type === 'stat' || t.type === 'item') && t.fx && t.fx.some(f => f.v > 0);
function flawSlot(run, salt) {
  const rr = makeRng(mix(run.seed, run.round, salt, hash('flaw')));
  if (rr.int(100) >= RULES.flawChance) return -1;
  const idx = run.offer.map((id, i) => i).filter(i => i < RULES.offerSize && run.offer[i] !== run.will && flawable(TILE_BY_ID[run.offer[i]]));
  return idx.length ? rr.pick(idx) : -1;
}
// Główna oferta piętra (salt 0, rerolle 100+): kafelki i ewentualna wada.
function setOffer(run, salt) { run.offer = makeOffer(run, salt); run.flawAt = flawSlot(run, salt); }
// Po wzięciu kafelka z oferty: wada fabryczna (ukryta do następnej walki) i Testament.
function afterTake(run, i, id) {
  if (i === run.flawAt) {
    const rr = makeRng(mix(run.seed, run.round, hash('flawkind'), run.flawed.length));
    (run.flawed = run.flawed || []).push({ id, flaw: rr.pick(Object.keys(FLAWS)), on: false, round: run.round });
    run.flawAt = -1;
  }
  if (run.will && id === run.will && run.round === 1) run.willUsed = true;
}

export const priceMul = run => run && decreeIs(run, 'audyt') ? 150 : 100;   // Okólnik „Audyt Wydatków”: dokupowanie o 50% droższe
export const shopPrice = (t, run) => { const p = Math.ceil(RULES.prices[t.rarity] * priceMul(run) / 100); const d = run ? Math.min(90, statsOf(run).buyDisc + ((routeOf(run) || {}).priceDisc || 0)) : 0; return d ? Math.max(1, fl(p * (100 - d) / 100)) : p; };
export const restCost = run => Math.max(0, RULES.restCost - statsOf(run).restDisc);
const freeRerolls = run => CHARS[run.char].freeRerolls + statsOf(run).freeReroll + ((routeOf(run) || {}).freeReroll || 0);
const auditFree = run => decreeIs(run, 'audyt') && run.rerolls < 2;   // Audyt: dwa pierwsze rerolle na piętrze za darmo
export function rerollCost(run) {
  if (hasCurse(run, 'zakaz-wymian')) return null;
  if (run.freeLeft > 0 || auditFree(run)) return 0;
  return RULES.rerollBase + garnekMods(run.garnek).rerollExtra + run.paid;
}

// ---------- Pomocnicze ----------
// Każdy wzrost liczby Ziaren liczy się do `stats.earned` (łącznie zdobyte w runie; odblokowanie Zjaranego Kurczaka), poza zastawem w lombardzie (noEarn).
function setCoins(run, v, noEarn) {
  const nv = Math.max(0, v);
  if (nv > run.coins && !noEarn) run.stats.earned = (run.stats.earned || 0) + nv - run.coins;
  run.coins = nv; if (run.coins > run.stats.maxCoins) run.stats.maxCoins = run.coins;
}

// Stosuje kafelek do runu (wybór z oferty, bonusu albo zakup). Zwraca null albo błąd.
// mut = wybrana gałąź Mutacji (1 lub 2), wymagana przy trzeciej kopii umiejętności.
function applyTile(run, t, slot, mut) {
  const before = statsOf(run).maxHp;
  if (t.type === 'skill') {
    const own = run.skills.find(s => s.id === t.skill);
    if (own && own.lvl >= 2) {
      if (own.lvl >= RULES.maxSkillLvl) return fail('Ta umiejętność jest już zmutowana.', 'maxed');
      if (mut !== 1 && mut !== 2) return fail('Wybierz gałąź Mutacji.', 'mut');
      own.lvl = 3; own.mut = mut; run.stats.muts = (run.stats.muts || 0) + 1;
    } else if (own) own.lvl++;
    else if (run.skills.length < maxSkillsOf(run)) run.skills.push({ id: t.skill, lvl: 1 });
    else if (Number.isInteger(slot) && slot >= 0 && slot < run.skills.length) run.skills[slot] = { id: t.skill, lvl: 1 };
    else return fail('Wszystkie ' + maxSkillsOf(run) + ' sloty są zajęte. Wybierz slot do zastąpienia.', 'slot');
    if (!run.tiles.includes(t.id)) run.tiles.push(t.id);
  } else {
    run.tiles.push(t.id);
    hatch(run);
    if (t.type === 'risk') run.stats.riskPicks++;
    if (t.id === 'pakt-z-lisem') run.stats.fox = 1;
    if (t.id === 'zakazana-pasza') run.flags.bossHpBonus = 30;
    if (t.coinsNow) setCoins(run, run.coins + t.coinsNow);   // Pożyczka Chwilówka, Układ z Zarządem
    if (t.bossBoost) run.flags.bossHpBonus = Math.max(run.flags.bossHpBonus || 0, t.bossBoost);
  }
  const after = statsOf(run).maxHp;
  run.hp = after > before ? run.hp + (after - before) : Math.min(run.hp, after);
  run.hp = Math.max(1, run.hp);
  run.stats.picks++;
  return null;
}

// Wylęgarnia: gdy gracz ma oba składniki przepisu, znikają i powstaje wyklęty przedmiot. run.hatchedNow trafia do odpowiedzi (player.js).
function hatch(run) {
  for (const r of RECIPES) {
    if (run.tiles.includes(r.out) || !r.of.every(id => run.tiles.includes(id))) continue;
    for (const id of r.of) {
      run.tiles.splice(run.tiles.indexOf(id), 1);
      const w = (run.flawed || []).findIndex(x => x.id === id && !run.tiles.includes(id));   // wada znika razem ze składnikiem
      if (w >= 0) run.flawed.splice(w, 1);
    }
    run.tiles.push(r.out);
    (run.stats.hatched = run.stats.hatched || []).push(r.out);
    (run.hatchedNow = run.hatchedNow || []).push(r.out);
  }
}

function nextRound(run) {
  run.round++;
  const M = MODES[run.mode];
  if (run.round > M.rounds && !run.endless) return endRun(run, 'win');
  run.stats.maxRound = Math.max(run.stats.maxRound, run.round);
  run.phase = 'offer'; run.pending = null; run.rested = false; run.rerolls = 0; run.paid = 0; run.door = null; run.arena = null; run.extra = null;
  // Lombard Lisa: niewykupiony zastaw przepada, a Lisy Windykatory rosną w siłę.
  if (run.pawned && run.round > run.pawned.round + 1) { run.foxDebt = (run.foxDebt || 0) + 1; run.lostPawn = run.pawned.id; run.pawned = null; }
  // Wybór trasy na początku strefy II i III.
  if (needsRoute(run)) {
    run.phase = 'route'; run.offer = []; run.flawAt = -1; run.freeLeft = 0;
    run.pending = { kind: 'route', opts: routeOptions(run) };
    run.cur = freshCur(run);
    return { ok: true, route: true };
  }
  return startFloor(run);
}
// Początek piętra po ewentualnym wyborze trasy: Rozwidlenie albo zwykła oferta.
function startFloor(run) {
  run.phase = 'offer'; run.pending = null;
  const M = MODES[run.mode];
  const zoneFirst = run.round === 1 || run.round === zoneStart(run.mode, run.round);
  run.freeLeft = freeRerolls(run) + (zoneFirst ? kLv(run, 'kantyna') : 0);
  if (isDoor(run)) {
    const rr = makeRng(mix(run.seed, run.round, hash('door')));
    run.phase = 'door'; run.offer = []; run.flawAt = -1;
    run.pending = { kind: 'door', affix: rr.pick(Object.keys(AFFIXES)), reward: 'rare', coins: RULES.doorCoins };
    run.cur = freshCur(run);
    return { ok: true, door: true };
  }
  setOffer(run, 0);
  run.cur = freshCur(run);
  return { ok: true };
}
const isDoor = run => (MODES[run.mode].doors || []).includes(run.round) && !MODES[run.mode].bosses[run.round] && !MODES[run.mode].elite.includes(run.round) && !(run.nemesis && !run.nemesis.beaten && run.nemesis.round === run.round);

// Awans Wroga: na którym piętrze czeka Nemezis (strefa jego pochodzenia, zwykłe piętro bez drzwi, elity i bossa).
function nemesisRound(run, n) {
  const M = MODES[run.mode], maxZone = M.zones[M.zones.length - 1].zone;
  const zone = Math.min(ENEMIES[n.enemy].zone, maxZone);
  const plain = r => r >= 2 && !M.bosses[r] && !M.elite.includes(r) && !(M.doors || []).includes(r);
  let cand = []; for (let r = 2; r <= M.rounds; r++) if (plain(r) && zoneOf(run.mode, r) === zone) cand.push(r);
  if (!cand.length) for (let r = 2; r <= M.rounds; r++) if (plain(r)) cand.push(r);
  return makeRng(mix(run.seed, hash('nemesis'))).pick(cand);
}
// Nowy Nemezis z wroga, który zakończył run (losowany z ziarna runu): tytuł, imię, cecha elity i skradziony kafelek.
export function makeNemesis(run, enemyId) {
  const rr = makeRng(mix(run.seed, run.round, hash('promote')));
  const loot = [...new Set(run.tiles)].filter(id => { const t = TILE_BY_ID[id]; return t && t.type !== 'skill' && !t.hidden && !t.hatched && !t.event; });
  return { enemy: enemyId, title: rr.pick(NEMESIS_TITLES), given: rr.pick(NEMESIS_NAMES), affix: rr.pick(Object.keys(AFFIXES)), tile: loot.length ? rr.pick(loot) : null, lvl: 1 };
}
export const nemesisName = n => n.title + ' ' + ENEMIES[n.enemy].name + ' ' + n.given;

function enterFight(run) { run.phase = 'fight'; run.offer = []; run.pending = null; run.fight = null; }

export function liveScore(run) {
  const base = RULES.scoreRound * run.done + RULES.scoreCoin * run.coins + run.timeBonus;
  return fl(base * (100 + RULES.garnekScore * run.garnek) / 100 * (100 + cursePct(run.curses)) / 100);
}

export function endRun(run, outcome) {
  if (outcome === 'lose' && run.cleared !== null && run.cleared !== undefined) { outcome = 'win'; run.fell = !!run.endless; }   // po pokonaniu Prezesa porażka w Dogrywce nadal jest wygraną
  run.phase = 'over'; run.ended = outcome; run.score = liveScore(run); run.offer = []; run.pending = null;
  return { ok: true, ended: outcome };
}

// ---------- Akcje gracza ----------
export function pickTile(run, i, slot, mut, ctx = {}) {
  if (run.phase !== 'offer') return fail('Teraz nie wybierasz kafelka.', 'phase');
  const id = run.offer[i];
  const t = id && TILE_BY_ID[id];
  if (!t) return fail('Nie ma takiego kafelka.', 'index');
  cur(run).picked = id; cur(run).event = t.event || null;
  if (t.event === 'sklepik') {
    run.pending = { kind: 'shop', offer: makeOffer(run, 200, { size: 3, noEvents: true }) };
    run.phase = 'event'; run.offer = [];
    return { ok: true, event: 'shop' };
  }
  if (t.event === 'automat') {
    if (run.coins < 5) return fail('Automat chce 5 Ziaren.', 'coins');
    setCoins(run, run.coins - 5);
    const rr = makeRng(mix(run.seed, run.round, hash('automat')));
    const stats = run.pool.map(x => TILE_BY_ID[x]).filter(x => x && x.type === 'stat' && x.lvl === 3 && tileAvailable(run, x));   // Automat wypluwa statystyki poziomu 3
    const got = [];
    for (let k = 0; k < 2 && stats.length; k++) { const x = rr.pick(stats); applyTile(run, x); got.push(x.id); }
    run.stats.riskPicks++;
    enterFight(run);
    return { ok: true, automat: got };
  }
  if (t.event === 'schronisko') {
    const rr = makeRng(mix(run.seed, run.round, hash('adopt'))), keys = Object.keys(COMPANIONS), opts = [];
    const n = Math.min(keys.length, COMPANION_OFFER);
    while (opts.length < n) { const k = rr.pick(keys); if (!opts.includes(k)) opts.push(k); }
    run.pending = { kind: 'adopt', opts }; run.phase = 'event'; run.offer = [];
    return { ok: true, event: 'adopt' };
  }
  if (t.event === 'arena') {
    run.pending = { kind: 'arena', ghost: ctx.ghost || mirrorGhost(run) }; run.phase = 'event'; run.offer = []; run.stats.riskPicks++;
    return { ok: true, event: 'arena' };
  }
  if (t.event === 'kontrakt') { run.pending = { kind: 'contract' }; run.phase = 'event'; run.offer = []; run.stats.riskPicks++; return { ok: true, event: 'contract' }; }
  if (t.event === 'kapliczka') {
    const rr = makeRng(mix(run.seed, run.round, hash('shrine')));
    const av = BADGE_POOL.filter(b => !(run.badges || []).includes(b));
    run.pending = { kind: 'shrine', badge: av.length ? rr.pick(av) : null }; run.phase = 'event'; run.offer = [];
    return { ok: true, event: 'shrine' };
  }
  if (t.event === 'hazard') { run.pending = { kind: 'gamble' }; run.phase = 'event'; run.offer = []; return { ok: true, event: 'gamble' }; }
  if (t.event === 'skrzynka') {
    const rr = makeRng(mix(run.seed, run.round, hash('crate')));
    const trap = rr.int(100) < 25;
    const epics = run.pool.map(x => TILE_BY_ID[x]).filter(x => x && x.rarity >= 2 && x.type !== 'stat' && !x.event && tileAvailable(run, x));   // wyklutych nie ma w puli (tileAvailable)
    const prize = epics.length ? rr.pick(epics) : null;
    const note = { crate: { tile: prize ? prize.id : null, trap } };
    const e = prize ? applyTile(run, prize, undefined, 1) : null;   // Mutacja ze skrzynki to zawsze gałąź 1
    if (trap) run.hp = Math.max(1, run.hp - Math.max(1, fl(statsOf(run).maxHp * 15 / 100)));
    run.stats.riskPicks++;
    if (e && e.code === 'slot') {   // pełne sloty: gracz sam wybiera, którą umiejętność zastąpić (albo rezygnuje z nagrody)
      run.pending = { kind: 'crate', tile: prize.id }; run.phase = 'event'; run.offer = [];
      return { ok: true, event: 'crate', crate: { ...note.crate, pick: true } };
    }
    enterFight(run);
    return { ok: true, ...note };
  }
  const e = applyTile(run, t, slot, mut);
  if (e) return e;
  afterTake(run, i, t.id);
  enterFight(run);
  return { ok: true, tile: t.id };
}

export function reroll(run) {
  if (run.phase !== 'offer') return fail('Teraz nie ma rerolla.', 'phase');
  if (hasCurse(run, 'zakaz-wymian')) return fail('Klątwa „Zakaz Wymian”: reroll jest niemożliwy.', 'curse');
  const cost = rerollCost(run);
  if (run.coins < cost) return fail('Za mało Ziaren na reroll.', 'coins');
  if (cost === 0) { if (!auditFree(run)) run.freeLeft--; } else { run.paid++; setCoins(run, run.coins - cost); }
  run.rerolls++; run.stats.rerolls++; cur(run).rerolls++;
  setOffer(run, 100 + run.rerolls);
  return { ok: true, cost };
}

// Dokupienie kafelka z bieżącej oferty za Ziarna (cena wg rzadkości). Wolny wybór zostaje: nie da się kupić ostatniego kafelka,
// a wydarzeń (Sklepik, Hazard, Skrzynka) nie kupuje się. Kupiony kafelek znika z oferty (null).
export function buyOffer(run, i, slot, mut) {
  if (run.phase !== 'offer') return fail('Teraz nie można nic dokupić.', 'phase');
  const id = run.offer[i], t = id && TILE_BY_ID[id];
  if (!t) return fail('Tego kafelka już nie ma w ofercie.', 'index');
  if (t.event) return fail('Wydarzeń nie da się kupić. Możesz je tylko wybrać.', 'event');
  if (run.offer.filter(x => x).length < 2) return fail('Musisz zostawić jeden kafelek do darmowego wyboru.', 'last');
  const price = shopPrice(t, run);
  if (run.coins < price) return fail('Za mało Ziaren: ten kafelek kosztuje ' + price + '.', 'coins');
  const e = applyTile(run, t, slot, mut);
  if (e) return e;
  setCoins(run, run.coins - price);
  afterTake(run, i, t.id);
  run.offer[i] = null; run.stats.buys = (run.stats.buys || 0) + 1; cur(run).bought.push(t.id);
  return { ok: true, bought: t.id, price };
}

// Odpoczynek: za Ziarna leczysz część życia, raz na rundę, przed walką (nie w jej trakcie).
export function rest(run) {
  if (run.phase !== 'offer' && run.phase !== 'fight') return fail('Teraz nie można odpoczywać.', 'phase');
  if (hasCurse(run, 'zakaz-drzemek')) return fail('Klątwa „Zakaz Drzemek”: odpoczynek jest wyłączony.', 'curse');
  if (run.phase === 'fight' && run.fight) return fail('Walka już się zaczęła.', 'fighting');
  if (extraOn(run)) return fail('Przed dodatkową rundą nie ma odpoczynku: walczysz z życiem, które ci zostało.', 'extra');
  if (run.rested) return fail('W tej rundzie już odpoczywałeś.', 'rested');
  const S = statsOf(run);
  if (run.hp >= S.maxHp) return fail('Masz pełne życie.', 'full');
  const rc = restCost(run);
  if (run.coins < rc) return fail('Odpoczynek kosztuje ' + rc + ' Ziarna.', 'coins');
  setCoins(run, run.coins - rc);
  const before = run.hp;
  run.hp = Math.min(S.maxHp, run.hp + Math.max(1, fl(S.maxHp * restPctOf(run, S) / 100)));
  run.rested = true; cur(run).rested = (cur(run).rested || 0) + (run.hp - before); run.stats.rests = (run.stats.rests || 0) + 1;
  return { ok: true, healed: run.hp - before, cost: rc };
}

// Ile % życia leczy Odpoczynek: Fundusz Socjalny dodaje, Praca Zdalna podwaja, wada „Rozklejony” połowi.
export function restPctOf(run, S = statsOf(run)) {
  let p = RULES.restPct + S.restBonus;
  if (decreeIs(run, 'homeoffice')) p *= 2;
  if (S.restHalf) p = fl(p / 2);
  return p;
}

// ---------- Ulepszanie statystyk ----------
// RULES.upgradeCost (2) kopie tego samego kafelka statystyki poziomu 1 albo 2 zlewają się za darmo w 1 kafelek następnego poziomu rodziny (t.next).
// Poziom 3 → legendarny to nie ulepszanie (legendarne to tylko łup z bossów). Tylko w fazie oferty, więc powtórka walki się nie zmienia.
export const UPGRADE_COST = RULES.upgradeCost;
export const upgradable = run => [...new Set(run.tiles)].filter(id => { const t = TILE_BY_ID[id]; return t && t.next && run.tiles.filter(x => x === id).length >= UPGRADE_COST; });
export function upgrade(run, id) {
  if (run.phase !== 'offer') return fail('Zlewać kafelki można tylko przed wyborem kafelka.', 'phase');
  const t = TILE_BY_ID[id];
  if (!t || !run.tiles.includes(id)) return fail('Nie masz takiego kafelka.', 'index');
  if (!t.next) return fail('Ten kafelek nie ma wyższego poziomu.', 'level');
  if (run.tiles.filter(x => x === id).length < UPGRADE_COST) return fail('Do ulepszenia potrzebujesz ' + UPGRADE_COST + ' kopii tego kafelka.', 'copies');
  const before = statsOf(run).maxHp;
  for (let k = 0; k < UPGRADE_COST; k++) run.tiles.splice(run.tiles.lastIndexOf(id), 1);
  // wada fabryczna nie może mieć więcej wpisów niż kopii (stopiona kopia zabiera swoją wadę)
  const left = run.tiles.filter(x => x === id).length, fw = (run.flawed || []).filter(w => w.id === id);
  for (let k = left; k < fw.length; k++) run.flawed.splice(run.flawed.lastIndexOf(fw[k]), 1);
  run.tiles.push(t.next);
  const after = statsOf(run).maxHp;
  run.hp = Math.max(1, after > before ? run.hp + (after - before) : Math.min(run.hp, after));
  run.stats.upgrades = (run.stats.upgrades || 0) + 1;
  (cur(run).upgrades = cur(run).upgrades || []).push({ from: id, to: t.next });
  return { ok: true, upgraded: { from: id, to: t.next } };
}

// ---------- Lombard Lisa ----------
// Zastaw: kafelek (nie umiejętność, nie umowa, nie z wadą) znika z budowy, dostajesz pełną cenę jego rzadkości.
// Wykup tylko na następnym piętrze za pawnBack% ceny; potem zastaw przepada (nextRound), a Lisy są silniejsze.
export const pawnPrice = t => RULES.prices[t.rarity];
export const redeemCost = p => Math.ceil(p.price * RULES.pawnBack / 100);
export function pawn(run, id) {
  if (run.phase !== 'offer') return fail('Lombard jest czynny tylko przed wyborem kafelka.', 'phase');
  if (run.pawned) return fail('Lis trzyma już jeden twój zastaw.', 'pawned');
  const t = TILE_BY_ID[id];
  if (!t || !run.tiles.includes(id)) return fail('Nie masz takiego kafelka.', 'index');
  if (t.type === 'skill' || t.hidden) return fail('Lis nie przyjmuje umiejętności ani umów.', 'kind');
  if (t.noPawn) return fail('Lis nie przyjmuje pożyczek pod zastaw.', 'kind');
  if ((run.flawed || []).some(w => w.id === id)) return fail('Lis nie bierze towaru z wadą fabryczną.', 'flaw');
  const price = pawnPrice(t);
  run.tiles.splice(run.tiles.lastIndexOf(id), 1);
  run.hp = Math.max(1, Math.min(run.hp, statsOf(run).maxHp));
  run.pawned = { id, round: run.round, price };
  setCoins(run, run.coins + price, true);
  run.stats.pawns = (run.stats.pawns || 0) + 1; cur(run).pawn = id;
  return { ok: true, pawned: id, price };
}
export function redeem(run) {
  if (run.phase !== 'offer') return fail('Wykup jest możliwy tylko przed wyborem kafelka.', 'phase');
  const p = run.pawned;
  if (!p) return fail('Nie masz nic w lombardzie.', 'none');
  if (run.round !== p.round + 1) return fail('Zastaw wykupisz dopiero na następnym piętrze.', 'early');
  const cost = redeemCost(p);
  if (run.coins < cost) return fail('Wykup kosztuje ' + cost + ' Ziaren.', 'coins');
  setCoins(run, run.coins - cost);
  const before = statsOf(run).maxHp;
  run.tiles.push(p.id); hatch(run);
  const after = statsOf(run).maxHp; if (after > before) run.hp += after - before;
  run.pawned = null; cur(run).redeem = p.id;
  return { ok: true, redeemed: p.id, cost };
}

export function shopBuy(run, i, slot, mut) {
  if (run.phase !== 'event' || !run.pending || run.pending.kind !== 'shop') return fail('Nie jesteś w sklepiku.', 'phase');
  if (i === -1) { enterFight(run); return { ok: true, left: true }; }
  const t = TILE_BY_ID[run.pending.offer[i]];
  if (!t) return fail('Nie ma takiego towaru.', 'index');
  const price = Math.max(1, Math.ceil(shopPrice(t, run) * RULES.shopPct / 100));   // Sklepik Babci Kwoki: 60% zwykłej ceny
  if (run.coins < price) return fail('Babcia mówi: bez ziarna nie ma rozmowy.', 'coins');
  const e = applyTile(run, t, slot, mut);
  if (e) return e;
  setCoins(run, run.coins - price);
  cur(run).bought.push(t.id);
  enterFight(run);
  return { ok: true, bought: t.id, price };
}

export function bet(run, amount) {
  if (run.phase !== 'event' || !run.pending || run.pending.kind !== 'gamble') return fail('Nie jesteś w kurniku hazardu.', 'phase');
  const a = Math.max(0, Math.min(run.coins, amount | 0));
  let won = null;
  if (a > 0) {
    won = makeRng(mix(run.seed, run.round, hash('bet'))).int(100) < RULES.betPct;
    setCoins(run, run.coins + (won ? a : -a));
  }
  cur(run).bet = a ? { amount: a, won } : null;
  enterFight(run);
  return { ok: true, bet: a, won };
}

// Wybór w oknie decyzji: Odznaka po bossie/elicie (faza badge), Kontrakt z HR i Kapliczka (faza event).
export function choose(run, i) {
  const P = run.pending;
  if (run.phase === 'door' && P && P.kind === 'door') {
    if (i !== 0 && i !== 1) return fail('Nie ma takich drzwi.', 'index');
    run.door = { risky: i === 1, affix: P.affix, reward: P.reward };
    run.pending = null; run.phase = 'offer';
    setOffer(run, 0);
    run.cur = freshCur(run); cur(run).door = i;
    if (i === 1) run.stats.doors = (run.stats.doors || 0) + 1;
    // Zwykłe drzwi: darmowy Odpoczynek (leczy jak zwykły, nie zużywa odpoczynku rundy).
    let healed = 0;
    if (i === 0) { const S = statsOf(run), before = run.hp; run.hp = Math.min(S.maxHp, run.hp + Math.max(1, fl(S.maxHp * restPctOf(run, S) / 100))); healed = run.hp - before; cur(run).doorHeal = healed; }
    return { ok: true, chose: i, healed };
  }
  if (run.phase === 'badge' && P && P.kind === 'badge') {
    const b = P.offer[i];
    if (!b || !BADGES[b]) return fail('Nie ma takiej Odznaki.', 'index');
    addBadge(run, b);
    run.pending = null;
    return afterFight(run, P.bonus, P.loot);
  }
  if (run.phase === 'loot' && P && P.kind === 'loot') {
    const id = P.offer[i], t = id && TILE_BY_ID[id];
    if (!t) return fail('Nie ma takiego łupu.', 'index');
    const e = applyTile(run, t);
    if (e) return e;
    if (run.log.length) run.log[run.log.length - 1].loot = id;
    run.stats.loot = (run.stats.loot || 0) + 1;
    run.pending = null;
    return Object.assign(afterFight(run, P.bonus, false), { looted: id });
  }
  if (run.phase === 'route' && P && P.kind === 'route') {   // trasa na całą strefę
    const k = P.opts[i];
    if (!k) return fail('Nie ma takiej trasy.', 'index');
    run.routes = run.routes || [null, null, null]; run.routes[zoneOf(run.mode, run.round)] = k;
    run.stats.routes = (run.stats.routes || 0) + 1; run.pending = null;
    const r = startFloor(run); cur(run).route = k;
    return Object.assign(r, { chose: i });
  }
  if (run.phase === 'victory' && P && P.kind === 'victory') {   // po Prezesie: Dogrywka albo koniec
    if (i === 1) { endRun(run, 'win'); return { ok: true, chose: 1, ended: 'win' }; }
    if (i !== 0) return fail('Nie ma takiego wyboru.', 'index');
    run.endless = true; run.stats.endless = 1; run.pending = null;
    return Object.assign(nextRound(run), { chose: 0 });
  }
  if (run.phase === 'event' && P && P.kind === 'adopt') {   // Schronisko dla Piskląt
    if (i === -1) { if (P.start) { run.pending = null; run.phase = 'offer'; } else enterFight(run); return { ok: true, chose: -1 }; }
    const id = P.opts[i];
    if (!id) return fail('Nie ma takiego towarzysza.', 'index');
    run.companion = { id, lvl: compLevel(run) }; run.stats.adopts = (run.stats.adopts || 0) + 1; cur(run).adopt = id;
    if (P.start) { run.pending = null; run.phase = 'offer'; } else enterFight(run);
    return { ok: true, chose: i, companion: run.companion };
  }
  if (run.phase === 'event' && P && P.kind === 'crate') {   // Skrzynka przy pełnych slotach: który slot zastąpić (-1 = zostaw nagrodę)
    if (i === -1) { run.pending = null; enterFight(run); return { ok: true, chose: -1 }; }
    if (!Number.isInteger(i) || i < 0 || i >= run.skills.length) return fail('Nie ma takiego slotu.', 'index');
    const e = applyTile(run, TILE_BY_ID[P.tile], i, 1);
    if (e) return e;
    run.pending = null; enterFight(run);
    return { ok: true, chose: i, tile: P.tile };
  }
  if (run.phase === 'event' && P && P.kind === 'extra') {   // Dodatkowa runda (Gruszka, Pipsztal): walka z życiem po poprzedniej walce albo odwrót
    if (i !== 0 && i !== 1) return fail('Nie ma takiego wyboru.', 'index');
    run.pending = null;
    if (i === 0) {
      run.extra = { id: P.boss, round: run.round, heal: P.heal | 0, after: P.after };
      run.stats.extraFights = (run.stats.extraFights || 0) + 1;
      enterFight(run);
      return { ok: true, chose: 0 };
    }
    run.hp = Math.min(statsOf(run).maxHp, run.hp + (P.heal | 0));   // odwrót: leczenie z wygranej walki dopiero teraz
    return Object.assign(winTail(run, P.after), { chose: 1 });
  }
  if (run.phase === 'event' && P && P.kind === 'arena') {   // Arena Duchów: walka albo odwrót
    if (i !== 0 && i !== 1) return fail('Nie ma takiego wyboru.', 'index');
    if (i === 0) { run.arena = { ghost: P.ghost, round: run.round }; run.stats.arenaFights = (run.stats.arenaFights || 0) + 1; cur(run).arena = P.ghost.nick; }
    enterFight(run);
    return { ok: true, chose: i };
  }
  if (run.phase !== 'event' || !P || (P.kind !== 'contract' && P.kind !== 'shrine')) return fail('Teraz nie ma wyboru.', 'phase');
  if (!(i >= 0 && i <= 2)) return fail('Nie ma takiej opcji.', 'index');
  const S0 = statsOf(run);
  if (P.kind === 'contract') {
    if (i === 0) applyTile(run, TILE_BY_ID['umowa-etat']);
    if (i === 1) { applyTile(run, TILE_BY_ID['umowa-b2b']); setCoins(run, run.coins + 15); }
    cur(run).contract = i;
  } else {
    if (i === 0) run.hp = S0.maxHp;
    if (i === 1) { if (!P.badge) return fail('Kapliczka nie ma Odznaki.', 'index'); addBadge(run, P.badge); }
    cur(run).shrine = i;
  }
  enterFight(run);
  return { ok: true, chose: i };
}
function addBadge(run, b) {
  const before = statsOf(run).maxHp;
  run.badges = run.badges || []; run.badges.push(b);
  const after = statsOf(run).maxHp; if (after > before) run.hp += after - before;
  run.stats.badges = run.badges.length;
  if (run.log.length) (run.log[run.log.length - 1].badges = run.log[run.log.length - 1].badges || []).push(b);
}
// Łup z bossa: wybór 1 z lootSize legendarnych statystyk (z ziarna runu, najpierw te, których jeszcze nie masz).
export const lootRoll = run => makeRng(mix(run.seed, run.round, hash('lootroll'))).int(100) < RULES.lootChance;   // czy po tym bossie wypada łup
const lootTiles = run => { const all = TILES.filter(t => t.boss && t.type === 'stat'); const fresh = all.filter(t => !run.tiles.includes(t.id)); return fresh.length >= RULES.lootSize ? fresh : all; };
function startLoot(run, bonus) {
  const rr = makeRng(mix(run.seed, run.round, hash('loot'))), pool = lootTiles(run).map(t => t.id), offer = [];
  while (offer.length < Math.min(RULES.lootSize, pool.length)) { const id = rr.pick(pool); if (!offer.includes(id)) offer.push(id); }
  run.phase = 'loot'; run.pending = { kind: 'loot', offer, bonus }; run.offer = []; run.fight = null;
  return { ok: true, loot: true };
}
// Po wygranej walce (i ewentualnej Odznace): oferta bonusowa po bossie albo następna runda.
function afterFight(run, bonus, loot) {
  if (loot) return startLoot(run, bonus);
  if (bonus) { run.phase = 'bonus'; run.offer = makeOffer(run, 300, { size: RULES.bonusSize, minRarity: 1, noEvents: true }); run.fight = null; return { ok: true, bonus: true }; }
  return nextRound(run);
}

export function bonusPick(run, i, slot, mut) {
  if (run.phase !== 'bonus') return fail('Teraz nie ma oferty bonusowej.', 'phase');
  // Łup zza ryzykownych drzwi: zamiast kafelka można wziąć Ziarna (i = -1).
  if (i === -1 && run.door && run.door.risky && !(run.log.length && run.log[run.log.length - 1].boss)) {
    setCoins(run, run.coins + RULES.doorCoins);
    if (run.log.length) run.log[run.log.length - 1].bonus = 'coins';
    const r = nextRound(run); if (r && r.ok) r.coins = RULES.doorCoins; return r;
  }
  const t = TILE_BY_ID[run.offer[i]];
  if (!t) return fail('Nie ma takiego kafelka.', 'index');
  const e = applyTile(run, t, slot, mut);
  if (e) return e;
  if (run.log.length) run.log[run.log.length - 1].bonus = t.id;
  return nextRound(run);
}

// ---------- Arena Duchów ----------
// Duch = build gracza z końca jego runu. curve[i] = statystyki bohatera na (i+1). piętrze: [maxHp, atk, aspd, armor, crit, evade]; w walce Duch ma statystyki z piętra bieżącej rundy
// (albo z ostatniego, jeśli jego run był krótszy). Gdy serwer nie ma cudzego ducha, pojawia się Odbicie: bieżące statystyki gracza.
export function ghostOf(run) {
  const curve = (run.log || []).filter(e => e.hero).map(e => [e.hero.maxHp, e.hero.atk, e.hero.aspd, e.hero.armor, e.hero.crit, e.hero.evade]);
  return curve.length >= 3 ? { char: run.char, mode: run.mode, garnek: run.garnek, floors: run.done, win: run.ended === 'win', score: run.score, curve, tiles: run.tiles.slice(0, 40) } : null;
}
function mirrorGhost(run) { const S = statsOf(run); return { nick: 'Twoje Odbicie', mirror: true, avatar: 0, char: run.char, floors: run.done, curve: [[S.maxHp, S.atk, S.aspd, S.armor, S.crit, S.evade]], tiles: run.tiles.slice(0, 40) }; }
export function ghostStats(g, round) {
  const [maxHp, atk, aspd, armor, crit, evade] = g.curve[Math.min(g.curve.length - 1, Math.max(0, round - 1))];
  return { hp: Math.max(1, fl(maxHp * RULES.ghostPct / 100)), atk: Math.max(1, fl(atk * RULES.ghostPct / 100 * RULES.ghostAtk / 100)), aspd: Math.max(20, aspd), armor, crit: Math.min(60, crit), evade: Math.min(50, evade) };
}
const ghostEnemy = run => { const g = run.arena.ghost, st = ghostStats(g, run.round); return { id: 'duch', name: 'Duch: ' + g.nick, ...st, art: 'ghost', ghost: true, gchar: g.char, gwear: g.wear || null }; };
const extraOn = run => !!(run.extra && run.extra.round === run.round);
const arenaOn = run => !!(run.arena && run.arena.round === run.round);

// ---------- Walka ----------
function scale(mode, round) {
  const M = MODES[mode], g = M.grow; let h = 1, a = 1;
  for (let i = 1; i < round; i++) { h *= g.hp; a *= g.atk; }
  if (round > M.rounds) { h *= RULES.endlessJump[0] / 100; a *= RULES.endlessJump[1] / 100; }   // skok na progu Dogrywki: pierwsze piętra po Prezesie nie mogą być łatwiejsze od ostatnich przed nim
  for (let i = M.rounds; i < round; i++) { h *= 1 + RULES.endlessHp / 100; a *= 1 + RULES.endlessAtk / 100; }   // Dogrywka: wrogowie rosną szybciej (procent składany na każde piętro ponad limit)
  return { h, a };
}
// Strefa (0..2) dla tła i wrogów. Prezes zawsze rezyduje w Biurze Zarządu (strefa III), także w trybie szybkim.
export const zoneOf = (mode, round) => { if (MODES[mode].bosses[round] === 'prezes') return 2; for (const z of MODES[mode].zones) if (round <= z.upTo) return z.zone; return 2; };
const zoneStart = (mode, round) => { let prev = 0; for (const z of MODES[mode].zones) { if (round <= z.upTo) return prev + 1; prev = z.upTo; } return 1; };

export const isNemesisRound = run => !!(run.nemesis && !run.nemesis.beaten && run.nemesis.round === run.round);
const riskyDoor = run => !!(run.door && run.door.risky);
// Szablon zwykłego piętra (Czempion, Rój, Zwiad, Para) albo null (zwykłe piętro). Losowany z osobnej soli,
// więc nie zmienia losowania zwykłych wrogów.
export function floorTemplate(run) {
  const M = MODES[run.mode], r = run.round;
  if (bossAt(run, r) || r <= M.early.rounds || isElite(run) || riskyDoor(run) || isNemesisRound(run)) return null;
  const zi = zoneOf(run.mode, r), keys = Object.keys(FLOOR_TPL).filter(k => (k !== 'zwiad' || zi < 2) && zi >= (FLOOR_TPL[k].minZone || 0));
  let tot = 0; for (const k of keys) tot += FLOOR_TPL[k].w;
  let x = makeRng(mix(run.seed, r, hash('tpl'))).int(tot);
  for (const k of keys) { x -= FLOOR_TPL[k].w; if (x < 0) return k === 'zwykle' ? null : k; }
  return null;
}
// Limit wrogów w jednej walce: bazowy + za każdego towarzysza gracza (dziś najwyżej jednego).
export const petCount = run => (run.companion ? 1 : 0);
export const enemyCap = run => RULES.foeCap + RULES.foePerPet * petCount(run);
const soloPool = zone => Object.values(ENEMIES).filter(e => e.zone === zone && !e.minion && !e.swarm).map(e => e.id);

export function encounterIds(run) {
  const M = MODES[run.mode], r = run.round;
  const bid = bossAt(run, r);
  if (bid) return [bid];
  if (r === 1) return ['szczur-pasz'];
  const zi = zoneOf(run.mode, r), k = r - zoneStart(run.mode, r) + 1;
  const pool = Object.values(ENEMIES).filter(e => e.zone === zi && !e.minion).map(e => e.id);
  const rr = makeRng(mix(run.seed, r, hash('enc')));
  // Nemezis przychodzi z jednym zwykłym pomocnikiem ze strefy (bez roju).
  if (isNemesisRound(run)) { const helpers = pool.filter(id => !ENEMIES[id].swarm); return [run.nemesis.enemy, rr.pick(helpers.length ? helpers : pool)]; }
  const tpl = floorTemplate(run), solo = soloPool(zi);
  if (tpl === 'czempion') return [rr.pick(solo)];
  if (tpl === 'roj') return Array.from({ length: FLOOR_TPL.roj.n }, () => rr.pick(solo));
  if (tpl === 'zwiad') return [rr.pick(soloPool(zi + 1))];
  if (tpl === 'horda') { const n = Math.min(enemyCap(run), 4 + zi + petCount(run)); return Array.from({ length: n }, () => rr.pick(solo)); }
  if (tpl === 'armia') return Array.from({ length: enemyCap(run) }, () => rr.pick(solo));
  if (tpl === 'para') { const a = rr.pick(solo); return [a, rr.pick(solo.filter(id => id !== a))]; }
  // Strefa I: do 2 wrogów naraz; strefy II i III: w późniejszych rundach strefy do 3.
  let count = k <= 1 ? 1 : k <= 3 ? 1 + rr.int(2) : (zi === 0 ? 2 : 2 + rr.int(2));
  count = Math.min(3, count);
  const ids = []; for (let i = 0; i < count; i++) ids.push(rr.pick(pool));
  const sw = ids.find(id => ENEMIES[id].swarm);
  const out = sw ? Array(ENEMIES[sw].swarm).fill(sw) : ids;
  return isElite(run) || riskyDoor(run) ? out.slice(0, 2) : out;   // elita (i ryzykowne drzwi) przychodzi najwyżej z jednym pomocnikiem
}

// Profil buildu gracza (adaptacja bossów, elit i dodatkowych bossów): wynik punktowy każdego stylu, main = najsilniejszy powyżej progu.
// Czysta funkcja wyposażenia, bez losowania. Nie zdradza ziarna, więc nadaje się do widoku.
export function buildProfile(run) {
  const S = statsOf(run), ec = elemCounts(run.tiles, run.skills), sk = id => run.skills.some(x => x.id === id);
  const healSk = ['zagrzebanie', 'pogotowie', 'zupa', 'kawa', 'garsc'].filter(sk).length;
  const all = {
    fire: 2 * (ec.ogien || 0) + (S.burnHit ? 3 : 0) + (S.startBurn ? 2 : 0) + (S.smoke ? 4 : 0) + S.burnPct / 20,
    frost: 2 * (ec.lod || 0) + (S.frostHit ? 3 : 0) + (S.startFrost ? 2 : 0),
    poison: 2 * (ec.trucizna || 0) + (S.poisonHit ? 3 : 0) + S.poisonPct / 20,
    bleed: 2 * (ec.krew || 0) + (S.bleed ? 3 : 0) + (S.critBleed ? 1 : 0),
    crit: Math.max(0, (S.crit - 15) / 6 + (S.critMult - 150) / 30),
    armor: S.armor / 6,
    heal: S.regen / 8 + S.healBonus / 5 + healSk * 2,
    skills: run.skills.reduce((a, x) => a + (x.lvl >= 2 ? 2 : 1) + (x.lvl >= 3 ? 1 : 0), 0) + S.cdPct / 15,
    eggs: S.egg ? 4 + 2 * (ec.jajo || 0) : 0,
  };
  let main = null, best = 4.5;
  for (const k of Object.keys(all)) if (all[k] > best) { best = all[k]; main = k; }
  return { main, score: best, all };
}
// Plan kontr dla bossa / elity / dodatkowego bossa. kind: 'boss' | 'extra' | 'elite'. Liczba i siła rosną z palnikiem (COUNTER_K).
export function counterPlan(run, kind, def = null) {
  if (kind === 'elite' && run.round <= MODES[run.mode].early.rounds) return [];   // wczesne piętra zostają spokojne
  const prof = buildProfile(run), p = Math.min(5, run.garnek | 0);
  const slotK = def && def.slot ? (COUNTER_SLOT_K[def.slot] || 1) : 1;   // pierwszy boss (Brojler) najlżejszy: tam build jest jeszcze niedojrzały
  const k = COUNTER_K[p] / 100 * slotK * (kind === 'elite' ? 0.4 : kind === 'extra' ? 0.3 : 1);
  const ids = [];
  if (prof.main) ids.push(COUNTER_OF[prof.main]);
  const summoner = !!(def && (def.mech || []).includes('summon'));   // bossowie z własnymi pomocnikami nie dostają Świty
  if (kind === 'boss' && !summoner && (p >= 3 || !ids.length)) ids.push('swiat');
  else if (!ids.length && kind === 'elite') ids.push('swiat');   // dodatkowi bossowie bez wyraźnego stylu gracza nie dostają kontry (są opcjonalni)
  const ats = kind === 'boss' ? [[50, 50, 50, 55, 60, 65][p], 30] : [50, 30];
  return ids.map((id, i) => {
    const C = COUNTERS[id];
    const n = !C.n ? 0 : kind === 'boss' ? (id === 'swiat' ? Math.round(1.6 + 0.9 * p / 5) : C.n) : kind === 'extra' ? 0 : (id === 'swiat' && p >= 3 ? 2 : 1);   // elity i dodatkowi bossowie: mniej pomocników
    return { id, at: ats[i], heal: Math.min(100, Math.round(C.heal * k)), dur: Math.round(C.dur * k), n, pct: C.pct || 0, add: C.add || null, pw: id === 'swiat' ? 45 : 60 };
  });
}

// Cechy elity: losowane z ziarna runu (widoczne w podglądzie piętra, bo dotyczą bieżącego spotkania).
export function eliteAffixes(run) {
  const rr = makeRng(mix(run.seed, run.round, hash('affix'))), keys = Object.keys(AFFIXES), out = [];
  const n = run.round <= MODES[run.mode].early.rounds ? 1 : garnekMods(run.garnek).eliteAffixes;   // na wczesnych piętrach elita ma zawsze 1 cechę
  while (out.length < n) { const a = rr.pick(keys); if (!out.includes(a)) out.push(a); }
  return out;
}
function applyAffix(e, a) {
  if (a === 'opancerzony') { e.armor += 15; e.shieldHits = (e.shieldHits || 0) + 2; }
  if (a === 'wampiryczny') e.vamp = 50;
  if (a === 'wybuchowy') e.explode = 200;
  if (a === 'ognioodporny') e.resist = [...(e.resist || []), 'burn', 'poison'];
  if (a === 'mrozny') { e.resist = [...(e.resist || []), 'frost']; e.slow = { pct: 20, ticks: 30 }; }
  if (a === 'szybki') e.aspd = fl(e.aspd * 140 / 100);
  if (a === 'regenerujacy') e.regenPct = 2;
}
const isElite = run => garnekMods(run.garnek).elites && MODES[run.mode].elite.includes(run.round) && !MODES[run.mode].bosses[run.round];

function concrete(def, s, gm, extra = {}, early = null) {
  let hp = Math.max(1, Math.round(def.hp * s.h * (100 + gm.enemyHp) / 100));
  let atk = Math.max(1, Math.round(def.atk * s.a * (100 + gm.enemyAtk) / 100));
  if (early) { hp = Math.max(1, Math.round(hp * early.hp / 100)); atk = Math.max(1, Math.round(atk * early.atk / 100)); }
  const e = { id: def.id, name: def.name, hp, atk, aspd: def.aspd, armor: def.armor, evade: def.evade, crit: def.crit, art: def.art };
  for (const k of ['steal', 'slow', 'spec', 'shieldHits', 'shield', 'minion', 'ignite', 'rise', 'resist', 'audit', 'vamp', 'mech', 'summon', 'rage', 'night', 'blizzard', 'tint', 'stunHero']) if (def[k]) e[k] = def[k];
  return Object.assign(e, extra);
}

export function buildSetup(run) {
  const M = MODES[run.mode], gm0 = garnekMods(run.garnek), s = scale(run.mode, run.round);
  const rp = garnekRamp(run.mode, run.round), gm = { ...gm0, enemyHp: fl(gm0.enemyHp * rp / 100), enemyAtk: fl(gm0.enemyAtk * rp / 100), bossHp: fl(gm0.bossHp * rp / 100) };   // premie palnika rosną z piętrem
  if (extraOn(run)) {   // dodatkowa runda: sam boss (Pipsztal z psem), bez szablonów, tras i cech
    const def = BOSSES[run.extra.id];
    const gmx = { ...gm, enemyHp: fl(gm.enemyHp / 2), enemyAtk: fl(gm.enemyAtk / 2) };   // dodatkowa runda jest opcjonalna: premie palnika dla bossów (życie, szybkość) jej nie dotyczą, a premie dla zwykłych wrogów liczą się w połowie
    const be = concrete(def, s, gmx, { boss: def.id, title: def.title, aspd: def.aspd, idle: def.idle || 0 });
    be.counters = counterPlan(run, 'extra');
    const bp = M.extraPct || { hp: 100, atk: 100 }; be.hp = Math.max(1, fl(be.hp * bp.hp / 100)); be.atk = Math.max(1, fl(be.atk * bp.atk / 100));
    const foes = [be];
    if ((def.mech || []).includes('pet')) foes.unshift(concrete(EXTRA_DOG, s, gm, { pet: true }));
    const S0 = statsOf(run);
    return { v: 1, round: run.round, mode: run.mode, seed: mix(run.seed, run.round, hash('extra')), boss: null, extra: def.id, elite: false, zone: zoneOf(run.mode, run.round), door: false, nemesis: false,
      hero: { loadout: loadoutOf(run), hp: Math.min(run.hp, S0.maxHp), revive: S0.revive && !run.flags.revived }, enemies: foes, minion: concrete(ENEMIES['pisklak-stazysta'], s, gm, { minion: true }) };
  }
  const arena = arenaOn(run), ids = arena ? [] : encounterIds(run), boss = arena ? null : bossAt(run), elite = !arena && isElite(run);
  let enemies;
  if (arena) enemies = [ghostEnemy(run)];
  else if (boss) {
    const def = BOSSES[boss];
    const be = concrete(def, s, gm, { boss, title: def.title, aspd: fl(def.aspd * (100 + gm.bossAspd) / 100) });
    if (run.flags.bossHpBonus) be.hp = fl(be.hp * (100 + run.flags.bossHpBonus) / 100);
    if (gm.bossHp) be.hp = fl(be.hp * (100 + gm.bossHp) / 100);   // wyższe palniki: mocniejsi bossowie
    if (def.auditEvery) be.audit = def.auditEvery;
    be.counters = counterPlan(run, 'boss', def);
    enemies = [be];
    if (def.guards) {
      const g = ENEMIES['kot-ochroniarz'];
      const guards = Array.from({ length: def.guards }, () => concrete(g, s, gm, { name: 'Ochroniarz', guard: true }));
      enemies = [...guards, be];
      for (const e of enemies) e.idle = 30;   // Zebranie Zarządu: przez pierwsze 3 s nikt nie atakuje, gracz zdąży użyć umiejętności
    }
    const bp = M.bossPct;
    for (const e of enemies) { e.hp = Math.max(1, fl(e.hp * bp.hp / 100)); e.atk = Math.max(1, fl(e.atk * bp.atk / 100)); }
  } else {
    const early = run.round <= M.early.rounds ? M.early : null;
    enemies = ids.map(id => concrete(ENEMIES[id], s, gm, {}, early));
    const zm = M.zoneMul && M.zoneMul[zoneOf(run.mode, run.round)];   // mnożnik strefy (późne strefy groźniejsze niż sam wzrost)
    if (zm) for (const e of enemies) { e.hp = Math.max(1, fl(e.hp * zm.hp / 100)); e.atk = Math.max(1, fl(e.atk * zm.atk / 100)); }
    // Szablon piętra (Czempion, Rój, Para; Zwiad to sam wybór wroga z następnej strefy).
    const tpl = floorTemplate(run), TP = tpl && FLOOR_TPL[tpl];
    if (tpl === 'czempion') { const e0 = enemies[0]; e0.hp = fl(e0.hp * TP.hp / 100); e0.champion = true; e0.name = 'Czempion ' + e0.name; }
    if (tpl === 'roj') for (const e of enemies) { e.hp = Math.max(1, fl(e.hp * TP.hp / 100)); e.atk = Math.max(1, fl(e.atk * TP.atk / 100)); }
    if (tpl === 'zwiad') enemies[0].scout = true;
    if (TP && TP.many) {   // Horda i Armia: słabsi wrogowie, dowódca Armii mocniejszy, część wchodzi od razu, reszta falami po RULES.waveSize
      enemies.forEach((e, i) => { const lead = tpl === 'armia' && i === 0; e.hp = Math.max(1, fl(e.hp * (lead ? TP.leaderHp : TP.hp) / 100)); e.atk = Math.max(1, fl(e.atk * (lead ? 100 : TP.atk) / 100)); if (lead) { e.name = 'Dowódca ' + e.name; e.champion = true; } });
      const first = tpl === 'armia' ? 3 : Math.ceil(enemies.length / 2);
      enemies.forEach((e, i) => { if (i >= first) e.arrive = RULES.waveGap * (1 + fl((i - first) / RULES.waveSize)); });
    }
    if (tpl === 'para') { const big = enemies[0].hp >= enemies[1].hp ? enemies[0] : enemies[1]; big.armor += TP.armor; for (const e of enemies) e.regenPct = (e.regenPct || 0) + TP.regen; }
    if (elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * 130 / 100); e0.atk = fl(e0.atk * 112 / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; e0.affixes = eliteAffixes(run); for (const a of e0.affixes) applyAffix(e0, a); e0.counters = counterPlan(run, 'elite'); }
    // Rozwidlenie Korytarza: za ryzykownymi drzwiami pierwszy wróg ma cechę elity.
    if (riskyDoor(run) && !elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * RULES.doorHp / 100); e0.atk = fl(e0.atk * RULES.doorAtk / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; e0.affixes = [run.door.affix]; applyAffix(e0, run.door.affix); e0.counters = counterPlan(run, 'elite'); }
    // Awans Wroga: Nemezis (z każdym awansem mocniejszy).
    if (isNemesisRound(run)) {
      const n = run.nemesis, e0 = enemies[0], lv = (n.lvl || 1) - 1;
      e0.hp = fl(e0.hp * (RULES.nemesisHp + 10 * lv) / 100); e0.atk = fl(e0.atk * (RULES.nemesisAtk + 5 * lv) / 100);
      e0.elite = true; e0.nemesis = true; e0.name = nemesisName(n); e0.affixes = [n.affix]; applyAffix(e0, n.affix); e0.counters = counterPlan(run, 'elite');
    }
    // Lombard Lisa: każdy przepadły zastaw wzmacnia Lisy Windykatory.
    if (run.foxDebt) for (const e of enemies) if (e.id === 'lis-windykator') { const m = 100 + RULES.pawnFox * run.foxDebt; e.hp = fl(e.hp * m / 100); e.atk = fl(e.atk * m / 100); e.steal = { n: 1, max: 3 + run.foxDebt }; }
  }
  // Trasa strefy: modyfikatory zwykłych wrogów (bez bossów i Ducha).
  const rt = routeOf(run);
  if (rt && !boss && !arena) for (const e of enemies) {
    if (rt.enemyHp) e.hp = Math.max(1, fl(e.hp * (100 + rt.enemyHp) / 100));
    if (rt.enemyAtk) e.atk = Math.max(1, fl(e.atk * (100 + rt.enemyAtk) / 100));
    if (rt.slow && !e.slow) e.slow = rt.slow;
    if (rt.ignite && !e.ignite) e.ignite = rt.ignite;
    if (rt.shieldHits) e.shieldHits = (e.shieldHits || 0) + rt.shieldHits;
  }
  // Klątwa „Przegrzany Piec”: wszyscy wrogowie +15% Życia i Ataku.
  if (hasCurse(run, 'przegrzany-piec')) for (const e of enemies) { e.hp = Math.max(1, fl(e.hp * 115 / 100)); e.atk = Math.max(1, fl(e.atk * 115 / 100)); }
  // Okólnik „Premia Motywacyjna”: wrogowie mają +15% Życia.
  if (decreeIs(run, 'premia')) for (const e of enemies) e.hp = fl(e.hp * 115 / 100);
  const S = statsOf(run);
  return {
    v: 1, round: run.round, mode: run.mode, seed: mix(run.seed, run.round, hash('fight')), boss, elite, zone: zoneOf(run.mode, run.round),
    door: riskyDoor(run) && !arena, nemesis: isNemesisRound(run) && !arena, arena: arena || undefined, tpl: arena ? undefined : floorTemplate(run) || undefined, fury: decreeIs(run, 'pilny') || hasCurse(run, 'pospiech') ? 300 : undefined,
    hero: { loadout: loadoutOf(run), hp: Math.min(run.hp, S.maxHp), revive: S.revive && !run.flags.revived },
    enemies, minion: concrete(ENEMIES['pisklak-stazysta'], s, gm, { minion: true }),
  };
}

export function fightSetup(run) {
  if (run.phase !== 'fight') return fail('Teraz nie ma walki.', 'phase');
  run.fight = { started: true };
  return { ok: true, setup: buildSetup(run) };
}

export function fightFinish(run, inputs) {
  if (run.phase !== 'fight' || !run.fight) return fail('Nie ma walki do rozliczenia.', 'phase');
  const setup = buildSetup(run), res = runFight(setup, inputs);
  const S = statsOf(run), gm = garnekMods(run.garnek), c = cur(run), coinsBefore = run.coins, hpBefore = setup.hero.hp;
  const entry = () => ({ r: run.round, zone: setup.zone, boss: setup.boss, elite: setup.elite, tpl: setup.tpl || null, enemies: setup.enemies.map(e => ({ n: e.name, hp: e.hp, atk: e.atk })),
    offer: c.offer, picked: c.picked, bought: c.bought, upgrades: c.upgrades || [], rerolls: c.rerolls, rested: c.rested || 0, event: c.event, bet: c.bet || null,
    hero: { maxHp: S.maxHp, atk: S.atk, aspd: S.aspd, armor: S.armor, crit: S.crit, evade: S.evade, regen: S.regen }, tiles: run.tiles.length, skills: run.skills.map(s => s.id + (s.lvl > 1 ? '*' : '')),
    coinsBefore, coinsAfter: run.coins, hpBefore, hpAfter: res.hp, win: res.win, foeLeft: res.foeLeft, inputs: (Array.isArray(inputs) ? inputs : []).slice(0, 120).map(x => Array.isArray(x) ? [x[0] | 0, x[1] | 0] : [0, 0]), ticks: res.ticks, dealt: res.dealt, taken: res.taken, maxHit: res.maxHit, skillsUsed: res.skillsUsed, stolen: res.stolen, revived: res.usedRevive, timeout: res.timeout,
    // Decyzje poza ofertą (do analizy partii): drzwi, trasa, adopcja, arena, kontrakt, kapliczka, lombard.
    ...Object.fromEntries(['door', 'doorHeal', 'route', 'adopt', 'arena', 'contract', 'shrine', 'pawn', 'redeem'].filter(k => c[k] !== undefined).map(k => [k, c[k]])),
    companion: run.companion ? run.companion.id + ':' + run.companion.lvl : null, endless: !!run.endless });
  setCoins(run, run.coins - Math.min(run.coins, res.stolen) + (res.coinsWon || 0));
  if (res.usedRevive) run.flags.revived = true;
  // Wadliwa Partia: wady kafelków wziętych przed tą walką ujawniają się i od teraz działają.
  const revealed = [];
  for (const w of (run.flawed || [])) if (!w.on) { w.on = true; revealed.push({ id: w.id, flaw: w.flaw }); }
  run.stats.reactions = [...new Set([...(run.stats.reactions || []), ...(res.reactSeen || [])])];
  run.stats.chains = (run.stats.chains || 0) + (res.chains || 0);
  if (run.stats.v2 && !setup.extra) {
    run.stats.skillUses = (run.stats.skillUses || 0) + (res.skillsUsed || 0);
    if ((res.chains || 0) > (run.stats.maxChainsFight || 0)) run.stats.maxChainsFight = res.chains;
    if (Object.values(setCounts(run.tiles)).some(n => n >= 2)) run.stats.syn = true;
    if (res.win) {
      if (res.ticks > (run.stats.longWin || 0)) run.stats.longWin = res.ticks;
      if (run.stats.fastWin === undefined || res.ticks < run.stats.fastWin) run.stats.fastWin = res.ticks;
      if (res.taken === 0) { run.stats.flawless = (run.stats.flawless || 0) + 1; if (setup.boss) run.stats.bossFlawless = true; }
    }
  }
  if (setup.boss && run.flags.bossHpBonus) run.flags.bossHpBonus = 0;
  if (res.maxHit > run.stats.maxHit) run.stats.maxHit = res.maxHit;
  run.hp = res.hp;
  const out = { ok: true, result: res, reward: 0, boss: bossSlotOf(res.boss), bossVar: res.boss, round: run.round };
  if (setup.arena) out.arena = { n: run.arena.ghost.n || null, nick: run.arena.ghost.nick, mirror: !!run.arena.ghost.mirror, won: !!res.win };
  if (revealed.length) out.revealed = revealed;
  if (!res.win) {
    // Awans Wroga: zwykły wróg, który zakończył run, awansuje (albo Nemezis awansuje wyżej).
    if (setup.nemesis) run.killer = { enemy: run.nemesis.enemy, nemesis: true };
    else if (!setup.boss) { const k = setup.enemies.filter(e => !e.minion && !e.guard && ENEMIES[e.id]).sort((a, b) => b.atk - a.atk)[0]; if (k) run.killer = { enemy: k.id, nemesis: false, next: makeNemesis(run, k.id) }; }
    run.arena = null; run.extra = null;
    if (setup.extra && run.log.length) run.log[run.log.length - 1].extra = { id: setup.extra, won: false, ticks: res.ticks };   // dodatkowa runda nie dubluje wpisu piętra
    else run.log.push({ ...entry(), reward: 0, hpAfterHeal: res.hp });
    endRun(run, 'lose'); out.ended = run.ended; return out;
  }

  // Dodatkowa runda wygrana: Ziarna, legendarny łup i dalej zwykły ciąg po piętrze (Odznaka, oferta bonusowa, następna runda).
  if (setup.extra) {
    const X = run.extra; run.extra = null; run.fight = null;
    setCoins(run, run.coins + RULES.extraCoins); out.reward = RULES.extraCoins; out.extra = { id: setup.extra, won: true };
    run.stats.extraWins = (run.stats.extraWins || 0) + 1;
    (run.stats.extras = run.stats.extras || []).includes(setup.extra) || run.stats.extras.push(setup.extra);
    run.hp = Math.min(statsOf(run).maxHp, run.hp + (X.heal | 0));
    if (run.log.length) run.log[run.log.length - 1].extra = { id: setup.extra, won: true, ticks: res.ticks, reward: RULES.extraCoins };
    const t = winTail(run, { ...X.after, loot: X.after.loot || RULES.extraLoot });
    if (t.badge) out.badge = true; if (t.bonus) out.bonus = true; if (t.loot) out.loot = true;
    return out;
  }
  // Wygrana: nagrody, leczenie, rozliczenie wyniku.
  const rt = routeOf(run);
  const exId = !run.endless && !setup.arena && run.round < MODES[run.mode].rounds && EXTRA_AT[run.round] || null;   // po wygranej na piętrze 3 i 6: opcjonalna dodatkowa runda
  let extraHeal = 0;
  const late = (run.round - 1) / MODES[run.mode].rounds >= 0.6 ? RULES.coinsLate : 0;   // późna gra (od 60% runu i Dogrywka): wyższa podstawa, żeby Ziarna miały jeszcze sens
  let coins = (setup.boss ? RULES.coinsBoss + S.bossCoins + kLv(run, 'skarbiec') : RULES.coinsRound) + late + S.coinFlat - (gm.coinMinus || 0) - (hasCurse(run, 'podatek') ? 2 : 0) + ((rt && rt.coins) || 0) + (setup.arena ? RULES.arenaCoins : 0);
  coins = fl(coins * (100 + S.coinPct + (setup.elite ? RULES.eliteCoinsPct : 0)) / 100);
  if (S.interest) coins += Math.min(5 + (S.interestPlus || 0), fl(run.coins * S.interest / 100));
  if (S.bigInterest) coins += Math.min(12, fl(run.coins * S.bigInterest / 100));   // Akcje Zarządu
  if (decreeIs(run, 'premia')) coins += 3;
  // Odsetki w Spiżarni: +1 Ziarno za każde 10 niewydanych (po kradzieżach), najwyżej 3 (Kaczor 5).
  const interest = Math.min(CHARS[run.char].interestMax || RULES.interestMax, fl(run.coins / RULES.interestPer));
  coins += interest; out.interest = interest;
  if (setup.door && run.door.reward === 'coins') { coins += RULES.doorCoins; out.doorCoins = RULES.doorCoins; }   // stare runy (sprzed zmiany drzwi) mogą mieć nagrodę Ziarnami
  const upkeep = coins < 0 ? -coins : 0;   // ujemny dochód (umowy, odsetki, Klątwa Podatku) zjada oszczędności zamiast przepadać
  coins = Math.max(0, coins);
  // Kafelki rosnące.
  const gw = (id, n, why) => { if (n > 0 && run.tiles.includes(id)) { const t = TILE_BY_ID[id]; const v = Math.min(t.grow.max, (run.grow[id] || 0) + n); if (v !== (run.grow[id] || 0)) { run.grow[id] = v; (out.grew = out.grew || []).push(id); } } };
  run.grow = run.grow || {};
  gw('pierze-weterana', res.lowest * 100 < S.maxHp * 60 ? 1 : 0);
  gw('trofeum-z-pior', Math.min(4, res.kills));
  gw('skarbonka-piskleca', run.rested ? 0 : 1);
  // Jajko Dinozaura: po 5 wygranych piętrach wykluwa się Dinozaur
  gw('jajko-dinozaura', 1);
  if (run.tiles.includes('jajko-dinozaura') && run.grow['jajko-dinozaura'] >= TILE_BY_ID['jajko-dinozaura'].grow.max) {
    const hb = statsOf(run).maxHp; run.tiles.splice(run.tiles.indexOf('jajko-dinozaura'), 1, 'dinozaur'); delete run.grow['jajko-dinozaura'];
    const ha = statsOf(run).maxHp; if (ha > hb) run.hp += ha - hb;
    out.dino = true; run.stats.dino = 1;
  }
  // Awans Wroga: pokonany Nemezis oddaje skradziony kafelek i daje Odznakę Sprawiedliwość Kurnika.
  if (setup.nemesis) {
    run.nemesis.beaten = true; out.nemesis = { tile: null };
    const t = run.nemesis.tile && TILE_BY_ID[run.nemesis.tile];
    if (t && tileAvailable(run, t) && !applyTile(run, t)) out.nemesis.tile = t.id;
    if (!(run.badges || []).includes('sprawiedliwosc')) addBadge(run, 'sprawiedliwosc');
  }
  if (setup.boss && run.coins >= 30) run.stats.richBoss = true;
  run.stats.maxBurn = Math.max(run.stats.maxBurn || 0, res.burnDealt || 0);
  run.stats.freezes = (run.stats.freezes || 0) + (res.freezes || 0);
  setCoins(run, run.coins + coins); out.reward = coins;
  if (upkeep) { const pay = Math.min(run.coins, upkeep); setCoins(run, run.coins - pay); out.upkeep = pay; }
  if (!setup.door) {
    const heal = fl(S.maxHp * Math.max(0, gm.healPct + S.healBonus + ((rt && rt.heal) || 0) - (decreeIs(run, 'homeoffice') ? 10 : 0)) / 100);
    if (exId) extraHeal = heal;   // dodatkowa runda zaczyna się z życiem po walce; leczenie dopiero po niej (albo po odwrocie)
    else run.hp = Math.min(statsOf(run).maxHp, run.hp + heal);
  }
  if (res.hp * 10 < S.maxHp) run.stats.lowWin = true;
  if (res.taken > S.maxHp) run.stats.tankWin = true;
  if (run.tiles.includes('siewnik')) run.flags.bonusAtk++;
  run.done++;
  run.timeBonus += fl(RULES.scoreTimeMax * Math.max(0, 600 - res.ticks) / (MODES[run.mode].rounds * 600)) * (decreeIs(run, 'pilny') ? 2 : 1);
  if (res.boss) {
    const slot = bossSlotOf(res.boss);
    if (!run.stats.bossKills.includes(slot)) run.stats.bossKills.push(slot);
    (run.stats.bossVars = run.stats.bossVars || []).includes(res.boss) || run.stats.bossVars.push(res.boss);
    run.bossWins = (run.bossWins | 0) + 1;
    if (run.companion) { const L = compLevel(run); if (L > run.companion.lvl) { run.companion.lvl = L; out.compUp = L; } }   // towarzysz ewoluuje po bossie
  }
  if (setup.arena) { run.stats.arenaWins = (run.stats.arenaWins || 0) + 1; run.arena = null; }
  if (run.endless) run.stats.endlessFloors = (run.stats.endlessFloors || 0) + 1;
  run.log.push({ ...entry(), reward: coins, hpAfterHeal: run.hp, coinsAfter: run.coins });

  if (run.round >= MODES[run.mode].rounds && !run.endless) {   // Prezes pokonany: wygrana jest już zaliczona, gracz wybiera: kończy albo gra dalej (Dogrywka)
    run.cleared = run.done; run.fight = null; run.offer = [];
    run.phase = 'victory'; run.pending = { kind: 'victory' };
    out.victory = true;
    return out;
  }
  const bonus = MODES[run.mode].bonusAfter.includes(run.round) || (setup.door && run.door.reward === 'rare') || !!setup.arena;
  const loot = !!setup.boss && lootRoll(run);   // szansa RULES.lootChance %; ostatni boss kończy run wcześniej (return powyżej)
  run.fight = null;
  const after = { bonus, loot, badge: !!(setup.boss || setup.elite) };
  if (exId) { run.offer = []; run.phase = 'event'; run.pending = { kind: 'extra', boss: exId, heal: extraHeal, after }; out.extraOffer = exId; return out; }
  const t = winTail(run, after);
  if (t.badge) out.badge = true;
  if (t.bonus) out.bonus = true;
  if (t.loot) out.loot = true;
  return out;
}
// Ciąg po wygranym piętrze: Odznaka (po bossie i elicie), potem łup, oferta bonusowa albo następna runda. after = { bonus, loot, badge }.
function winTail(run, after) {
  const avail = BADGE_POOL.filter(b => !(run.badges || []).includes(b));
  if (after.badge && avail.length) {
    const rr = makeRng(mix(run.seed, run.round, hash('badge')));
    const offer = []; while (offer.length < Math.min(BADGE_OFFER, avail.length)) { const b = rr.pick(avail); if (!offer.includes(b)) offer.push(b); }
    run.phase = 'badge'; run.pending = { kind: 'badge', offer, bonus: after.bonus, loot: after.loot }; run.offer = [];
    return { ok: true, badge: true };
  }
  return afterFight(run, after.bonus, after.loot);
}

// Testament Pyrtka: po przegranej gracz zapisuje jeden kafelek (zwykły albo rzadki) do pierwszej oferty następnego runu.
export function willOptions(run) {
  if (!run || run.phase !== 'over' || run.ended !== 'lose' || run.willDone) return null;
  const ids = [...new Set(run.tiles)].filter(id => { const t = TILE_BY_ID[id]; return t && t.rarity <= 1 && !t.hidden && !t.hatched && !t.event; });
  return ids.length ? ids : null;
}

// Zamiana kolejności umiejętności (sloty = klawisze 1/2/3 w walce; pierwszy slot dostaje „Pierwszą gotową”). Tylko przed walką.
export function swapSkills(run, a, b) {
  if (run.phase === 'over') return fail('Run już się skończył.', 'phase');
  if (run.phase === 'fight' && run.fight) return fail('Walka już się zaczęła.', 'fighting');
  const n = run.skills.length;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n) return fail('Nie ma takiego slotu.', 'index');
  if (a !== b) [run.skills[a], run.skills[b]] = [run.skills[b], run.skills[a]];
  return { ok: true, skills: run.skills.map(s => s.id) };
}

export function abandon(run) {
  if (run.phase === 'over') return fail('Run już się skończył.', 'phase');
  endRun(run, 'lose');
  return { ok: true, ended: 'lose' };
}

// ---------- Widok dla klienta ----------
export const hideFoes = run => (run.garnek | 0) >= 1 || hasCurse(run, 'mgla');
// Oczyszczony pending: Duch bez krzywej statystyk i bez klucza gracza, za to z liczbami na bieżące piętro.
function viewPending(run) {
  const P = run.pending;
  if (!P || P.kind !== 'arena') return P;
  const g = P.ghost;
  return { kind: 'arena', ghost: { nick: g.nick, avatar: g.avatar | 0, char: g.char, wear: g.wear || null, floors: g.floors, mirror: !!g.mirror, win: !!g.win, tiles: g.tiles || [], stats: ghostStats(g, run.round) } };
}
// Bez ziarna runu: oferty i spotkania z przyszłości nie dają się wyliczyć po stronie przeglądarki.
export function view(run) {
  if (!run) return null;
  const M = MODES[run.mode], S = statsOf(run), over = run.phase === 'over';
  const v = {
    id: run.id, mode: run.mode, char: run.char, garnek: run.garnek, round: run.round, rounds: M.rounds, phase: run.phase,
    hp: run.hp, maxHp: S.maxHp, coins: run.coins, tiles: run.tiles, skills: run.skills, offer: run.offer, pending: viewPending(run),
    daily: run.daily || null, curses: run.curses || [], routes: run.routes || [null, null, null], route: (run.routes && run.routes[zoneOf(run.mode, run.round)]) || null, companion: run.companion || null, kurnik: run.kurnik || {},
    arenaGhost: arenaOn(run) ? { nick: run.arena.ghost.nick, avatar: run.arena.ghost.avatar | 0, char: run.arena.ghost.char, mirror: !!run.arena.ghost.mirror, floors: run.arena.ghost.floors, stats: ghostStats(run.arena.ghost, run.round) } : null,
    endless: !!run.endless, cleared: run.cleared === undefined ? null : run.cleared, fell: !!run.fell, maxSkills: maxSkillsOf(run), cursePct: cursePct(run.curses), arenaNow: !!(run.arena && run.arena.round === run.round), extraNow: extraOn(run) ? run.extra.id : null,
    rerollCost: run.phase === 'offer' ? rerollCost(run) : null, freeLeft: run.freeLeft, rested: run.rested, restCost: restCost(run), restPct: RULES.restPct + S.restBonus, badges: run.badges || [], affixes: !over && isElite(run) && !hideFoes(run) ? eliteAffixes(run) : null, buyDisc: S.buyDisc, stats: run.stats, flags: { bossHpBonus: run.flags.bossHpBonus, revived: run.flags.revived, bonusAtk: run.flags.bonusAtk },
    score: over ? run.score : liveScore(run), done: run.done, timeBonus: run.timeBonus, ended: run.ended, killer: over && run.killer ? { enemy: run.killer.enemy, nemesis: !!run.killer.nemesis } : null, form: formFor(run.mode, run.round).id, zone: zoneOf(run.mode, run.round),
    boss: bossAt(run), bossSlot: bossSlotOf(bossAt(run)), elite: !over && isElite(run), hero: S,
    decree: over ? null : decreeOf(run), priceMul: priceMul(run), grow: run.grow || {}, flawAt: run.phase === 'offer' ? run.flawAt : -1,
    flawed: (run.flawed || []).map(w => ({ id: w.id, flaw: w.on ? w.flaw : null, on: w.on })),
    up: run.phase === 'offer' ? upgradable(run) : [], pawned: run.pawned ? { ...run.pawned, cost: redeemCost(run.pawned), canRedeem: run.round === run.pawned.round + 1 } : null, foxDebt: run.foxDebt || 0, lostPawn: run.lostPawn || null,
    door: run.door, doors: (M.doors || []).filter(r => !M.bosses[r] && !M.elite.includes(r)), will: run.will && !run.willUsed && run.round === 1 ? run.will : null,
    nemesis: run.nemesis ? { name: nemesisName(run.nemesis), enemy: run.nemesis.enemy, affix: run.nemesis.affix, tile: run.nemesis.tile, lvl: run.nemesis.lvl || 1, round: run.nemesis.round, beaten: run.nemesis.beaten } : null,
    // Tablica Zarządu (faktury za pokonane piętra): tylko liczby z dziennika wygranych walk, bez składu przyszłych pięter.
    board: (run.log || []).filter(e => e.win).map(e => ({ r: e.r, boss: !!e.boss, ticks: e.ticks, dealt: e.dealt, reward: e.reward | 0 })),
    nemesisRound: !over && isNemesisRound(run), interestMax: CHARS[run.char].interestMax || RULES.interestMax, willOptions: willOptions(run),
  };
  // Podgląd wrogów: na Garnku 0 widać skład piętra i szablon; od Garnka 1 tylko zapowiedź bossa (reszta ukryta po stronie serwera).
  if (!over) {
    if (!hideFoes(run)) { v.enemies = encounterIds(run); v.tpl = floorTemplate(run); }
    else { v.enemies = bossAt(run) ? encounterIds(run) : null; v.tpl = null; v.hidden = !bossAt(run); }
    if (bossAt(run) || isElite(run) || isNemesisRound(run)) { const pm = buildProfile(run).main; v.intel = pm ? ARCHETYPES[pm] : null; }   // zapowiedź adaptacji: tylko nazwa stylu, bez kontry
  }
  return v;
}
