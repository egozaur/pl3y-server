// Bulgot: profil gracza (Księga Kurnika): odblokowania, liczniki, najlepsze wyniki, Temperatura Garnka.
// Czyste funkcje na obiekcie `profile`; zapis robi BgPlayer.
import { STARTER_TILES, UNLOCKS, UNLOCK_BY_ID, MODES, RULES } from './data.js';
import { nemesisName } from './rules.js';
import { evaluateAch, completion } from './achievements.js';
import { ACHIEVEMENTS } from './data.js';

export function newProfile() {
  return { v: 1, chars: ['pyrtek'], tiles: [], garnek: 0, best: {}, counters: { runs: 0, wins: 0, fox: 0 }, bosses: {}, flags: {}, seen: [], unlocked: [], ach: [], clears: {} };
}

// Pula kafelków dostępnych w nowym runie.
export const poolFor = p => [...STARTER_TILES, ...p.tiles];

// Warunki odblokowań. p = profil, r = bieżący run (może być null).
const CHECKS = {
  'u-kwoka': p => !!p.flags.winFull,
  'u-kaczor': (p, r) => !!r && r.stats.riskPicks >= 5,
  'u-indor': p => !!p.flags.winQuick,
  'u-420': (p, r) => !!r && (r.stats.earned || 0) >= RULES.u420,   // Zjarany Kurczak: łącznie zdobyte Ziarna w jednym runie
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

// Koniec runu: liczniki, najlepszy wynik, kolejny poziom Garnka. Zwraca { newBest, garnekUnlocked }.
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
  return { newBest, garnekUnlocked };
}

// Osiągnięcia sprawdzane po zakończeniu runu (profil już zaktualizowany przez onRunEnd). Zwraca świeżo zdobyte.
export const evaluateAchievements = (p, r) => evaluateAch(p, r);

export function markSeen(p, ids) { for (const id of ids) if (!p.seen.includes(id)) p.seen.push(id); }

// Publiczny widok profilu (dla klienta).
export function publicProfile(p) {
  return {
    nick: p.nick, avatar: p.avatar || 0, chars: p.chars, tiles: p.tiles, garnek: p.garnek, best: p.best,
    counters: p.counters, bosses: p.bosses, seen: p.seen, unlocked: p.unlocked, ach: p.ach || [], clears: p.clears || {}, completion: completion(p), recipes: p.recipes || [], reactions: p.reactions || [],
    nemesis: p.nemesis ? { ...p.nemesis, name: nemesisName(p.nemesis) } : null, will: p.will || null,
    // Ukryte odblokowania (secret) nie zdradzają warunku, dopóki gracz ich nie zdobędzie.
    locks: UNLOCKS.filter(u => !p.unlocked.includes(u.id)).map(u => ({ id: u.id, kind: u.kind, target: u.target, secret: !!u.secret, text: u.secret ? '???' : u.text })),
    modes: Object.keys(MODES),
  };
}
