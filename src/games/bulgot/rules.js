// Bulgot: reguły runu. Czyste funkcje na zwykłym obiekcie `run` (JSON), bez dostępu do pamięci i sieci.
// Wszystkie losowania biorą ziarno z run.seed, więc ten sam run daje te same oferty i spotkania.
// Każda funkcja zwraca { ok: true, ... } albo { err, code }. Stan zapisuje i autoryzuje BgPlayer (player.js).
import { mix, hash, makeRng } from './rng.js';
import { TILES, RECIPES, BADGES, BADGE_OFFER, BADGE_POOL, AFFIXES, MODES, CHARS, TILE_BY_ID, ENEMIES, BOSSES, RULES, FLOOR_TPL, RARITY_WEIGHTS, TYPE_WEIGHTS, DECREES, FLAWS, NEMESIS_TITLES, NEMESIS_NAMES, garnekMods, formFor } from './data.js';
import { heroStats, setCounts } from './stats.js';
import { runFight } from './sim.js';

const fl = Math.floor;
const fail = (err, code) => ({ err, code });

export const loadoutOf = run => ({
  char: run.char, tiles: run.tiles, skills: run.skills, coins: run.coins,
  bonusAtk: run.flags.bonusAtk, noRegen: garnekMods(run.garnek).noRegen, badges: run.badges || [],
  grow: run.grow || {}, flawed: run.flawed || [], decree: decreeOf(run),
});

// ---------- Okólniki Zarządu ----------
// Każda strefa runu ma inny okólnik, losowany z ziarna runu. Gracz widzi tylko okólnik bieżącej strefy.
export function decreesOf(seed) {
  const rr = makeRng(mix(seed, hash('decree'))), keys = Object.keys(DECREES), out = [];
  while (out.length < 3) { const d = rr.pick(keys); if (!out.includes(d)) out.push(d); }
  return out;
}
// run.decrees zapisuje się przy starcie runu (starsze runy liczą je z ziarna); null w strefie = brak okólnika.
export const decreeOf = run => (run.decrees || (run.seed === undefined ? [] : decreesOf(run.seed)))[zoneOf(run.mode, run.round)] || null;
const decreeIs = (run, id) => decreeOf(run) === id;
export const statsOf = run => heroStats(loadoutOf(run));

// Notatki bieżącej rundy (do historii gier): co zaoferowano, co wybrano, co dokupiono, ile rerolli.
const freshCur = run => ({ offer: run.offer.slice(), picked: null, rerolls: 0, bought: [], event: null });
const cur = run => run.cur || (run.cur = freshCur(run));

// ---------- Nowy run ----------
// Wersja reguł runu. Run zapisany w innej wersji serwer unieważnia (inne spotkania = niezgodna powtórka walki).
export const RUN_V = 3;

export function newRun({ mode, char, garnek, pool, seed, now = 0, nemesis = null, will = null }) {
  const M = MODES[mode], ch = CHARS[char];
  if (!M) return fail('Nieznany tryb.', 'mode');
  if (!ch) return fail('Nieznana postać.', 'char');
  const run = {
    v: RUN_V, id: String(seed), mode, char, garnek: garnek | 0, seed: seed >>> 0, round: 1, phase: 'offer',
    hp: 1, coins: ch.coins, tiles: [], skills: ch.startSkills.map(([id, lvl]) => ({ id, lvl })), offer: [], rerolls: 0, paid: 0, freeLeft: ch.freeRerolls,
    pending: null, rested: false, pool: pool.slice(), badges: [], started: now, ended: null, score: 0, timeBonus: 0, done: 0,
    flags: { bonusAtk: 0, bossHpBonus: 0, revived: false },
    stats: { riskPicks: 0, fox: 0, maxCoins: ch.coins, maxHit: 0, lowWin: false, maxRound: 1, bossKills: [], picks: 0, rerolls: 0, v2: 1, syn: false, rests: 0, skillUses: 0, flawless: 0, bossFlawless: false, maxChainsFight: 0, longWin: 0 },
    log: [],
    grow: {}, flawed: [], flawAt: -1, pawned: null, foxDebt: 0, door: null, nemesis: null, will: null, willUsed: false,
  };
  run.decrees = decreesOf(run.seed);
  if (nemesis && ENEMIES[nemesis.enemy]) run.nemesis = { ...nemesis, round: nemesisRound(run, nemesis), beaten: false };
  if (will && TILE_BY_ID[will]) run.will = will;
  run.hp = statsOf(run).maxHp;
  setOffer(run, 0);
  run.freeLeft = ch.freeRerolls;
  run.cur = freshCur(run);
  return { ok: true, run };
}

