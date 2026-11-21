// Bulgot: reguły runu. Czyste funkcje na zwykłym obiekcie `run` (JSON), bez dostępu do pamięci i sieci.
// Wszystkie losowania biorą ziarno z run.seed, więc ten sam run daje te same oferty i spotkania.
// Każda funkcja zwraca { ok: true, ... } albo { err, code }. Stan zapisuje i autoryzuje BgPlayer (player.js).
import { mix, hash, makeRng } from './rng.js';
import { MODES, CHARS, TILE_BY_ID, ENEMIES, BOSSES, RULES, RARITY_WEIGHTS, TYPE_WEIGHTS, garnekMods, formFor } from './data.js';
import { heroStats } from './stats.js';
import { runFight } from './sim.js';

const fl = Math.floor;
const fail = (err, code) => ({ err, code });

export const loadoutOf = run => ({
  char: run.char, tiles: run.tiles, skills: run.skills, coins: run.coins,
  bonusAtk: run.flags.bonusAtk, noRegen: garnekMods(run.garnek).noRegen,
});
export const statsOf = run => heroStats(loadoutOf(run));

// ---------- Nowy run ----------
export function newRun({ mode, char, garnek, pool, seed, now = 0 }) {
  const M = MODES[mode], ch = CHARS[char];
  if (!M) return fail('Nieznany tryb.', 'mode');
  if (!ch) return fail('Nieznana postać.', 'char');
  const run = {
    v: 1, id: String(seed), mode, char, garnek: garnek | 0, seed: seed >>> 0, round: 1, phase: 'offer',
    hp: 1, coins: ch.coins, tiles: [], skills: ch.startSkills.map(([id, lvl]) => ({ id, lvl })), offer: [], rerolls: 0, paid: 0, freeLeft: ch.freeRerolls,
    pending: null, pool: pool.slice(), started: now, ended: null, score: 0, timeBonus: 0, done: 0,
    flags: { bonusAtk: 0, bossHpBonus: 0, revived: false },
    stats: { riskPicks: 0, fox: 0, maxCoins: ch.coins, maxHit: 0, lowWin: false, maxRound: 1, bossKills: [], picks: 0, rerolls: 0 },
    log: [],
  };
  run.hp = statsOf(run).maxHp;
  run.offer = makeOffer(run, 0);
  run.freeLeft = ch.freeRerolls;
  return { ok: true, run };
}

// ---------- Oferta kafelków ----------
function tileAvailable(run, t) {
  if (t.repeat) return true;
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
  return out;
}

export const shopPrice = t => [4, 8, 13, 20][t.rarity];
export function rerollCost(run) {
  if (run.freeLeft > 0) return 0;
  return RULES.rerollBase + garnekMods(run.garnek).rerollExtra + run.paid;
}

// ---------- Pomocnicze ----------
function setCoins(run, v) { run.coins = Math.max(0, v); if (run.coins > run.stats.maxCoins) run.stats.maxCoins = run.coins; }

