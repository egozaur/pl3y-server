// Bot „Kogut Zenek” dla Kurczaczego Imperium. Czysty moduł bez I/O: botMove(view, level, rnd) → act.
// Bot widzi wyłącznie E.view(s, p), czyli tyle co człowiek: bez zakrytych kart układu, talii i Odkryć w pudełku.
// Ceny bierze z view.slots[i].price i view.wonderPrice. Do oceny ruchów odtwarza z widoku pełny stan silnika,
// a zakryte karty losuje z puli kart, których jeszcze nie widział (determinizacja).
//
// Poziomy:
//   easy   — losowy legalny ruch (czasem Cud, zwykle budowa, inaczej odrzucenie),
//   medium — zachłannie: każdy ruch symulowany o 1 krok i oceniany heurystyką (Pióra, nauka, Ostrogi,
//            produkcja, Ziarna) z karą za to, co rywal dostaje w następnym ruchu (zwłaszcza natychmiastową wygraną),
//   hard   — najlepsze ruchy średniego sprawdzone 2 ruchy w przód (ruch bota → najlepsza odpowiedź rywala)
//            na kilku losowych próbkach zakrytych kart.
import * as E from './engine.js';
import { DATA } from './data.js';

export const LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL_NAMES = { easy: 'Łatwy', medium: 'Średni', hard: 'Trudny' };
export const BOT_NAME = 'Kogut Zenek';

const { CARDS, WONDERS, TOKENS, RES } = E;
const R = DATA.rules;
const HALF = R.track_half, SCI_WIN = R.science_win_distinct;
const BG = ['brown', 'grey'];
const opp = p => 1 - p;
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];

// Karty każdej Ery (do losowania zakrytych): zwykłe i Bractwa osobno.
const ERA_CARDS = { 1: [], 2: [], 3: [] };
for (const c of DATA.cards) if (c.color !== 'purple') ERA_CARDS[c.era].push(c.id);
const GUILDS = DATA.cards.filter(c => c.color === 'purple').map(c => c.id);

// ---------- ruchy legalne według widoku ----------
export function legalMoves(v) {
  const me = v.me;
  if (v.phase === 'end' || v.actor !== me) return [];
  const other = v.players[opp(me)];
  if (v.pending) {
    const t = v.pending.type;
    if (t === 'token' || t === 'grab') return v.board.map(token => ({ a: 'token', token }));
    if (t === 'destroy') return other.cards.filter(id => CARDS[id].color === 'yellow').map(card => ({ a: 'destroy', card }));
    if (t === 'steal') return other.cards.filter(id => BG.includes(CARDS[id].color)).map(card => ({ a: 'steal', card }));
    return [];
  }
  if (v.phase === 'draft') return v.draft.offer.map(wonder => ({ a: 'pickWonder', wonder }));
  const out = [];
  const ws = v.wondersLeft > 0 ? Object.entries(v.wonderPrice[me] || {}).filter(([, p]) => p.ok).map(([id]) => id) : [];
  v.slots.forEach((s, slot) => {
    if (!s.free || s.taken) return;
    if (s.price[me].ok) out.push({ a: 'build', slot });
    out.push({ a: 'discard', slot });
    for (const wonder of ws) out.push({ a: 'wonder', slot, wonder });
  });
  return out;
}

// ---------- poziom łatwy ----------
function easyMove(v, rnd) {
  const me = v.me, moves = legalMoves(v);
  if (v.pending || v.phase === 'draft') return pick(moves, rnd);
  const wonders = moves.filter(m => m.a === 'wonder'), builds = moves.filter(m => m.a === 'build');
  const roll = rnd();
  if (wonders.length && roll < 0.25) return pick(wonders, rnd);
  if (builds.length && roll < 0.85) return pick(builds, rnd);
  return pick(moves.filter(m => m.a === 'discard'), rnd);
}