// ---------- Oferta kafelków ----------
function tileAvailable(run, t) {
  if (t.hatched || t.boss) return false;   // wyklute i legendarne z bossów nie trafiają do ofert
  if (t.repeat) return true;
  if (RECIPES.some(r => r.of.includes(t.id) && run.tiles.includes(r.out))) return false;   // składnik już wyklutego przedmiotu
  if (t.type === 'skill') { const s = run.skills.find(x => x.id === t.skill); return !s || s.lvl < RULES.maxSkillLvl; }
  return !run.tiles.includes(t.id);
}

export function makeOffer(run, salt, opt = {}) {
  const size = opt.size || RULES.offerSize, minR = opt.minRarity || 0;
  const rr = makeRng(mix(run.seed, run.round, salt));
  const S = statsOf(run), M = MODES[run.mode], ch = CHARS[run.char];
  const prog = (run.round - 1) / M.rounds;
  const w = RARITY_WEIGHTS[prog < 0.3 ? 0 : prog < 0.6 ? 1 : 2].slice();
  const L = Math.max(0, S.luck);
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
export const shopPrice = (t, run) => { const p = Math.ceil(RULES.prices[t.rarity] * priceMul(run) / 100); const d = run ? statsOf(run).buyDisc : 0; return d ? Math.max(1, fl(p * (100 - d) / 100)) : p; };
export const restCost = run => Math.max(0, RULES.restCost - statsOf(run).restDisc);
const freeRerolls = run => CHARS[run.char].freeRerolls + statsOf(run).freeReroll;
const auditFree = run => decreeIs(run, 'audyt') && run.rerolls < 2;   // Audyt: dwa pierwsze rerolle na piętrze za darmo
export function rerollCost(run) {
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
    else if (run.skills.length < RULES.maxSkills) run.skills.push({ id: t.skill, lvl: 1 });
    else if (Number.isInteger(slot) && slot >= 0 && slot < run.skills.length) run.skills[slot] = { id: t.skill, lvl: 1 };
    else return fail('Wszystkie 3 sloty są zajęte. Wybierz slot do zastąpienia.', 'slot');
    if (!run.tiles.includes(t.id)) run.tiles.push(t.id);
  } else {
    run.tiles.push(t.id);
    hatch(run);
    if (t.type === 'risk') run.stats.riskPicks++;
    if (t.id === 'pakt-z-lisem') run.stats.fox = 1;
    if (t.id === 'zakazana-pasza') run.flags.bossHpBonus = 30;
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
  if (run.round > M.rounds) return endRun(run, 'win');
  run.stats.maxRound = Math.max(run.stats.maxRound, run.round);
  run.phase = 'offer'; run.pending = null; run.rested = false; run.rerolls = 0; run.paid = 0; run.freeLeft = freeRerolls(run); run.door = null;
  // Lombard Lisa: niewykupiony zastaw przepada, a Lisy Windykatory rosną w siłę.
  if (run.pawned && run.round > run.pawned.round + 1) { run.foxDebt = (run.foxDebt || 0) + 1; run.lostPawn = run.pawned.id; run.pawned = null; }
  if (isDoor(run)) {
    const rr = makeRng(mix(run.seed, run.round, hash('door')));
    run.phase = 'door'; run.offer = []; run.flawAt = -1;
    run.pending = { kind: 'door', affix: rr.pick(Object.keys(AFFIXES)), reward: rr.int(2) ? 'rare' : 'coins', coins: RULES.doorCoins };
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
  return fl(base * (100 + RULES.garnekScore * run.garnek) / 100);
}

export function endRun(run, outcome) {
  run.phase = 'over'; run.ended = outcome; run.score = liveScore(run); run.offer = []; run.pending = null;
  return { ok: true, ended: outcome };
}

// ---------- Akcje gracza ----------
export function pickTile(run, i, slot, mut) {
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
    if (prize) { const e = applyTile(run, prize, undefined, 1); if (e && e.code === 'slot') applyTile(run, prize, 0, 1); }   // pełne sloty: umiejętność ze skrzynki zastępuje pierwszy slot; Mutacja ze skrzynki to zawsze gałąź 1
    if (trap) run.hp = Math.max(1, run.hp - Math.max(1, fl(statsOf(run).maxHp * 15 / 100)));
    run.stats.riskPicks++;
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
  if (run.phase === 'fight' && run.fight) return fail('Walka już się zaczęła.', 'fighting');
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
// 3 kopie tego samego kafelka statystyki poziomu 1 albo 2 zlewają się za darmo w 1 kafelek następnego poziomu rodziny (t.next).
// Poziom 3 → legendarny to nie ulepszanie (legendarne to tylko łup z bossów). Tylko w fazie oferty, więc powtórka walki się nie zmienia.
export const UPGRADE_COST = 3;
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
  const price = shopPrice(t, run);
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
    won = makeRng(mix(run.seed, run.round, hash('bet'))).int(100) < 50;
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
    return { ok: true, chose: i };
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
  const t = TILE_BY_ID[run.offer[i]];
  if (!t) return fail('Nie ma takiego kafelka.', 'index');
  const e = applyTile(run, t, slot, mut);
  if (e) return e;
  if (run.log.length) run.log[run.log.length - 1].bonus = t.id;
  return nextRound(run);
}

// ---------- Walka ----------
function scale(mode, round) {
  const g = MODES[mode].grow; let h = 1, a = 1;
  for (let i = 1; i < round; i++) { h *= g.hp; a *= g.atk; }
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
  if (M.bosses[r] || r <= M.early.rounds || isElite(run) || riskyDoor(run) || isNemesisRound(run)) return null;
  const zi = zoneOf(run.mode, r), keys = Object.keys(FLOOR_TPL).filter(k => k !== 'zwiad' || zi < 2);
  let tot = 0; for (const k of keys) tot += FLOOR_TPL[k].w;
  let x = makeRng(mix(run.seed, r, hash('tpl'))).int(tot);
  for (const k of keys) { x -= FLOOR_TPL[k].w; if (x < 0) return k === 'zwykle' ? null : k; }
  return null;
}
const soloPool = zone => Object.values(ENEMIES).filter(e => e.zone === zone && !e.minion && !e.swarm).map(e => e.id);

export function encounterIds(run) {
  const M = MODES[run.mode], r = run.round;
  if (M.bosses[r]) return [M.bosses[r]];
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
  if (tpl === 'para') { const a = rr.pick(solo); return [a, rr.pick(solo.filter(id => id !== a))]; }
  // Strefa I: do 2 wrogów naraz; strefy II i III: w późniejszych rundach strefy do 3.
  let count = k <= 1 ? 1 : k <= 3 ? 1 + rr.int(2) : (zi === 0 ? 2 : 2 + rr.int(2));
  count = Math.min(3, count);
  const ids = []; for (let i = 0; i < count; i++) ids.push(rr.pick(pool));
  const sw = ids.find(id => ENEMIES[id].swarm);
  const out = sw ? Array(ENEMIES[sw].swarm).fill(sw) : ids;
  return isElite(run) || riskyDoor(run) ? out.slice(0, 2) : out;   // elita (i ryzykowne drzwi) przychodzi najwyżej z jednym pomocnikiem
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
  for (const k of ['steal', 'slow', 'spec', 'shieldHits', 'shield', 'minion', 'ignite', 'rise', 'resist', 'audit']) if (def[k]) e[k] = def[k];
  return Object.assign(e, extra);
}

export function buildSetup(run) {
  const M = MODES[run.mode], gm = garnekMods(run.garnek), s = scale(run.mode, run.round);
  const ids = encounterIds(run), boss = M.bosses[run.round] || null, elite = isElite(run);
  let enemies;
  if (boss) {
    const def = BOSSES[boss];
    const be = concrete(def, s, gm, { boss, title: def.title, aspd: fl(def.aspd * (100 + gm.bossAspd) / 100) });
    if (run.flags.bossHpBonus) be.hp = fl(be.hp * (100 + run.flags.bossHpBonus) / 100);
    enemies = [be];
    if (boss === 'prezes') {
      const g = ENEMIES['kot-ochroniarz'];
      const guards = [0, 1].map(() => concrete(g, s, gm, { name: 'Ochroniarz', guard: true }));
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
    if (tpl === 'para') { const big = enemies[0].hp >= enemies[1].hp ? enemies[0] : enemies[1]; big.armor += TP.armor; for (const e of enemies) e.regenPct = (e.regenPct || 0) + TP.regen; }
    if (elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * 130 / 100); e0.atk = fl(e0.atk * 112 / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; e0.affixes = eliteAffixes(run); for (const a of e0.affixes) applyAffix(e0, a); }
    // Rozwidlenie Korytarza: za ryzykownymi drzwiami pierwszy wróg ma cechę elity.
    if (riskyDoor(run) && !elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * RULES.doorHp / 100); e0.atk = fl(e0.atk * RULES.doorAtk / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; e0.affixes = [run.door.affix]; applyAffix(e0, run.door.affix); }
    // Awans Wroga: Nemezis (z każdym awansem mocniejszy).
    if (isNemesisRound(run)) {
      const n = run.nemesis, e0 = enemies[0], lv = (n.lvl || 1) - 1;
      e0.hp = fl(e0.hp * (RULES.nemesisHp + 10 * lv) / 100); e0.atk = fl(e0.atk * (RULES.nemesisAtk + 5 * lv) / 100);
      e0.elite = true; e0.nemesis = true; e0.name = nemesisName(n); e0.affixes = [n.affix]; applyAffix(e0, n.affix);
    }
    // Lombard Lisa: każdy przepadły zastaw wzmacnia Lisy Windykatory.
    if (run.foxDebt) for (const e of enemies) if (e.id === 'lis-windykator') { const m = 100 + RULES.pawnFox * run.foxDebt; e.hp = fl(e.hp * m / 100); e.atk = fl(e.atk * m / 100); e.steal = { n: 1, max: 3 + run.foxDebt }; }
  }
  // Okólnik „Premia Motywacyjna”: wrogowie mają +15% Życia.
  if (decreeIs(run, 'premia')) for (const e of enemies) e.hp = fl(e.hp * 115 / 100);
  const S = statsOf(run);
  return {
    v: 1, round: run.round, mode: run.mode, seed: mix(run.seed, run.round, hash('fight')), boss, elite, zone: zoneOf(run.mode, run.round),
    door: riskyDoor(run), nemesis: isNemesisRound(run), tpl: floorTemplate(run) || undefined, fury: decreeIs(run, 'pilny') ? 300 : undefined,
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
    coinsBefore, coinsAfter: run.coins, hpBefore, hpAfter: res.hp, win: res.win, ticks: res.ticks, dealt: res.dealt, taken: res.taken, maxHit: res.maxHit, skillsUsed: res.skillsUsed, stolen: res.stolen, revived: res.usedRevive, timeout: res.timeout });
  setCoins(run, run.coins - Math.min(run.coins, res.stolen) + (res.coinsWon || 0));
  if (res.usedRevive) run.flags.revived = true;
  // Wadliwa Partia: wady kafelków wziętych przed tą walką ujawniają się i od teraz działają.
  const revealed = [];
  for (const w of (run.flawed || [])) if (!w.on) { w.on = true; revealed.push({ id: w.id, flaw: w.flaw }); }
  run.stats.reactions = [...new Set([...(run.stats.reactions || []), ...(res.reactSeen || [])])];
  run.stats.chains = (run.stats.chains || 0) + (res.chains || 0);
  if (run.stats.v2) {
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
  const out = { ok: true, result: res, reward: 0, boss: res.boss, round: run.round };
  if (revealed.length) out.revealed = revealed;
  if (!res.win) {
    // Awans Wroga: zwykły wróg, który zakończył run, awansuje (albo Nemezis awansuje wyżej).
    if (setup.nemesis) run.killer = { enemy: run.nemesis.enemy, nemesis: true };
    else if (!setup.boss) { const k = setup.enemies.filter(e => !e.minion && !e.guard && ENEMIES[e.id]).sort((a, b) => b.atk - a.atk)[0]; if (k) run.killer = { enemy: k.id, nemesis: false, next: makeNemesis(run, k.id) }; }
    run.log.push(entry()); endRun(run, 'lose'); out.ended = 'lose'; return out;
  }

  // Wygrana: nagrody, leczenie, rozliczenie wyniku.
  let coins = (setup.boss ? RULES.coinsBoss + S.bossCoins : RULES.coinsRound) + S.coinFlat;
  coins = fl(coins * (100 + S.coinPct + (setup.elite ? RULES.eliteCoinsPct : 0)) / 100);
  if (S.interest) coins += Math.min(5, fl(run.coins * S.interest / 100));
  if (decreeIs(run, 'premia')) coins += 3;
  // Odsetki w Spiżarni: +1 Ziarno za każde 10 niewydanych (po kradzieżach), najwyżej 3 (Kaczor 5).
  const interest = Math.min(CHARS[run.char].interestMax || RULES.interestMax, fl(run.coins / RULES.interestPer));
  coins += interest; out.interest = interest;
  if (setup.door && run.door.reward === 'coins') { coins += RULES.doorCoins; out.doorCoins = RULES.doorCoins; }
  coins = Math.max(0, coins);
  // Kafelki rosnące.
  const gw = (id, n, why) => { if (n > 0 && run.tiles.includes(id)) { const t = TILE_BY_ID[id]; const v = Math.min(t.grow.max, (run.grow[id] || 0) + n); if (v !== (run.grow[id] || 0)) { run.grow[id] = v; (out.grew = out.grew || []).push(id); } } };
  run.grow = run.grow || {};
  gw('pierze-weterana', res.lowest * 100 < S.maxHp * 40 ? 1 : 0);
  gw('trofeum-z-pior', Math.min(4, res.kills));
  gw('skarbonka-piskleca', run.rested ? 0 : 1);
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
  run.hp = Math.min(statsOf(run).maxHp, run.hp + fl(S.maxHp * Math.max(0, gm.healPct + S.healBonus - (decreeIs(run, 'homeoffice') ? 10 : 0)) / 100));
  if (res.hp * 10 < S.maxHp) run.stats.lowWin = true;
  if (res.taken > S.maxHp) run.stats.tankWin = true;
  if (run.tiles.includes('siewnik')) run.flags.bonusAtk++;
  run.done++;
  run.timeBonus += fl(RULES.scoreTimeMax * Math.max(0, 600 - res.ticks) / (MODES[run.mode].rounds * 600)) * (decreeIs(run, 'pilny') ? 2 : 1);
  if (res.boss && !run.stats.bossKills.includes(res.boss)) run.stats.bossKills.push(res.boss);
  run.log.push({ ...entry(), reward: coins, hpHealed: run.hp, coinsAfter: run.coins });

  if (run.round >= MODES[run.mode].rounds) { endRun(run, 'win'); out.ended = 'win'; return out; }
  const bonus = MODES[run.mode].bonusAfter.includes(run.round) || (setup.door && run.door.reward === 'rare');
  const loot = !!setup.boss;   // ostatni boss kończy run wcześniej (return powyżej)
  const avail = BADGE_POOL.filter(b => !(run.badges || []).includes(b));
  run.fight = null;
  if ((setup.boss || setup.elite) && avail.length) {
    const rr = makeRng(mix(run.seed, run.round, hash('badge')));
    const offer = []; while (offer.length < Math.min(BADGE_OFFER, avail.length)) { const b = rr.pick(avail); if (!offer.includes(b)) offer.push(b); }
    run.phase = 'badge'; run.pending = { kind: 'badge', offer, bonus, loot }; run.offer = [];
    out.badge = true;
    return out;
  }
  const r2 = afterFight(run, bonus, loot);
  if (r2.bonus) out.bonus = true;
  if (r2.loot) out.loot = true;
  return out;
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
export const hideFoes = run => (run.garnek | 0) >= 1;
// Bez ziarna runu: oferty i spotkania z przyszłości nie dają się wyliczyć po stronie przeglądarki.
export function view(run) {
  if (!run) return null;
  const M = MODES[run.mode], S = statsOf(run), over = run.phase === 'over';
  const v = {
    id: run.id, mode: run.mode, char: run.char, garnek: run.garnek, round: run.round, rounds: M.rounds, phase: run.phase,
    hp: run.hp, maxHp: S.maxHp, coins: run.coins, tiles: run.tiles, skills: run.skills, offer: run.offer, pending: run.pending,
    rerollCost: run.phase === 'offer' ? rerollCost(run) : null, freeLeft: run.freeLeft, rested: run.rested, restCost: restCost(run), restPct: RULES.restPct + S.restBonus, badges: run.badges || [], affixes: !over && isElite(run) && !hideFoes(run) ? eliteAffixes(run) : null, buyDisc: S.buyDisc, stats: run.stats, flags: { bossHpBonus: run.flags.bossHpBonus, revived: run.flags.revived, bonusAtk: run.flags.bonusAtk },
    score: over ? run.score : liveScore(run), done: run.done, timeBonus: run.timeBonus, ended: run.ended, killer: over && run.killer ? { enemy: run.killer.enemy, nemesis: !!run.killer.nemesis } : null, form: formFor(run.mode, run.round).id, zone: zoneOf(run.mode, run.round),
    boss: M.bosses[run.round] || null, elite: !over && isElite(run), hero: S,
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
    else { v.enemies = M.bosses[run.round] ? encounterIds(run) : null; v.tpl = null; v.hidden = !M.bosses[run.round]; }
  }
  return v;
}
