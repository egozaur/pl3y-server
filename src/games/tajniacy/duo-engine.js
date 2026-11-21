// Tajniacy, tryb dla 2 osób („Duet”): czysty silnik bez I/O. Gracze grają razem przeciwko planszy.
// Wspólna plansza 25 słów, każdy gracz ma swój klucz: 9 agentów (g), 3 zabójców (a), reszta to postronni (n).
// Na zmianę: jeden podaje hasło i liczbę (według swojego klucza), drugi klika słowa, które sprawdza się
// według klucza podającego. Wygrana: odkryci wszyscy agenci z obu kluczy (15 różnych słów).
// Przegrana: zabójca, koniec limitu tur albo poddanie się.

export const TURNS = [9, 11, 0];          // limity tur do wyboru w pokoju; 0 = bez limitu
export const WORD_MAX = 30;
export const CLUE_MAX = 30;

// Układ kluczy: pary (klucz gracza 0, klucz gracza 1) i ile kart każdej pary.
// Każdy klucz: 9 g, 3 a, 13 n; wspólnych agentów 3, razem 15 różnych agentów.
// Jeden zabójca każdego gracza jest agentem drugiego, jeden wspólny, jeden postronny u drugiego.
const LAYOUT = [
  ['g', 'g', 3], ['g', 'n', 5], ['n', 'g', 5], ['g', 'a', 1], ['a', 'g', 1],
  ['a', 'a', 1], ['a', 'n', 1], ['n', 'a', 1], ['n', 'n', 7],
];
export const AGENTS_TOTAL = LAYOUT.reduce((s, [x, y, c]) => s + (x === 'g' || y === 'g' ? c : 0), 0);   // 15

// Deterministyczny generator (mulberry32), żeby testy mogły powtarzać rozdania.
export function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Sprawdza listę 25 słów od klienta. Zwraca oczyszczoną listę albo null.
export function cleanWords(words) {
  if (!Array.isArray(words) || words.length !== 25) return null;
  const out = words.map(w => String(w == null ? '' : w).replace(/\s+/g, ' ').trim().slice(0, WORD_MAX));
  if (out.some(w => !w)) return null;
  if (new Set(out.map(w => w.toLowerCase())).size !== 25) return null;
  return out;
}

export function setup(seed, words, turns, names) {
  const r = rng(seed);
  const pairs = shuffle(LAYOUT.flatMap(([x, y, c]) => Array(c).fill([x, y])), r);
  return {
    words: words.slice(),
    keys: [pairs.map(p => p[0]), pairs.map(p => p[1])],
    names: names.slice(),
    found: Array(25).fill(false),          // odkryty agent (widać na zielono u obu)
    miss: [Array(25).fill(false), Array(25).fill(false)],   // miss[s][i]: postronny na kluczu s (trafiony przy podpowiedzi s)
    giver: r() < 0.5 ? 0 : 1,              // kto teraz podaje hasło
    phase: 'clue',                         // clue | guess | end
    clue: null,                            // { word, n }
    guesses: 0,                            // trafienia w tej turze
    turns,                                 // limit (0 = bez limitu)
    turnNo: 1,
    result: null,                          // { win, reason: 'all'|'assassin'|'time'|'surrender', by? , card? }
    log: [],                               // [{ giver, word, n, picks:[{ i, k }] }]
  };
}

const agentsLeft = (g, s) => g.keys[s].reduce((n, k, i) => n + (k === 'g' && !g.found[i] ? 1 : 0), 0);
export const foundCount = g => g.found.filter(Boolean).length;
// Kto ma teraz działać: podający w fazie hasła, zgadujący w fazie zgadywania.
export const actor = g => (g.phase === 'end' ? null : g.phase === 'clue' ? g.giver : 1 - g.giver);
// Zgadujący ma tyle prób, ile wynosi liczba przy haśle.
export const maxGuesses = g => (g.clue ? g.clue.n : 0);

// Słowo z planszy, z którym hasło się gryzie: to samo słowo albo jedno zawiera drugie (bez względu na wielkość liter).
// Zwraca to słowo albo null. Ta sama reguła jest w duo.html (podpowiedź przed wysłaniem).
export function clashWord(words, clue) {
  const c = String(clue).toLocaleLowerCase('pl');
  return words.find(w => { const x = w.toLocaleLowerCase('pl'); return x === c || x.includes(c) || c.includes(x); }) || null;
}

