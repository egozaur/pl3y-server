// Bulgot: profil gracza (Księga Kurnika): odblokowania, liczniki, najlepsze wyniki, Temperatura Garnka.
// Czyste funkcje na obiekcie `profile`; zapis robi BgPlayer.
import { STARTER_TILES, UNLOCKS, UNLOCK_BY_ID, MODES, RULES, KURNIK, KURNIK_MAX } from './data.js';
import { nemesisName } from './rules.js';
import { evaluateAch, completion } from './achievements.js';
import { ACHIEVEMENTS } from './data.js';

export function newProfile() {
  return { v: 1, chars: ['pyrtek'], tiles: [], garnek: 0, best: {}, counters: { runs: 0, wins: 0, fox: 0 }, bosses: {}, flags: {}, seen: [], unlocked: [], ach: [], clears: {}, feathers: 0, kurnik: {} };
}

// Pula kafelków dostępnych w nowym runie.
export const poolFor = p => [...STARTER_TILES, ...p.tiles];

// Warunki odblokowań. p = profil, r = bieżący run (może być null).
const CHECKS = {
  'u-kwoka': p => !!p.flags.winFull,
  'u-kaczor': (p, r) => !!r && r.stats.riskPicks >= 5,
  'u-indor': p => !!p.flags.winQuick,
  'u-420': (p, r) => !!r && (r.stats.earned || 0) >= RULES.u420,   // Zjarany Kurczak: łącznie zdobyte Ziarna w jednym runie
  'u-barista': (p, r) => !!r && !!r.stats.v2 && r.stats.fastWin !== undefined && r.stats.fastWin < 10,
  'u-ges': (p, r) => !!r && r.stats.maxCoins >= 200,
  'u-lodziarz': (p, r) => !!r && (r.stats.freezes || 0) >= 8,
  'u-pielegniarka': (p, r) => !!r && !!r.stats.lowWin,
  'u-rzeznik': p => (p.bosses.skubarka || 0) > 0,
  'u-wrozka': (p, r) => !!r && (r.stats.badges || 0) >= 3,
  'u-stazysta': p => p.counters.runs - p.counters.wins >= 5,
  'u-mutant': (p, r) => !!r && (r.stats.muts || 0) >= 3,
  'u-dino': (p, r) => !!r && !!r.stats.dino,
  'u-koniczyna': (p, r) => !!r && r.stats.maxCoins >= 100,
  'u-unik': p => (p.bosses.brojler || 0) > 0,
  'u-zagrzebanie': (p, r) => !!r && r.stats.lowWin,
  'u-gniazdo': (p, r) => !!r && r.mode === 'full' && r.stats.maxRound >= 10,
  'u-siewnik': p => !!p.flags.winQuick,
  'u-okulary': (p, r) => !!r && r.stats.maxHit >= 150,
  'u-szklane': p => p.counters.fox >= 3,
  'u-skrzynka': p => p.counters.runs >= 5,
  'u-pasza': p => (p.bosses.skubarka || 0) > 0,
  'u-hazard': p => !!p.flags.loseRich,
  'u-garnek': (p, r) => !!r && (r.stats.maxBurn || 0) >= 250,
  'u-szron': (p, r) => !!r && (r.stats.freezes || 0) >= 8,
  'u-premiakw': (p, r) => !!r && !!r.stats.richBoss,
  'u-kontrakt': (p, r) => !!r && (r.stats.badges || 0) >= 3,
  'u-kontra': (p, r) => !!r && !!r.stats.tankWin,
  'u-premia': (p, r) => !!r && r.stats.maxCoins >= 40,
  'u-egzekucja': (p, r) => !!r && (r.stats.muts || 0) > 0,
};

// Sprawdza wszystkie odblokowania; zwraca listę świeżo odblokowanych wpisów UNLOCKS.
export function evaluate(p, r) {
  const fresh = [];
  if (r && r.stats.hatched) for (const id of r.stats.hatched) { p.recipes = p.recipes || []; if (!p.recipes.includes(id)) p.recipes.push(id); }
  if (r && r.stats.reactions) for (const id of r.stats.reactions) { p.reactions = p.reactions || []; if (!p.reactions.includes(id)) p.reactions.push(id); }
  for (const u of UNLOCKS) {
    if (p.unlocked.includes(u.id)) continue;
    const ok = CHECKS[u.id];
    if (ok && ok(p, r)) {
      p.unlocked.push(u.id);
      if (u.kind === 'char' && !p.chars.includes(u.target)) p.chars.push(u.target);
      if (u.kind === 'tile' && !p.tiles.includes(u.target)) p.tiles.push(u.target);
      fresh.push(u);
    }
  }
  return fresh;
}

// Pokonany Nemezis znika z profilu.
export function onNemesisBeaten(p) { p.nemesis = null; p.counters.nemesisKills = (p.counters.nemesisKills || 0) + 1; }

