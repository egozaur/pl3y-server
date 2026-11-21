// Bulgot: reguły runu. Czyste funkcje na zwykłym obiekcie `run` (JSON), bez dostępu do pamięci i sieci.
// Wszystkie losowania biorą ziarno z run.seed, więc ten sam run daje te same oferty i spotkania.
// Każda funkcja zwraca { ok: true, ... } albo { err, code }. Stan zapisuje i autoryzuje BgPlayer (player.js).
import { mix, hash, makeRng } from './rng.js';
import { RECIPES, BADGES, BADGE_OFFER, AFFIXES, MODES, CHARS, TILE_BY_ID, ENEMIES, BOSSES, RULES, RARITY_WEIGHTS, TYPE_WEIGHTS, garnekMods, formFor } from './data.js';
import { heroStats } from './stats.js';
import { runFight } from './sim.js';

const fl = Math.floor;
const fail = (err, code) => ({ err, code });

export const loadoutOf = run => ({
  char: run.char, tiles: run.tiles, skills: run.skills, coins: run.coins,
  bonusAtk: run.flags.bonusAtk, noRegen: garnekMods(run.garnek).noRegen, badges: run.badges || [],
});
export const statsOf = run => heroStats(loadoutOf(run));

// Notatki bieżącej rundy (do historii gier): co zaoferowano, co wybrano, co dokupiono, ile rerolli.
const freshCur = run => ({ offer: run.offer.slice(), picked: null, rerolls: 0, bought: [], event: null });
const cur = run => run.cur || (run.cur = freshCur(run));

// ---------- Nowy run ----------
export function newRun({ mode, char, garnek, pool, seed, now = 0 }) {
  const M = MODES[mode], ch = CHARS[char];
  if (!M) return fail('Nieznany tryb.', 'mode');
  if (!ch) return fail('Nieznana postać.', 'char');
  const run = {
    v: 1, id: String(seed), mode, char, garnek: garnek | 0, seed: seed >>> 0, round: 1, phase: 'offer',
    hp: 1, coins: ch.coins, tiles: [], skills: ch.startSkills.map(([id, lvl]) => ({ id, lvl })), offer: [], rerolls: 0, paid: 0, freeLeft: ch.freeRerolls,
    pending: null, rested: false, pool: pool.slice(), badges: [], started: now, ended: null, score: 0, timeBonus: 0, done: 0,
    flags: { bonusAtk: 0, bossHpBonus: 0, revived: false },
    stats: { riskPicks: 0, fox: 0, maxCoins: ch.coins, maxHit: 0, lowWin: false, maxRound: 1, bossKills: [], picks: 0, rerolls: 0 },
    log: [],
  };
  run.hp = statsOf(run).maxHp;
  run.offer = makeOffer(run, 0);
  run.freeLeft = ch.freeRerolls;
  run.cur = freshCur(run);
  return { ok: true, run };
}

// ---------- Oferta kafelków ----------
function tileAvailable(run, t) {
  if (t.hatched) return false;
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
  return out;
}

export const shopPrice = (t, run) => { const p = RULES.prices[t.rarity]; const d = run ? statsOf(run).buyDisc : 0; return d ? Math.max(1, fl(p * (100 - d) / 100)) : p; };
export const restCost = run => Math.max(0, RULES.restCost - statsOf(run).restDisc);
const freeRerolls = run => CHARS[run.char].freeRerolls + statsOf(run).freeReroll;
export function rerollCost(run) {
  if (run.freeLeft > 0) return 0;
  return RULES.rerollBase + garnekMods(run.garnek).rerollExtra + run.paid;
}

// ---------- Pomocnicze ----------
function setCoins(run, v) { run.coins = Math.max(0, v); if (run.coins > run.stats.maxCoins) run.stats.maxCoins = run.coins; }

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
    for (const id of r.of) run.tiles.splice(run.tiles.indexOf(id), 1);
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
  run.phase = 'offer'; run.pending = null; run.rested = false; run.rerolls = 0; run.paid = 0; run.freeLeft = freeRerolls(run);
  run.offer = makeOffer(run, 0);
  run.cur = freshCur(run);
  return { ok: true };
}

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
    const stats = run.pool.map(x => TILE_BY_ID[x]).filter(x => x && x.type === 'stat' && tileAvailable(run, x));
    const got = [];
    for (let k = 0; k < 2 && stats.length; k++) { const x = rr.pick(stats); applyTile(run, x); got.push(x.id); }
    run.stats.riskPicks++;
    enterFight(run);
    return { ok: true, automat: got };
  }
  if (t.event === 'kontrakt') { run.pending = { kind: 'contract' }; run.phase = 'event'; run.offer = []; run.stats.riskPicks++; return { ok: true, event: 'contract' }; }
  if (t.event === 'kapliczka') {
    const rr = makeRng(mix(run.seed, run.round, hash('shrine')));
    const av = Object.keys(BADGES).filter(b => !(run.badges || []).includes(b));
    run.pending = { kind: 'shrine', badge: av.length ? rr.pick(av) : null }; run.phase = 'event'; run.offer = [];
    return { ok: true, event: 'shrine' };
  }
  if (t.event === 'hazard') { run.pending = { kind: 'gamble' }; run.phase = 'event'; run.offer = []; return { ok: true, event: 'gamble' }; }
  if (t.event === 'skrzynka') {
    const rr = makeRng(mix(run.seed, run.round, hash('crate')));
    const trap = rr.int(100) < 25;
    const epics = run.pool.map(x => TILE_BY_ID[x]).filter(x => x && x.rarity >= 2 && !x.event && tileAvailable(run, x));   // wyklutych nie ma w puli (tileAvailable)
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
  enterFight(run);
  return { ok: true, tile: t.id };
}