function finish(g, win, reason, extra) { g.phase = 'end'; g.result = Object.assign({ win, reason }, extra || {}); }

// Koniec tury: liczy limit, ustala następnego podającego (gracz bez agentów do wskazania nie podaje).
function endTurn(g) {
  if (g.phase === 'end') return;
  if (g.turns && g.turnNo >= g.turns) return finish(g, false, 'time');
  g.turnNo++;
  let next = 1 - g.giver;
  if (agentsLeft(g, next) === 0) next = g.giver;
  g.giver = next;
  g.phase = 'clue'; g.clue = null; g.guesses = 0;
}

// Wykonuje ruch gracza seat. Zwraca {ok:true} albo {err}. Mutuje g tylko przy powodzeniu (sprawdza przed zmianą).
export function apply(g, seat, act) {
  if (!act || typeof act !== 'object') return { err: 'Nieprawidłowy ruch.' };
  if (g.phase === 'end') return { err: 'Gra się skończyła.' };
  if (act.a === 'surrender') { finish(g, false, 'surrender', { by: seat }); return { ok: true }; }
  if (act.a === 'clue') {
    if (g.phase !== 'clue' || seat !== g.giver) return { err: 'Teraz nie podajesz hasła.' };
    const word = String(act.word == null ? '' : act.word).trim().slice(0, CLUE_MAX);
    const n = Number(act.n);
    if (!word) return { err: 'Wpisz hasło.' };
    if (/\s/.test(word)) return { err: 'Hasło to jedno słowo, bez spacji.' };
    const hit = clashWord(g.words, word);
    if (hit) return { err: `Hasło nie może być słowem z planszy ani jego częścią („${hit}”).` };
    if (!Number.isInteger(n) || n < 1 || n > 9) return { err: 'Liczba słów: od 1 do 9.' };
    g.clue = { word, n }; g.phase = 'guess'; g.guesses = 0;
    g.log.push({ giver: seat, word, n, picks: [] });
    return { ok: true };
  }
  if (act.a === 'guess') {
    if (g.phase !== 'guess' || seat !== 1 - g.giver) return { err: 'Teraz nie zgadujesz.' };
    const i = Number(act.i);
    if (!Number.isInteger(i) || i < 0 || i > 24) return { err: 'Nie ma takiej karty.' };
    if (g.found[i]) return { err: 'Ta karta jest już odkryta.' };
    if (g.miss[g.giver][i]) return { err: 'To słowo już okazało się postronne dla podającego.' };
    const k = g.keys[g.giver][i];
    g.log[g.log.length - 1].picks.push({ i, k });
    if (k === 'a') { finish(g, false, 'assassin', { card: i, by: seat }); return { ok: true }; }
    if (k === 'n') { g.miss[g.giver][i] = true; endTurn(g); return { ok: true }; }
    g.found[i] = true; g.guesses++;
    if (foundCount(g) === AGENTS_TOTAL) { finish(g, true, 'all'); return { ok: true }; }
    // Podający nie ma już agentów albo wykorzystano limit prób (liczba przy haśle): koniec tury.
    if (g.guesses >= maxGuesses(g) || agentsLeft(g, g.giver) === 0) endTurn(g);
    return { ok: true };
  }
  if (act.a === 'end') {
    if (g.phase !== 'guess') return { err: 'Turę można zakończyć dopiero po podaniu hasła.' };
    endTurn(g);
    return { ok: true };
  }
  return { err: 'Nieznany ruch.' };
}

// Widok dla gracza seat: tylko jego klucz (cudzy dopiero po końcu gry).
export function view(g, seat) {
  const end = g.phase === 'end';
  return {
    words: g.words, names: g.names,
    key: g.keys[seat],
    partnerKey: end ? g.keys[1 - seat] : null,
    found: g.found, miss: g.miss,
    giver: g.giver, phase: g.phase, clue: g.clue, guesses: g.guesses, max: maxGuesses(g),
    turns: g.turns, turnNo: g.turnNo,
    foundCount: foundCount(g), total: AGENTS_TOTAL,
    myLeft: agentsLeft(g, seat),
    result: g.result, log: g.log,
  };
}