// Wywoływane po rozstrzygnięciu walki z bossem.
export function onBossKill(p, bossId) { p.bosses[bossId] = (p.bosses[bossId] || 0) + 1; }

// Kurnik: kupno kolejnego poziomu budynku za Pióra. Zwraca { ok, id, lvl, cost } albo { err, code }.
export function kurnikBuy(p, id) {
  const B = KURNIK[id];
  if (!B) return { err: 'Nie ma takiego budynku.', code: 'index' };
  p.kurnik = p.kurnik || {};
  const lvl = p.kurnik[id] | 0;
  if (lvl >= KURNIK_MAX) return { err: 'Ten budynek ma już maksymalny poziom.', code: 'max' };
  const cost = B.cost[lvl];
  if ((p.feathers | 0) < cost) return { err: 'Za mało Piór: potrzebujesz ' + cost + '.', code: 'feathers' };
  p.feathers -= cost; p.kurnik[id] = lvl + 1;
  p.counters.kurnikBuys = (p.counters.kurnikBuys || 0) + 1;
  return { ok: true, id, lvl: lvl + 1, cost };
}

// Koniec runu: liczniki, najlepszy wynik, kolejny poziom Garnka, Pióra do Kurnika. Zwraca { newBest, garnekUnlocked, feathers }.
export function onRunEnd(p, r) {
  p.counters.runs++;
  if (r.stats.fox) p.counters.fox++;
  const win = r.ended === 'win';
  if (win) {
    p.counters.wins++;
    if (r.mode === 'full') p.flags.winFull = true;
    if (r.mode === 'quick') p.flags.winQuick = true;
    p.clears = p.clears || {}; p.clears[r.mode + ':' + r.char + ':' + (r.garnek | 0)] = true;
  } else if (r.coins > 30) p.flags.loseRich = true;
  // Awans Wroga: wróg, który zakończył run, zostaje Nemezis (a Nemezis, który wygrał znowu, awansuje wyżej).
  if (!win && r.killer) {
    if (r.killer.nemesis && p.nemesis) { p.nemesis.lvl = (p.nemesis.lvl || 1) + 1; p.counters.nemesisWins = (p.counters.nemesisWins || 0) + 1; }
    else if (r.killer.next) p.nemesis = r.killer.next;
  }
  let garnekUnlocked = false;
  if (win && r.garnek === p.garnek && p.garnek < 5) { p.garnek++; garnekUnlocked = true; }
  const prev = p.best[r.mode];
  const newBest = r.done > 0 && (!prev || r.score > prev.score);
  if (newBest) p.best[r.mode] = { score: r.score, rounds: r.done, win, char: r.char, garnek: r.garnek };
  for (const id of r.tiles) if (!p.seen.includes(id)) p.seen.push(id);
  // Pióra: ukończone piętra + premia za wygraną (z palnikiem) + piętra Dogrywki.
  const deep = r.endless && r.cleared != null ? Math.max(0, r.done - r.cleared) : 0;
  const feathers = r.done + (win ? RULES.featherWin + RULES.featherGarnek * (r.garnek | 0) : 0) + RULES.featherEndless * deep;
  p.feathers = (p.feathers | 0) + feathers; p.counters.feathers = (p.counters.feathers || 0) + feathers;
  if (deep > (p.counters.deepest || 0)) p.counters.deepest = deep;
  return { newBest, garnekUnlocked, feathers, deep, prevBest: prev ? prev.score : 0 };
}

// Osiągnięcia sprawdzane po zakończeniu runu (profil już zaktualizowany przez onRunEnd). Zwraca świeżo zdobyte.
export const evaluateAchievements = (p, r) => evaluateAch(p, r);

export function markSeen(p, ids) { for (const id of ids) if (!p.seen.includes(id)) p.seen.push(id); }

// Publiczny widok profilu (dla klienta).
export function publicProfile(p) {
  return {
    nick: p.nick, avatar: p.avatar || 0, chars: p.chars, tiles: p.tiles, garnek: p.garnek, best: p.best,
    counters: p.counters, bosses: p.bosses, seen: p.seen, unlocked: p.unlocked, ach: p.ach || [], clears: p.clears || {}, completion: completion(p), recipes: p.recipes || [], reactions: p.reactions || [],
    nemesis: p.nemesis ? { ...p.nemesis, name: nemesisName(p.nemesis) } : null, will: p.will || null, feathers: p.feathers | 0, kurnik: p.kurnik || {},
    // Ukryte odblokowania (secret) nie zdradzają warunku, dopóki gracz ich nie zdobędzie.
    locks: UNLOCKS.filter(u => !p.unlocked.includes(u.id)).map(u => ({ id: u.id, kind: u.kind, target: u.target, secret: !!u.secret, text: u.secret ? '???' : u.text })),
    modes: Object.keys(MODES),
  };
}