export function reroll(run) {
  if (run.phase !== 'offer') return fail('Teraz nie ma rerolla.', 'phase');
  const cost = rerollCost(run);
  if (run.coins < cost) return fail('Za mało Ziaren na reroll.', 'coins');
  if (cost === 0) run.freeLeft--; else { run.paid++; setCoins(run, run.coins - cost); }
  run.rerolls++; run.stats.rerolls++; cur(run).rerolls++;
  run.offer = makeOffer(run, 100 + run.rerolls);
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
  run.hp = Math.min(S.maxHp, run.hp + Math.max(1, fl(S.maxHp * (RULES.restPct + S.restBonus) / 100)));
  run.rested = true; cur(run).rested = (cur(run).rested || 0) + (run.hp - before);
  return { ok: true, healed: run.hp - before, cost: rc };
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
  if (run.phase === 'badge' && P && P.kind === 'badge') {
    const b = P.offer[i];
    if (!b || !BADGES[b]) return fail('Nie ma takiej Odznaki.', 'index');
    addBadge(run, b);
    run.pending = null;
    return afterFight(run, P.bonus);
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
// Po wygranej walce (i ewentualnej Odznace): oferta bonusowa po bossie albo następna runda.
function afterFight(run, bonus) {
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

export function encounterIds(run) {
  const M = MODES[run.mode], r = run.round;
  if (M.bosses[r]) return [M.bosses[r]];
  if (r === 1) return ['szczur-pasz'];
  const zi = zoneOf(run.mode, r), k = r - zoneStart(run.mode, r) + 1;
  const pool = Object.values(ENEMIES).filter(e => e.zone === zi && !e.minion).map(e => e.id);
  const rr = makeRng(mix(run.seed, r, hash('enc')));
  // Strefa I: do 2 wrogów naraz; strefy II i III: w późniejszych rundach strefy do 3.
  let count = k <= 1 ? 1 : k <= 3 ? 1 + rr.int(2) : (zi === 0 ? 2 : 2 + rr.int(2));
  count = Math.min(3, count);
  const ids = []; for (let i = 0; i < count; i++) ids.push(rr.pick(pool));
  const sw = ids.find(id => ENEMIES[id].swarm);
  return sw ? Array(ENEMIES[sw].swarm).fill(sw) : ids;
}

// Cechy elity: losowane z ziarna runu (widoczne w podglądzie piętra, bo dotyczą bieżącego spotkania).
export function eliteAffixes(run) {
  const rr = makeRng(mix(run.seed, run.round, hash('affix'))), keys = Object.keys(AFFIXES), out = [];
  const n = garnekMods(run.garnek).eliteAffixes;
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
    if (elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * 150 / 100); e0.atk = fl(e0.atk * 125 / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; e0.affixes = eliteAffixes(run); for (const a of e0.affixes) applyAffix(e0, a); }
  }
  const S = statsOf(run);
  return {
    v: 1, round: run.round, mode: run.mode, seed: mix(run.seed, run.round, hash('fight')), boss, elite, zone: zoneOf(run.mode, run.round),
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
  const entry = () => ({ r: run.round, zone: setup.zone, boss: setup.boss, elite: setup.elite, enemies: setup.enemies.map(e => ({ n: e.name, hp: e.hp, atk: e.atk })),
    offer: c.offer, picked: c.picked, bought: c.bought, rerolls: c.rerolls, rested: c.rested || 0, event: c.event, bet: c.bet || null,
    hero: { maxHp: S.maxHp, atk: S.atk, aspd: S.aspd, armor: S.armor, crit: S.crit, evade: S.evade, regen: S.regen }, tiles: run.tiles.length, skills: run.skills.map(s => s.id + (s.lvl > 1 ? '*' : '')),
    coinsBefore, coinsAfter: run.coins, hpBefore, hpAfter: res.hp, win: res.win, ticks: res.ticks, dealt: res.dealt, taken: res.taken, maxHit: res.maxHit, skillsUsed: res.skillsUsed, stolen: res.stolen, revived: res.usedRevive, timeout: res.timeout });
  setCoins(run, run.coins - Math.min(run.coins, res.stolen) + (res.coinsWon || 0));
  if (res.usedRevive) run.flags.revived = true;
  if (setup.boss && run.flags.bossHpBonus) run.flags.bossHpBonus = 0;
  if (res.maxHit > run.stats.maxHit) run.stats.maxHit = res.maxHit;
  run.hp = res.hp;
  const out = { ok: true, result: res, reward: 0, boss: res.boss, round: run.round };
  if (!res.win) { run.log.push(entry()); endRun(run, 'lose'); out.ended = 'lose'; return out; }

  // Wygrana: nagrody, leczenie, rozliczenie wyniku.
  let coins = (setup.boss ? RULES.coinsBoss + S.bossCoins : RULES.coinsRound) + S.coinFlat;
  coins = fl(coins * (100 + S.coinPct + (setup.elite ? RULES.eliteCoinsPct : 0)) / 100);
  if (S.interest) coins += Math.min(5, fl(run.coins * S.interest / 100));
  if (setup.boss && run.coins >= 30) run.stats.richBoss = true;
  run.stats.maxBurn = Math.max(run.stats.maxBurn || 0, res.burnDealt || 0);
  run.stats.freezes = (run.stats.freezes || 0) + (res.freezes || 0);
  setCoins(run, run.coins + coins); out.reward = coins;
  run.hp = Math.min(S.maxHp, run.hp + fl(S.maxHp * (gm.healPct + S.healBonus) / 100));
  if (res.hp * 10 < S.maxHp) run.stats.lowWin = true;
  if (res.taken > S.maxHp) run.stats.tankWin = true;
  if (run.tiles.includes('siewnik')) run.flags.bonusAtk++;
  run.done++;
  run.timeBonus += fl(RULES.scoreTimeMax * Math.max(0, 600 - res.ticks) / (MODES[run.mode].rounds * 600));
  if (res.boss && !run.stats.bossKills.includes(res.boss)) run.stats.bossKills.push(res.boss);
  run.log.push({ ...entry(), reward: coins, hpHealed: run.hp, coinsAfter: run.coins });

  if (run.round >= MODES[run.mode].rounds) { endRun(run, 'win'); out.ended = 'win'; return out; }
  const bonus = MODES[run.mode].bonusAfter.includes(run.round);
  const avail = Object.keys(BADGES).filter(b => !(run.badges || []).includes(b));
  run.fight = null;
  if ((setup.boss || setup.elite) && avail.length) {
    const rr = makeRng(mix(run.seed, run.round, hash('badge')));
    const offer = []; while (offer.length < Math.min(BADGE_OFFER, avail.length)) { const b = rr.pick(avail); if (!offer.includes(b)) offer.push(b); }
    run.phase = 'badge'; run.pending = { kind: 'badge', offer, bonus }; run.offer = [];
    out.badge = true;
    return out;
  }
  const r2 = afterFight(run, bonus);
  if (r2.bonus) out.bonus = true;
  return out;
}

export function abandon(run) {
  if (run.phase === 'over') return fail('Run już się skończył.', 'phase');
  endRun(run, 'lose');
  return { ok: true, ended: 'lose' };
}

// ---------- Widok dla klienta ----------
// Bez ziarna runu: oferty i spotkania z przyszłości nie dają się wyliczyć po stronie przeglądarki.
export function view(run) {
  if (!run) return null;
  const M = MODES[run.mode], S = statsOf(run), over = run.phase === 'over';
  const v = {
    id: run.id, mode: run.mode, char: run.char, garnek: run.garnek, round: run.round, rounds: M.rounds, phase: run.phase,
    hp: run.hp, maxHp: S.maxHp, coins: run.coins, tiles: run.tiles, skills: run.skills, offer: run.offer, pending: run.pending,
    rerollCost: run.phase === 'offer' ? rerollCost(run) : null, freeLeft: run.freeLeft, rested: run.rested, restCost: restCost(run), restPct: RULES.restPct + S.restBonus, badges: run.badges || [], affixes: !over && isElite(run) ? eliteAffixes(run) : null, buyDisc: S.buyDisc, stats: run.stats, flags: { bossHpBonus: run.flags.bossHpBonus, revived: run.flags.revived, bonusAtk: run.flags.bonusAtk },
    score: over ? run.score : liveScore(run), done: run.done, timeBonus: run.timeBonus, ended: run.ended, form: formFor(run.mode, run.round).id, zone: zoneOf(run.mode, run.round),
    boss: M.bosses[run.round] || null, elite: !over && isElite(run), hero: S,
  };
  if (!over) v.enemies = encounterIds(run);
  return v;
}
