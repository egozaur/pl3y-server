// Bulgot: Pojedynek dla 2 osób. Czysta logika (bez zapisu): konfiguracja z głosowania, zwycięzca, terminy i automatyczne decyzje.
// Jeden run na mecz, tryb Szybki, to samo ziarno dla obu graczy, pula startowa, bez premii i Kurnika (jak Dyżur dnia).
// Stan meczu trzyma BgRanks (klucz „du:<kod>”), run i terminy BgPlayer (run.duel). Silnika to nie zmienia.
import { mix, hash, makeRng } from './rng.js';
import { CHAR_IDS, TILE_BY_ID } from './data.js';
import { MAX_TICKS } from './sim.js';
import { pickTile, choose, bonusPick, shopBuy, bet, fightSetup, fightFinish } from './rules.js';

export const DUEL = {
  // Trzy najsłabsze postacie na palniku 5 w trybie Szybkim (pomiar 2026-11-24: bot, 300 partii na postać; wygrane: zjarany 1,7%, sanepid 2,7%, pacyfista 2,7%).
  weak: ['zjarany', 'sanepid', 'pacyfista'],
  mode: 'quick',
  rounds: 10,
  garnekDisagree: 5,        // brak zgody w głosowaniu: palnik 5
  voteMs: 120000,           // czas głosowania
  countdownMs: 9000,        // od końca głosowania do startu runów (losowanie na ekranie + 3-2-1)
  decideMs: 60000,          // wszystkie decyzje po walce
  startMs: 15000,           // od wejścia w fazę walki do jej rozpoczęcia
  fightMs: MAX_TICKS * 100 + 60000,   // najdłuższa walka + zapas
  graceMs: 1500,            // tolerancja zegara (sieć)
  noShowMs: 90000,          // po tylu ms od startu bez wejścia do runu gracz przegrywa walkowerem
  lobbyMs: 600000,          // mecz bez rywala wygasa
  keepMs: 86400000,         // rekord meczu znika po dobie
};

export const DUEL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const duelCode = bytes => Array.from(bytes, b => DUEL_CODE_CHARS[b % DUEL_CODE_CHARS.length]).join('');
export const validCode = c => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(c);

// Głos: { char, garnek } albo błąd.
export function cleanVote(v) {
  if (!v || !CHAR_IDS.includes(v.char)) return null;
  const g = Number(v.garnek);
  if (!Number.isInteger(g) || g < 0 || g > 5) return null;
  return { char: v.char, garnek: g };
}

// Konfiguracja meczu z głosów. Brak głosu albo niezgoda: palnik 5, postać losowana z DUEL.weak (losowanie zależy tylko od kodu, więc jest identyczne dla obu).
export function resolveCfg(rec) {
  const [a, b] = rec.players.map(p => p.vote), both = !!(a && b);
  const charAgree = both && a.char === b.char, gAgree = both && a.garnek === b.garnek;
  const rr = makeRng(mix(hash(rec.code), hash('duel-cfg')));
  return { char: charAgree ? a.char : rr.pick(DUEL.weak), garnek: gAgree ? a.garnek : DUEL.garnekDisagree, charForced: !charAgree, garnekForced: !gAgree };
}

// Ziarno runu: tylko serwer je zna (sól z rekordu nigdy nie wychodzi do klientów).
export const duelSeed = rec => mix(rec.salt >>> 0, hash('duel:' + rec.code)) >>> 0;

// Porównanie wyników: więcej wygranych pięter, potem więcej zadanych obrażeń. 1 = a lepszy, -1 = b lepszy, 0 = remis.
export const cmpProg = (a, b) => Math.sign((a.done | 0) - (b.done | 0)) || Math.sign((a.dealt | 0) - (b.dealt | 0));

// Zwycięzca: 'a' | 'b' | 'draw' | null (mecz trwa). Koniec, gdy oboje skończyli albo jedno skończyło, a drugie już ma więcej pięter.
export function duelWinner(a, b) {
  if (!a || !b) return null;
  const done = c => c < 0 ? 'b' : c > 0 ? 'a' : 'draw';
  if (a.over && b.over) return done(cmpProg(a, b));
  if (a.over && (b.done | 0) > (a.done | 0)) return 'b';
  if (b.over && (a.done | 0) > (b.done | 0)) return 'a';
  return null;
}

// ---------- terminy w runie ----------
// Klasa stanu: 'decide' (wszystkie decyzje po walce), 'wait' (walka czeka na start), 'fighting' (walka trwa), 'over'.
export const duelClass = run => run.phase === 'over' ? 'over' : run.phase === 'fight' ? (run.fight ? 'fighting' : 'wait') : 'decide';
// Po zmianie klasy stanu zaczyna się nowe okno czasowe (od `now`). Zwraca true, gdy termin się zmienił.
export function duelSetDl(run, now) {
  const d = run.duel, c = duelClass(run);
  if (!d || d.sk === c) return false;
  d.sk = c; d.dl = c === 'decide' ? now + DUEL.decideMs : c === 'wait' ? now + DUEL.startMs : c === 'fighting' ? now + DUEL.fightMs : 0;
  return true;
}

// Jeden automatyczny krok za gracza, który nie zdążył: bezpieczne wybory, a walkę rozstrzyga bez wejść (umiejętności nie są używane).
// Zwraca wynik kroku ({ ok, result? }) albo null, gdy nic się nie dało zrobić.
export function autoStep(run) {
  const ph = run.phase, P = run.pending, ok = r => r && !r.err ? r : null;
  if (ph === 'offer') {
    const idx = run.offer.map((id, i) => id ? i : -1).filter(i => i >= 0);
    const plain = idx.filter(i => !isEvent(run.offer[i])), evs = idx.filter(i => isEvent(run.offer[i]));
    for (const i of [...plain, ...evs]) { const r = ok(pickTile(run, i, 0, 1)); if (r) return r; }
    return null;
  }
  if (ph === 'route' || ph === 'badge' || ph === 'loot') return ok(choose(run, 0));
  if (ph === 'bonus') { for (let i = 0; i < run.offer.length; i++) if (run.offer[i]) { const r = ok(bonusPick(run, i, 0, 1)); if (r) return r; } return null; }
  if (ph === 'victory') return ok(choose(run, 1));   // Prezes pokonany: koniec (bez Dogrywki)
  if (ph === 'event' && P) {
    if (P.kind === 'shop') return ok(shopBuy(run, -1));
    if (P.kind === 'gamble') return ok(bet(run, 0));
    if (P.kind === 'adopt' || P.kind === 'crate') return ok(choose(run, -1));
    if (P.kind === 'extra' || P.kind === 'arena') return ok(choose(run, 1));   // odwrót
    return ok(choose(run, 0));   // kontrakt: etat, kapliczka: leczenie
  }
  if (ph === 'fight') {
    if (!run.fight) { const s = fightSetup(run); if (s.err) return null; }
    return ok(fightFinish(run, []));
  }
  return null;
}
// Wydarzenia z oferty (Sklepik, Arena, Hazard…) omijamy przy automatycznym wyborze, o ile jest zwykły kafelek.
const isEvent = id => !!(TILE_BY_ID[id] && TILE_BY_ID[id].event);
