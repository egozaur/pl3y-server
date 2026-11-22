// Bulgot: warunki osiągnięć (tylko serwer). Sprawdzane po zakończeniu runu na profilu i zakończonym runie.
// Statystyki walk (`r.stats.v2`) zbieramy od wersji z osiągnięciami; starsze runy w toku nie przyznają osiągnięć „stylu” (brak danych).
import { ACHIEVEMENTS, CHARS, TILES, RECIPES, REACTIONS, MODES } from './data.js';

const win = r => !!r && r.ended === 'win';
const v2 = r => !!r && !!r.stats && !!r.stats.v2;
const st = r => (r && r.stats) || {};
const wonWith = (p, c) => Object.keys(p.clears || {}).some(k => k.split(':')[1] === c);

const TILES_COUNTED = TILES.filter(t => !t.hidden);
export const tilesTotal = () => TILES_COUNTED.length;
export const seenTotal = p => TILES_COUNTED.filter(t => p.seen.includes(t.id)).length;

// Ukończenie gry w %: zwycięstwa (tryb × postać × palnik), poznane kafelki, kombinacje (przepisy + reakcje), osiągnięcia.
export function completion(p) {
  const chars = Object.keys(CHARS), modes = Object.keys(MODES);
  const parts = [
    { id: 'clears', name: 'Zwycięstwa (tryb × postać × palnik)', done: Object.keys(p.clears || {}).length, total: modes.length * chars.length * 6, w: 35 },
    { id: 'tiles', name: 'Poznane kafelki', done: seenTotal(p), total: tilesTotal(), w: 20 },
    { id: 'combos', name: 'Kombinacje (przepisy Wylęgarni i Reakcje)', done: (p.recipes || []).length + (p.reactions || []).length, total: RECIPES.length + Object.keys(REACTIONS).length, w: 15 },
    { id: 'ach', name: 'Osiągnięcia', done: (p.ach || []).length, total: ACHIEVEMENTS.length, w: 30 },
  ];
  let pct = 0; for (const x of parts) pct += x.w * Math.min(1, x.done / x.total);
  return { pct: Math.floor(pct + 1e-9), parts };
}

const CHECKS = {
  'a-wygrana': (p, r) => win(r) || p.counters.wins > 0,
  'a-szybka': p => !!p.flags.winQuick,
  'a-babcia': p => !!p.flags.winFull,
  'a-g1': (p, r) => win(r) && r.garnek >= 1,
  'a-g2': (p, r) => win(r) && r.garnek >= 2,
  'a-g3': (p, r) => win(r) && r.garnek >= 3,
  'a-g4': (p, r) => win(r) && r.garnek >= 4,
  'a-g5': (p, r) => win(r) && r.garnek >= 5,
  'a-pyrtek': p => wonWith(p, 'pyrtek'), 'a-kwoka': p => wonWith(p, 'kwoka'), 'a-kaczor': p => wonWith(p, 'kaczor'),
  'a-indor': p => wonWith(p, 'indor'), 'a-zjarany': p => wonWith(p, 'zjarany'),
  'a-zagroda': p => Object.keys(CHARS).every(c => wonWith(p, c)),
  'a-bez-synergii': (p, r) => win(r) && v2(r) && !st(r).syn,
  'a-bez-zakupow': (p, r) => win(r) && v2(r) && !st(r).buys,
  'a-bez-rerolli': (p, r) => win(r) && v2(r) && !st(r).rerolls,
  'a-bez-odpoczynku': (p, r) => win(r) && v2(r) && !st(r).rests,
  'a-bez-umiejetnosci': (p, r) => win(r) && v2(r) && !st(r).skillUses,
  'a-pusty-portfel': (p, r) => win(r) && r.coins === 0,
  'a-skarbnik': (p, r) => !!r && (st(r).maxCoins || 0) >= 200,
  'a-lombard': (p, r) => !!r && (st(r).pawns || 0) >= 3,
  'a-mutant': (p, r) => !!r && (st(r).muts || 0) >= 1,
  'a-trzy-mutacje': (p, r) => !!r && (st(r).muts || 0) >= 3,
  'a-odznaki': (p, r) => !!r && (st(r).badges || 0) >= 6,
  'a-rozwidlenia': (p, r) => !!r && (st(r).doors || 0) >= 3,
  'a-sekunda': (p, r) => v2(r) && st(r).fastWin !== undefined && st(r).fastWin < 10,
  'a-minuta': (p, r) => v2(r) && (st(r).longWin || 0) >= 600,
  'a-wlosek': (p, r) => !!r && !!st(r).lowWin,
  'a-bez-zadrapania': (p, r) => v2(r) && (st(r).flawless || 0) >= 1,
  'a-nietykalny': (p, r) => v2(r) && (st(r).flawless || 0) >= 10,
  'a-boss-czysto': (p, r) => v2(r) && !!st(r).bossFlawless,
  'a-seria': (p, r) => !!r && (st(r).chains || 0) >= 1,
  'a-trzy-serie': (p, r) => v2(r) && (st(r).maxChainsFight || 0) >= 3,
  'a-mocarz': (p, r) => !!r && (st(r).maxHit || 0) >= 300,
  'a-mocarz2': (p, r) => !!r && (st(r).maxHit || 0) >= 1000,
  'a-reakcja': p => (p.reactions || []).length >= 1,
  'a-brojler': p => (p.bosses.brojler || 0) > 0,
  'a-skubarka': p => (p.bosses.skubarka || 0) > 0,
  'a-prezes': p => (p.bosses.prezes || 0) > 0,
  'a-nemezis': p => (p.counters.nemesisKills || 0) >= 1,
  'a-nemezis5': p => (p.counters.nemesisKills || 0) >= 5,
  'a-wylegarnia': p => (p.recipes || []).length >= 1,
  'a-wylegarnia-all': p => (p.recipes || []).length >= RECIPES.length,
  'a-reakcje-all': p => (p.reactions || []).length >= Object.keys(REACTIONS).length,
  'a-kolekcjoner': p => p.seen.length >= 40,
  'a-zbieracz': p => seenTotal(p) >= tilesTotal(),
  'a-wszystkie-postacie': p => Object.keys(CHARS).every(c => p.chars.includes(c)),
  'a-pierwszy': p => p.counters.runs >= 1,
  'a-wytrwaly': p => p.counters.runs - p.counters.wins >= 5,
  'a-weteran': p => p.counters.runs >= 10,
  'a-staly': p => p.counters.runs >= 25,
  'a-rekord': (p, r) => !!r && r.score >= 20000,
  'a-pelna-gra': p => completion(p).pct >= 100,
};

// Zwraca listę świeżo zdobytych osiągnięć (wpisy ACHIEVEMENTS).
export function evaluateAch(p, r) {
  p.ach = p.ach || []; const fresh = [];
  for (let pass = 0; pass < 2; pass++) {   // druga runda: osiągnięcia zależne od liczby innych (np. 100% gry)
    for (const a of ACHIEVEMENTS) {
      if (p.ach.includes(a.id)) continue;
      const ok = CHECKS[a.id];
      let res = false; try { res = !!(ok && ok(p, r)); } catch (e) {}
      if (res) { p.ach.push(a.id); fresh.push(a); }
    }
  }
  return fresh;
}