// Stosuje kafelek do runu (wybór z oferty, bonusu albo zakup). Zwraca null albo błąd.
function applyTile(run, t, slot) {
  const before = statsOf(run).maxHp;
  if (t.type === 'skill') {
    const own = run.skills.find(s => s.id === t.skill);
    if (own) own.lvl = Math.min(RULES.maxSkillLvl, own.lvl + 1);
    else if (run.skills.length < RULES.maxSkills) run.skills.push({ id: t.skill, lvl: 1 });
    else if (Number.isInteger(slot) && slot >= 0 && slot < run.skills.length) run.skills[slot] = { id: t.skill, lvl: 1 };
    else return fail('Wszystkie 3 sloty są zajęte. Wybierz slot do zastąpienia.', 'slot');
    if (!run.tiles.includes(t.id)) run.tiles.push(t.id);
  } else {
    run.tiles.push(t.id);
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

function nextRound(run) {
  run.round++;
  const M = MODES[run.mode];
  if (run.round > M.rounds) return endRun(run, 'win');
  run.stats.maxRound = Math.max(run.stats.maxRound, run.round);
  run.phase = 'offer'; run.pending = null; run.rerolls = 0; run.paid = 0; run.freeLeft = CHARS[run.char].freeRerolls;
  run.offer = makeOffer(run, 0);
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
export function pickTile(run, i, slot) {
  if (run.phase !== 'offer') return fail('Teraz nie wybierasz kafelka.', 'phase');
  const id = run.offer[i];
  const t = id && TILE_BY_ID[id];
  if (!t) return fail('Nie ma takiego kafelka.', 'index');
  if (t.event === 'sklepik') {
    run.pending = { kind: 'shop', offer: makeOffer(run, 200, { size: 3, noEvents: true }) };
    run.phase = 'event'; run.offer = [];
    return { ok: true, event: 'shop' };
  }
  if (t.event === 'hazard') { run.pending = { kind: 'gamble' }; run.phase = 'event'; run.offer = []; return { ok: true, event: 'gamble' }; }
  if (t.event === 'skrzynka') {
    const rr = makeRng(mix(run.seed, run.round, hash('crate')));
    const trap = rr.int(100) < 25;
    const epics = run.pool.map(x => TILE_BY_ID[x]).filter(x => x && x.rarity >= 2 && !x.event && tileAvailable(run, x));
    const prize = epics.length ? rr.pick(epics) : null;
    const note = { crate: { tile: prize ? prize.id : null, trap } };
    if (prize) { const e = applyTile(run, prize, undefined); if (e) { if (e.code === 'slot') { /* pełne sloty: umiejętność z skrzynki zastępuje pierwszy slot */ applyTile(run, prize, 0); } } }
    if (trap) run.hp = Math.max(1, run.hp - Math.max(1, fl(statsOf(run).maxHp * 15 / 100)));
    run.stats.riskPicks++;
    enterFight(run);
    return { ok: true, ...note };
  }
  const e = applyTile(run, t, slot);
  if (e) return e;
  enterFight(run);
  return { ok: true, tile: t.id };
}

export function reroll(run) {
  if (run.phase !== 'offer') return fail('Teraz nie ma rerolla.', 'phase');
  const cost = rerollCost(run);
  if (run.coins < cost) return fail('Za mało Ziaren na reroll.', 'coins');
  if (cost === 0) run.freeLeft--; else { run.paid++; setCoins(run, run.coins - cost); }
  run.rerolls++; run.stats.rerolls++;
  run.offer = makeOffer(run, 100 + run.rerolls);
  return { ok: true, cost };
}

export function shopBuy(run, i, slot) {
  if (run.phase !== 'event' || !run.pending || run.pending.kind !== 'shop') return fail('Nie jesteś w sklepiku.', 'phase');
  if (i === -1) { enterFight(run); return { ok: true, left: true }; }
  const t = TILE_BY_ID[run.pending.offer[i]];
  if (!t) return fail('Nie ma takiego towaru.', 'index');
  const price = shopPrice(t);
  if (run.coins < price) return fail('Babcia mówi: bez ziarna nie ma rozmowy.', 'coins');
  const e = applyTile(run, t, slot);
  if (e) return e;
  setCoins(run, run.coins - price);
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
  enterFight(run);
  return { ok: true, bet: a, won };
}

export function bonusPick(run, i, slot) {
  if (run.phase !== 'bonus') return fail('Teraz nie ma oferty bonusowej.', 'phase');
  const t = TILE_BY_ID[run.offer[i]];
  if (!t) return fail('Nie ma takiego kafelka.', 'index');
  const e = applyTile(run, t, slot);
  if (e) return e;
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

const isElite = run => garnekMods(run.garnek).elites && MODES[run.mode].elite.includes(run.round) && !MODES[run.mode].bosses[run.round];

function concrete(def, s, gm, extra = {}) {
  const hp = Math.max(1, Math.round(def.hp * s.h * (100 + gm.enemyHp) / 100));
  const atk = Math.max(1, Math.round(def.atk * s.a * (100 + gm.enemyAtk) / 100));
  const e = { id: def.id, name: def.name, hp, atk, aspd: def.aspd, armor: def.armor, evade: def.evade, crit: def.crit, art: def.art };
  for (const k of ['steal', 'slow', 'spec', 'shieldHits', 'shield', 'minion']) if (def[k]) e[k] = def[k];
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
    }
    const bp = M.bossPct;
    for (const e of enemies) { e.hp = Math.max(1, fl(e.hp * bp.hp / 100)); e.atk = Math.max(1, fl(e.atk * bp.atk / 100)); }
  } else {
    enemies = ids.map((id, i) => concrete(ENEMIES[id], s, gm, elite && i === 0 ? {} : {}));
    if (elite) { const e0 = enemies[0]; e0.hp = fl(e0.hp * 150 / 100); e0.atk = fl(e0.atk * 125 / 100); e0.elite = true; e0.name = 'Elitarny ' + e0.name; }
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
  const S = statsOf(run), gm = garnekMods(run.garnek);
  setCoins(run, run.coins - Math.min(run.coins, res.stolen));
  if (res.usedRevive) run.flags.revived = true;
  if (setup.boss && run.flags.bossHpBonus) run.flags.bossHpBonus = 0;
  if (res.maxHit > run.stats.maxHit) run.stats.maxHit = res.maxHit;
  run.hp = res.hp;
  const out = { ok: true, result: res, reward: 0, boss: res.boss, round: run.round };
  if (!res.win) { run.log.push({ r: run.round, win: false }); endRun(run, 'lose'); out.ended = 'lose'; return out; }

  // Wygrana: nagrody, leczenie, rozliczenie wyniku.
  let coins = (setup.boss ? RULES.coinsBoss : RULES.coinsRound) + S.coinFlat;
  coins = fl(coins * (100 + S.coinPct + (setup.elite ? RULES.eliteCoinsPct : 0)) / 100);
  setCoins(run, run.coins + coins); out.reward = coins;
  run.hp = Math.min(S.maxHp, run.hp + fl(S.maxHp * gm.healPct / 100));
  if (res.hp * 10 < S.maxHp) run.stats.lowWin = true;
  if (run.tiles.includes('siewnik')) run.flags.bonusAtk++;
  run.done++;
  run.timeBonus += fl(RULES.scoreTimeMax * Math.max(0, 600 - res.ticks) / (MODES[run.mode].rounds * 600));
  if (res.boss && !run.stats.bossKills.includes(res.boss)) run.stats.bossKills.push(res.boss);
  run.log.push({ r: run.round, win: true, t: res.ticks, hp: res.hp });

  if (run.round >= MODES[run.mode].rounds) { endRun(run, 'win'); out.ended = 'win'; return out; }
  if (MODES[run.mode].bonusAfter.includes(run.round)) {
    run.phase = 'bonus'; run.offer = makeOffer(run, 300, { size: RULES.bonusSize, minRarity: 1, noEvents: true }); run.fight = null;
    out.bonus = true;
  } else { nextRound(run); }
  run.fight = null;
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
    rerollCost: run.phase === 'offer' ? rerollCost(run) : null, freeLeft: run.freeLeft, stats: run.stats, flags: { bossHpBonus: run.flags.bossHpBonus, revived: run.flags.revived, bonusAtk: run.flags.bonusAtk },
    score: over ? run.score : liveScore(run), done: run.done, timeBonus: run.timeBonus, ended: run.ended, form: formFor(run.mode, run.round).id, zone: zoneOf(run.mode, run.round),
    boss: M.bosses[run.round] || null, elite: !over && isElite(run), hero: S,
  };
  if (!over) v.enemies = encounterIds(run);
  return v;
}