// ---------- odtworzenie stanu silnika z widoku ----------
function shuffled(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Stan, na którym silnik może liczyć ruchy. Zakryte karty i talie kolejnych Er są losowane z kart niewidzianych;
// s.guess = numery pól, których prawdziwej karty bot nie zna. Stała cena „od następnej tury”: w chwili decyzji
// każda zbudowana wcześniej karta już działa (tura zawsze podbija turnNo), więc since = -1 jest dokładne.
export function rebuild(v, rnd) {
  const T = 1000;
  const s = {
    v: 1, rng: Math.floor(rnd() * 4294967296) >>> 0, phase: v.phase, era: v.era, turn: v.turn, turnNo: T, track: v.track,
    winner: v.winner, log: [], first: v.first, board: [...v.board], box: [], discard: [...v.discard], removedWonders: [],
    loss: v.loss.map(side => side.map(t => ({ ...t }))), pending: v.pending ? [{ ...v.pending }] : [], extra: false,
    lastMover: opp(v.turn), draft: null, decks: {}, guess: new Set(), pool: [],
  };
  s.players = v.players.map(pl => ({
    name: pl.name, coins: pl.coins, cards: [...pl.cards], since: Object.fromEntries(pl.cards.map(id => [id, -1])),
    wonders: pl.wonders.map(w => ({ id: w.id, built: w.built, under: null })), tokens: [...pl.tokens], syms: [...pl.syms],
    chainVP: 0, wonderVP: 0,
  }));
  const seen = new Set([...v.discard, ...v.players.flatMap(pl => pl.cards)]);
  if (v.slots) for (const sl of v.slots) if (sl.id) seen.add(sl.id);
  if (v.slots) {
    const hidden = v.slots.map((sl, i) => (!sl.taken && !sl.up ? i : -1)).filter(i => i >= 0);
    let pool = ERA_CARDS[v.era].filter(id => !seen.has(id));
    if (v.era === 3) pool = pool.concat(GUILDS.filter(id => !seen.has(id)));
    pool = shuffled(pool, rnd);
    s.pool = pool;
    s.layout = v.slots.map(sl => ({ id: sl.id, up: sl.up, taken: sl.taken }));
    hidden.forEach((i, k) => { s.layout[i].id = pool[k % pool.length]; s.guess.add(i); });
    for (let e = v.era + 1; e <= 3; e++) {
      const deck = shuffled(ERA_CARDS[e], rnd).slice(0, 18 - (e === 3 ? R.guilds_in_game : 0));
      s.decks[e] = e === 3 ? deck.concat(shuffled(GUILDS, rnd).slice(0, R.guilds_in_game)) : deck;
    }
  }
  // Pióra spoza kart (Tajemnica Łańcucha, Gniazdownictwo) nie są w widoku osobno: reszta z sumy punktów.
  if (v.phase !== 'draft') {
    const sc = E.scores(s);
    s.players.forEach((pl, i) => { pl.chainVP = Math.max(0, v.players[i].vp - sc[i].total); });
  }
  return s;
}

// Budżet pracy jednego ruchu (liczba skopiowanych stanów). W Workerze zegar stoi w trakcie obliczeń, więc limit
// CPU pilnujemy licznikiem, a nie czasem.
const BUDGET = 1500;
let work = 0;
function clone(s) {
  work++;
  return {
    ...s, log: [], board: [...s.board], discard: [...s.discard], removedWonders: [...s.removedWonders],
    loss: s.loss.map(side => side.map(t => ({ ...t }))), pending: s.pending.map(x => ({ ...x })),
    layout: s.layout.map(c => ({ ...c })),
    players: s.players.map(pl => ({
      ...pl, cards: [...pl.cards], since: { ...pl.since }, wonders: pl.wonders.map(w => ({ ...w })), tokens: [...pl.tokens], syms: [...pl.syms],
    })),
  };
}

// Ruchy legalne w odtworzonym stanie (dla dowolnego gracza).
function movesOf(s, p) {
  const me = s.players[p], other = s.players[opp(p)];
  if (s.pending.length) {
    const t = s.pending[0].type;
    if (t === 'token' || t === 'grab') return s.board.map(token => ({ a: 'token', token }));
    if (t === 'destroy') return other.cards.filter(id => CARDS[id].color === 'yellow').map(card => ({ a: 'destroy', card }));
    return other.cards.filter(id => BG.includes(CARDS[id].color)).map(card => ({ a: 'steal', card }));
  }
  const out = [];
  const ws = E.wondersLeft(s) > 0 ? me.wonders.filter(w => !w.built && E.wonderPrice(s, p, w.id).ok).map(w => w.id) : [];
  s.layout.forEach((c, slot) => {
    if (!E.isFree(s, slot)) return;
    if (E.cardPrice(s, p, c.id).ok) out.push({ a: 'build', slot });
    out.push({ a: 'discard', slot });
    for (const wonder of ws) out.push({ a: 'wonder', slot, wonder });
  });
  return out;
}

// ---------- ocena pozycji ----------
// Wartości w „Piórach”: punkty z gry + to, co da punkty albo wygraną później. Ocena jest antysymetryczna:
// eval(s, p) = strona(p) − strona(rywal), więc rywal w przeszukiwaniu po prostu ją minimalizuje.
// Wagi heurystyki (W0). eraW = waga przyszłości w Erze (produkcja, łańcuchy, siła nabywcza Ziaren), sci = różne
// symbole (5 = wygrana), mil = przewaga na torze ponad Pióra z pól (7 = wygrana), q* = szybka wartość karty dla rywala.
export const W0 = {
  eraW: [1, 1, 0.6, 0.15], coinA: 0.1, coinB: 0.25,
  prod: [2.2, 1.1, 0.4], choice: 0.7, raise: 0.35, fixed: 1, fixed2: 0.3,
  sci: [0, 0.7, 1.8, 4, 9], sci4: 2, mil: [0, 0.4, 1, 1.8, 2.8, 4.5, 9, 0],
  chain1: 0.9, chain2: 0.6, tok: 1.5, tok0: 0.5, wonder: 0,
  tempo: 0.45, extra: 2,
  qGain: 0.3, qCoin: 0.25, qShA: 1.3, qShB: 2.2, qPair: 3.5, qProd: 2, qChoice: 1.6, qFixed: 1.2, qChain: 0.7, qGuild: 1, qGuildVP: 1,
  late: 1,
};
// Wagi poziomu trudnego: W0 dostrojone samoczynnie (wspinaczka po wagach na stałych seedach). Pierwsze strojenie
// (Średni kontra Średni): wyżej produkcja i łańcuchy w Erze Jajka oraz to, co rywal zyskałby z kart ze stałą ceną.
// Drugie (2026-11-21, nowy Trudny kontra poprzedni, z wygaszaniem Ziaren w Erze Koguta i realną wartością Bractw):
// mniej warte trzymane Ziarna, mocniej stała produkcja podnosząca rywalowi ceny, większa kara za kartę zostawioną
// rywalowi, mniejsza premia za dodatkową turę; ~65% wygranych z poprzednim Trudnym na nowych seedach.
export const W_HARD = {
  ...W0, eraW: [1, 1.407, 0.6, 0.21], coinA: 0.09, coinB: 0.175, prod: [2.2, 1.733, 0.4], fixed: 0.945, chain2: 0.861,
  raise: 0.686, tempo: 0.63, extra: 1.4, late: 0.7,
  qGain: 0.386, qChoice: 2.478, qFixed: 2.226, qChain: 0.907,
};
let W = W0;
const WIN = 1000;
const prodVal = n => W.prod[0] * Math.min(n, 1) + W.prod[1] * Math.max(0, Math.min(n - 1, 1)) + W.prod[2] * Math.max(0, Math.min(n - 2, 1));

// Ile Ery Koguta jeszcze zostało (ułamek kart w układzie, 1 → 0); w Erach Jajka i Pisklęcia zawsze 1.
// Pod koniec gry Ziarno jest warte tylko tyle, ile daje w punktacji (1 Pióro za 4, to już jest w sc.total),
// a produkcja i łańcuchy nie zdążą się przydać. W.late = 0 wyłącza to wygaszanie.
function eraLeft(s) {
  if (s.era !== 3 || !s.layout) return 1;
  let n = 0;
  for (const c of s.layout) if (!c.taken) n++;
  return 1 - W.late * (1 - n / s.layout.length);
}

function side(s, p, sc) {
  const me = s.players[p], lf = eraLeft(s), w = W.eraW[s.era || 1] * lf;
  let v = sc[p].total;
  v += me.coins * (W.coinA * lf + W.coinB * w);
  const fp = E.fixedProd(me), ch = E.choiceProd(me);
  const fixed = new Set();
  for (const id of me.cards) for (const r of (CARDS[id].fixed || '')) fixed.add(r);
  for (const r of RES) {
    const n = fp[r] + W.choice * ch.filter(o => o.includes(r)).length;
    v += w * prodVal(n);
    v += w * W.raise * Math.min(fp[r], 3);                    // stała produkcja podnosi rywalowi ceny handlu
    if (fixed.has(r)) v += w * (n >= 2 ? W.fixed2 : W.fixed);
  }
  const d = new Set(me.syms).size;
  v += W.sci[Math.min(d, SCI_WIN - 1)];
  if (d === SCI_WIN - 1) v += W.sci4;
  const dist = s.track * (p === 0 ? 1 : -1);
  if (dist > 0) v += W.mil[Math.min(dist, HALF)];
  if (s.era < 3) for (const id of me.cards) if (CARDS[id].chain_give) v += s.era === 1 ? W.chain1 : W.chain2;
  for (const t of me.tokens) if (['wonder_discount', 'trade_discount', 'chain_bonus'].includes(TOKENS[t].special)) v += W.tok * w + W.tok0;
  if (W.wonder && E.wondersLeft(s) > 0) for (const x of me.wonders) if (!x.built) v += W.wonder * w;
  return v;
}

export function evaluate(s, p) {
  const sc = s.score && s.phase === 'end' ? s.score : E.scores(s);
  const diff = side(s, p, sc) - side(s, opp(p), sc);
  if (s.phase === 'end' && s.winner) {
    if (s.winner.p === p) return WIN + diff;
    if (s.winner.p === opp(p)) return -WIN + diff;
  }
  return diff;
}

// Czy rywal q (teraz na ruchu) może natychmiast wygrać: Ostrogami do pola 7 albo piątym różnym symbolem.
function canWinNow(s, q) {
  if (s.phase !== 'play' || E.actor(s) !== q || s.pending.length) return false;
  const pl = s.players[q], dist = s.track * (q === 0 ? 1 : -1), syms = new Set(pl.syms);
  let anyFree = false;
  for (let i = 0; i < s.layout.length; i++) {
    if (!E.isFree(s, i)) continue;
    anyFree = true;
    const c = CARDS[s.layout[i].id];
    if (!c.shields && !c.sym) continue;
    if (!E.cardPrice(s, q, c.id).ok) continue;
    if (c.shields && dist + c.shields >= HALF) return true;
    if (c.sym && !syms.has(c.sym) && syms.size + 1 >= SCI_WIN) return true;
  }
  if (anyFree && E.wondersLeft(s) > 0) {
    for (const w of pl.wonders) if (!w.built && WONDERS[w.id].shields && dist + WONDERS[w.id].shields >= HALF && E.wonderPrice(s, q, w.id).ok) return true;
  }
  return false;
}

// Szybka wartość karty dla gracza q (bez symulacji): ile mniej więcej zyska, budując ją teraz.
function quickValue(s, q, id, coins) {
  const c = CARDS[id], pl = s.players[q], w = W.eraW[s.era];
  let v = (c.vp || 0) + (c.gain || 0) * W.qGain - coins * W.qCoin;
  if (c.shields) {
    const dist = s.track * (q === 0 ? 1 : -1);
    v += c.shields * (dist >= 2 ? W.qShB : W.qShA);
  }
  if (c.sym) {
    const have = pl.syms.includes(c.sym), d = new Set(pl.syms).size;
    v += have ? (s.board.length ? W.qPair : 0.5) : W.sci[Math.min(d + 1, SCI_WIN - 1)] - W.sci[Math.min(d, SCI_WIN - 1)];
  }
  if (c.prod) v += w * W.qProd * c.prod.length;
  if (c.choice) v += w * W.qChoice;
  if (c.fixed) v += w * W.qFixed;
  if (c.chain_give && s.era < 3) v += W.qChain;
  if (c.color === 'purple') v += W.qGuildVP * E.guildVP(s, q, id) + W.qGuild;   // Bractwo: tyle Piór, ile dałoby q teraz
  return v;
}

// Czy karta pozwala graczowi q wygrać od razu (Ostrogami do pola 7 albo piątym różnym symbolem).
function winsWith(s, q, id) {
  const c = CARDS[id];
  if (!c.shields && !c.sym) return false;
  const pl = s.players[q];
  if (c.shields && s.track * (q === 0 ? 1 : -1) + c.shields >= HALF) return E.cardPrice(s, q, id).ok;
  if (c.sym && !pl.syms.includes(c.sym) && new Set(pl.syms).size + 1 >= SCI_WIN) return E.cardPrice(s, q, id).ok;
  return false;
}

// Tempo: co czeka na gracza, który rusza się teraz (q). Natychmiastowa wygrana albo najlepsza dostępna karta.
// Karty na polach, których bot nie zna (s.guess), liczone średnio po puli niewidzianych kart.
function tempo(s, q) {
  if (s.phase !== 'play' || E.actor(s) !== q || s.pending.length) return 0;
  if (canWinNow(s, q)) return 400;
  let best = 0, risk = 0;
  for (let i = 0; i < s.layout.length; i++) {
    if (!E.isFree(s, i)) continue;
    if (s.guess.has(i)) {
      if (!s.pool.length) continue;
      let w = 0, sum = 0;
      for (const id of s.pool) {
        if (winsWith(s, q, id)) w++;
        const pr = E.cardPrice(s, q, id);
        if (pr.ok) sum += quickValue(s, q, id, pr.coins);
      }
      risk = Math.max(risk, w / s.pool.length);
      best = Math.max(best, sum / s.pool.length);
      continue;
    }
    const pr = E.cardPrice(s, q, s.layout[i].id);
    if (pr.ok) best = Math.max(best, quickValue(s, q, s.layout[i].id, pr.coins));
  }
  return 400 * risk + W.tempo * best;
}
// Ocena liścia przeszukiwania: pozycja + tempo gracza, który teraz się rusza.
function leaf(s, me) {
  let v = evaluate(s, me);
  if (s.phase !== 'play') return v;
  const a = E.actor(s);
  return a === me ? v + tempo(s, me) : v - tempo(s, opp(me));
}

// Po ruchu gracza p rozstrzyga jego własne wybory (Odkrycie, zniszczenie, przejęcie) najlepszą opcją dla niego.
function settle(s, p, me) {
  for (let k = 0; k < 4 && s.phase !== 'end' && s.pending.length && E.actor(s) === p; k++) {
    let best = null, bv = -Infinity;
    for (const m of movesOf(s, p)) {
      const t = clone(s);
      if (E.apply(t, p, m).err) continue;
      const v = evaluate(t, me) * (p === me ? 1 : -1);
      if (v > bv) { bv = v; best = t; }
    }
    if (!best) return s;
    s = best;
  }
  return s;
}


// Ocena 1 ruchu (poziom średni): symulacja, własne wybory, kara za to, co zostaje rywalowi.
function oneStep(s0, me, m) {
  let s = clone(s0);
  if (E.apply(s, me, m).err) return { v: -Infinity, s: null };
  s = settle(s, me, me);
  let v = leaf(s, me);
  if (s.phase === 'play' && E.actor(s) === me && !s.pending.length) v += W.extra;
  return { v, s };
}

// Ruch rywala, który jest dla bota najgorszy (poziom trudny): rywal minimalizuje ocenę bota.
function worstReply(s, me) {
  if (s.phase === 'end') return evaluate(s, me);
  if (E.actor(s) === me) return leaf(s, me) + W.extra;
  const q = opp(me);
  let worst = Infinity;
  for (const m of movesOf(s, q)) {
    if (work > BUDGET) break;
    let t = clone(s);
    if (E.apply(t, q, m).err) continue;
    t = settle(t, q, me);
    let v = leaf(t, me);
    if (t.phase === 'play' && E.actor(t) === q) v -= W.extra;
    if (v < worst) worst = v;
    if (worst <= -WIN) break;
  }
  return worst === Infinity ? leaf(s, me) : worst;
}

// ---------- wybór Cudów (średni i trudny) ----------
function wonderValue(id) {
  const w = WONDERS[id];
  let v = (w.vp || 0) + (w.gain || 0) / 3 + (w.shields || 0) * 1.5 + (w.extra_turn ? 3 : 0) + (w.choice ? 2 : 0);
  v += { steal_4: 1.5, destroy_yellow: 1, steal_brown_grey: 2, take_token: 3 }[w.special] || 0;
  return v - 0.4 * (w.cost || '').length;
}

const SAMPLES = 3, TOP = 6;   // W.samples / W.top nadpisują (strojenie)

// ---------- główna funkcja ----------
// opts.w = inne wagi (strojenie w testach).
export const lastWork = () => work;   // ile stanów skopiował ostatni ruch (testy)
export function botMove(v, level = 'medium', rnd = Math.random, opts = {}) {
  W = opts.w || (level === 'hard' ? W_HARD : W0);
  work = 0;
  const moves = legalMoves(v);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (level === 'easy') return easyMove(v, rnd);
  if (v.phase === 'draft') {
    let best = moves[0], bv = -Infinity;
    for (const m of moves) { const x = wonderValue(m.wonder) + rnd() * 0.3; if (x > bv) { bv = x; best = m; } }
    return best;
  }
  const me = v.me, base = rebuild(v, rnd);
  const scored = moves.map(m => ({ m, ...oneStep(base, me, m) })).map(x => ({ ...x, v: x.v + rnd() * 0.01 }));
  scored.sort((a, b) => b.v - a.v);
  if (level !== 'hard' || v.pending) return scored[0].m;
  // Trudny (wagi W_HARD): najlepsze ruchy według oceny 1 ruchu, każdy sprawdzony z odpowiedzią rywala na kilku próbkach zakrytych kart.
  const top = scored.filter(x => x.s).slice(0, W.top || TOP);
  if (top[0].v >= WIN / 2) return top[0].m;                 // wygrana od razu
  const worlds = [base];
  for (let k = 1; k < (W.samples || SAMPLES); k++) worlds.push(rebuild(v, rnd));
  let best = top[0].m, bv = -Infinity;
  for (const x of top) {
    if (work > BUDGET) break;                                 // najlepsze według średniego są już ocenione
    let sum = 0;
    for (const w of worlds) {
      let s = w === base ? x.s : clone(w);
      if (w !== base) { if (E.apply(s, me, x.m).err) { sum = -Infinity; break; } s = settle(s, me, me); }
      sum += worstReply(s, me);
    }
    const val = sum / worlds.length + rnd() * 0.01;
    if (val > bv) { bv = val; best = x.m; }
  }
  return best;
}
