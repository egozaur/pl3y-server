// Silnik gry Kurczacze Imperium (2 graczy). Czysty moduł bez I/O: losowość z ziarna zapisanego w stanie (s.rng),
// więc ten sam stan + ta sama akcja = ten sam wynik. Pokój (room.js) tylko przechowuje stan i rozsyła widoki.
//
// Najważniejsze funkcje:
//   setup(seed, names)        → nowy stan (faza wyboru Cudów)
//   apply(s, p, act)          → { ok } albo { err }; zmienia s w miejscu (pokój pracuje na kopii)
//   timeoutMove(s)            → domyślny ruch za gracza, któremu skończył się czas
//   view(s, p)                → to, co widzi gracz p (bez zakrytych kart i talii w pudełku)
//
// Tor wojny: s.track ∈ [-7, 7]; dodatni = Kogut przesunięty w stronę Gniazda gracza 1 (przewaga gracza 0).
import { DATA } from './data.js';

const R = DATA.rules;
export const RES = Object.keys(DATA.resources);          // S B Z K L
export const CARDS = Object.fromEntries(DATA.cards.map(c => [c.id, c]));
export const WONDERS = Object.fromEntries(DATA.wonders.map(w => [w.id, w]));
export const TOKENS = Object.fromEntries(DATA.tokens.map(t => [t.id, t]));
export const TIMES = [0, 60, 90, 120];                   // limit czasu tury w sekundach (0 = bez limitu)
const LOG_MAX = 250;                                      // cała partia (zwykle ~100 wpisów)

// ---------- losowość (mulberry32, stan w s.rng) ----------
function rand(s) {
  let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- układ kart Ery ----------
// Rzędy od góry do dołu; x w połówkach szerokości karty (rzędy wyśrodkowane). Kartę przykrywają karty z rzędu
// niżej leżące o ≤ 1 połówkę obok: w piramidzie to dwie sąsiednie karty, a w Erze Koguta między rzędami 4 i 4
// tylko karta dokładnie pod spodem (ten sam x). Dolny rząd zawsze odkryty, wyżej na przemian zakryty/odkryty.
export function layoutSlots(era) {
  const rows = R.layouts[String(era)];
  const max = Math.max(...rows);
  const slots = [];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) slots.push({ row: r, x: max - n + 2 * i, up: (rows.length - 1 - r) % 2 === 0 });
  });
  slots.forEach(a => { a.cover = slots.map((b, j) => (b.row === a.row + 1 && Math.abs(b.x - a.x) <= 1 ? j : -1)).filter(j => j >= 0); });
  return slots;
}
const SLOTS = { 1: layoutSlots(1), 2: layoutSlots(2), 3: layoutSlots(3) };

function dealEra(s, era) {
  const ids = shuffle(s, s.decks[era]);
  s.era = era;
  s.layout = SLOTS[era].map((sl, i) => ({ id: ids[i], up: sl.up, taken: false }));
  revealFree(s);
}
export function isFree(s, i) {
  const c = s.layout[i];
  return !c.taken && SLOTS[s.era][i].cover.every(j => s.layout[j].taken);
}
function revealFree(s) { s.layout.forEach((c, i) => { if (!c.taken && !c.up && isFree(s, i)) c.up = true; }); }

// ---------- przygotowanie ----------
export function setup(seed, names = ['Gracz 1', 'Gracz 2']) {
  const s = { v: 1, rng: seed >>> 0, phase: 'draft', era: 0, turn: 0, turnNo: 0, track: 0, winner: null, log: [] };
  const first = rand(s) < 0.5 ? 0 : 1;
  s.first = first;
  s.players = [0, 1].map(p => ({
    name: String(names[p] || 'Gracz ' + (p + 1)), coins: R.start_coins + (p === first ? 0 : R.second_player_bonus),
    cards: [], since: {}, wonders: [], tokens: [], syms: [], chainVP: 0, wonderVP: 0,
  }));
  s.loss = [0, 1].map(() => R.military_tokens.map(([at, amount]) => ({ at, amount, used: false })));
  const toks = shuffle(s, DATA.tokens.map(t => t.id));
  s.board = toks.slice(0, R.tokens_on_board);
  s.box = toks.slice(R.tokens_on_board);
  // Cuda: dwie piątki; w pierwszej kolejność A B B A, w drugiej B A A B (A = pierwszy gracz). Ostatni z piątki odpada.
  const w = shuffle(s, DATA.wonders.map(x => x.id));
  const A = first, B = 1 - first;
  s.draft = { sets: [w.slice(0, 5), w.slice(5, 10)], set: 0, offer: w.slice(0, 5), order: [A, B, B, A, B, A, A, B], step: 0 };
  s.removedWonders = [];
  // Talie Er: z każdej 3 karty w ciemno do pudełka; do Ery Koguta 3 losowe Bractwa.
  s.decks = {};
  for (const era of [1, 2, 3]) {
    const ids = shuffle(s, DATA.cards.filter(c => c.era === era && c.color !== 'purple').map(c => c.id));
    s.decks[era] = ids.slice(R.deck_removed);
  }
  const guilds = shuffle(s, DATA.cards.filter(c => c.color === 'purple').map(c => c.id));
  s.decks[3] = s.decks[3].concat(guilds.slice(0, R.guilds_in_game));
  s.discard = [];
  s.pending = [];
  s.extra = false;
  s.lastMover = first;
  s.turn = first;
  log(s, null, `Losowanie: zaczyna ${s.players[first].name}.`);
  return s;
}

function log(s, p, text) {
  s.log.push({ n: s.turnNo, p, text });
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

// ---------- pomocnicze ----------
const cardsOf = (pl, color) => pl.cards.filter(id => CARDS[id].color === color);
const countColor = (pl, ...colors) => pl.cards.filter(id => colors.includes(CARDS[id].color)).length;
const builtWonders = pl => pl.wonders.filter(w => w.built);
const hasToken = (pl, special) => pl.tokens.some(t => TOKENS[t].special === special);
const opp = p => 1 - p;
const letters = str => (str || '').split('').filter(Boolean);

// Ile sztuk surowca r gracz produkuje na stałe na kartach brązowych i szarych (to podnosi cenę handlu przeciwnika).
export function fixedProd(pl) {
  const out = Object.fromEntries(RES.map(r => [r, 0]));
  for (const id of pl.cards) {
    const c = CARDS[id];
    if (c.color === 'brown' || c.color === 'grey') for (const r of letters(c.prod)) out[r]++;
  }
  return out;
}
// Produkcja „do wyboru” (karty i Cuda): lista ciągów opcji, np. ['SB', 'KL'].
export function choiceProd(pl) {
  const out = [];
  for (const id of pl.cards) if (CARDS[id].choice) out.push(CARDS[id].choice);
  for (const w of builtWonders(pl)) if (WONDERS[w.id].choice) out.push(WONDERS[w.id].choice);
  return out;
}
// Cena zakupu 1 sztuki surowca z banku dla gracza p (stała 1 z żółtych kart od następnej tury, rabat Wymiany Barterowej).
export function unitPrice(s, p) {
  const me = s.players[p], other = fixedProd(s.players[opp(p)]);
  const fixed = new Set();
  for (const id of me.cards) if (CARDS[id].fixed && s.turnNo > (me.since[id] ?? Infinity)) letters(CARDS[id].fixed).forEach(r => fixed.add(r));
  const barter = hasToken(me, 'trade_discount');
  const out = {};
  for (const r of RES) {
    let v = fixed.has(r) ? 1 : R.trade_base + R.trade_per_prod * other[r];
    if (barter) v = Math.max(1, v - 1);
    out[r] = v;
  }
  return out;
}

// Najtańszy koszt zdobycia brakujących surowców: produkcja stała, potem przegląd wszystkich przydziałów produkcji
// „do wyboru”, reszta kupiona z banku. discount1 = jeden dowolny surowiec mniej (Gniazdownictwo przy Cudach).
export function tradeCost(s, p, cost, discount1 = false) {
  const need = Object.fromEntries(RES.map(r => [r, 0]));
  for (const r of letters(cost)) need[r]++;
  const me = s.players[p];
  const have = fixedProd(me);
  // Bractwa i żółte karty nie produkują stale; liczy się prod brązowych/szarych (fixedProd) — żółte z `prod` nie istnieją.
  const left = {};
  for (const r of RES) left[r] = Math.max(0, need[r] - have[r]);
  const choices = choiceProd(me).filter(opts => letters(opts).some(r => left[r] > 0));
  const price = unitPrice(s, p);
  let best = Infinity;
  const variants = discount1 ? [null, ...RES.filter(r => need[r] > 0)] : [null];
  for (const drop of variants) {
    const base = { ...left };
    if (drop) {
      // Rabat obejmuje sztukę z wymagania: jeśli była pokryta produkcją, nic nie zmienia.
      if (base[drop] > 0) base[drop]--; else continue;
    }
    const rec = (k, rest) => {
      if (k === choices.length) {
        let sum = 0;
        for (const r of RES) sum += rest[r] * price[r];
        if (sum < best) best = sum;
        return;
      }
      let used = false;
      for (const r of letters(choices[k])) if (rest[r] > 0) { used = true; rest[r]--; rec(k + 1, rest); rest[r]++; }
      if (!used) rec(k + 1, rest);
    };
    rec(0, { ...base });
  }
  return best === Infinity ? 0 : best;
}

// Koszt budowy karty: { coins, free, chain } albo null, gdy gracz nie ma tyle Ziaren.
export function cardPrice(s, p, id) {
  const c = CARDS[id], me = s.players[p];
  if (c.chain_from && me.cards.some(x => CARDS[x].chain_give === c.chain_from)) return { coins: 0, chain: true, ok: true };
  const coins = (c.coins || 0) + tradeCost(s, p, c.cost);
  return { coins, chain: false, ok: coins <= me.coins };
}
export function wonderPrice(s, p, wid) {
  const me = s.players[p];
  const coins = tradeCost(s, p, WONDERS[wid].cost, hasToken(me, 'wonder_discount'));
  return { coins, ok: coins <= me.coins };
}
export function wondersLeft(s) { return R.wonders_max_built - s.players.reduce((n, pl) => n + builtWonders(pl).length, 0); }

// ---------- efekty ----------
function gain(s, p, n) { s.players[p].coins += n; }
function lose(s, p, n) { const pl = s.players[p]; const k = Math.min(pl.coins, n); pl.coins -= k; return k; }

// Ostrogi gracza p: Kogut idzie o n pól w stronę Gniazda przeciwnika. Znaczniki strat działają raz.
function military(s, p, n) {
  if (!n) return;
  const dir = p === 0 ? 1 : -1;
  s.track = Math.max(-R.track_half, Math.min(R.track_half, s.track + dir * n));
  const dist = s.track * dir;
  for (const t of s.loss[opp(p)]) {
    if (!t.used && dist >= t.at) {
      t.used = true;
      const k = lose(s, opp(p), t.amount);
      log(s, p, `Kogut wkracza na pole ${t.at}: ${s.players[opp(p)].name} traci ${k} Ziaren.`);
    }
  }
  if (dist >= R.track_half) win(s, p, 'military');
}

function addSymbol(s, p, sym) {
  const pl = s.players[p];
  pl.syms.push(sym);
  if (new Set(pl.syms).size >= R.science_win_distinct) return win(s, p, 'science');
  if (pl.syms.filter(x => x === sym).length === 2 && s.board.length) s.pending.push({ type: 'token', p });
}

function win(s, p, how) {
  if (s.winner) return;
  s.winner = { p, how };
  s.phase = 'end';
  s.score = scores(s);
  log(s, p, `${s.players[p].name} wygrywa (${{ military: 'militarnie', science: 'naukowo', civil: 'cywilnie' }[how]}).`);
}

function onCardBuilt(s, p, id) {
  const c = CARDS[id], me = s.players[p], other = s.players[opp(p)];
  if (c.gain) gain(s, p, c.gain);
  switch (c.special) {
    case 'coins_per_brown_grey_1': gain(s, p, countColor(me, 'brown', 'grey')); break;
    case 'coins_per_brown_2': gain(s, p, 2 * countColor(me, 'brown')); break;
    case 'coins_per_blue_1': gain(s, p, countColor(me, 'blue')); break;
    case 'coins_per_wonder_3': gain(s, p, 3 * builtWonders(me).length); break;
    case 'coins_per_2_cards': gain(s, p, Math.floor(me.cards.length / 2)); break;   // liczy też budowaną kartę
    case 'opp_lose_2': lose(s, opp(p), 2); break;
    case 'g_yellow': gain(s, p, Math.max(countColor(me, 'yellow'), countColor(other, 'yellow'))); break;
  }
  if (c.shields) military(s, p, c.shields);
  if (s.winner) return;
  if (c.sym) addSymbol(s, p, c.sym);
}

function onWonderBuilt(s, p, wid) {
  const w = WONDERS[wid], me = s.players[p], other = s.players[opp(p)];
  if (hasToken(me, 'wonder_discount')) me.wonderVP++;
  if (w.gain) gain(s, p, w.gain);
  if (w.special === 'steal_4') gain(s, p, lose(s, opp(p), 4));
  if (w.special === 'destroy_yellow' && cardsOf(other, 'yellow').length) s.pending.push({ type: 'destroy', p });
  if (w.special === 'steal_brown_grey' && countColor(other, 'brown', 'grey')) s.pending.push({ type: 'steal', p });
  if (w.special === 'take_token' && s.board.length) s.pending.push({ type: 'grab', p });
  if (w.shields) military(s, p, w.shields);
  if (s.winner) return;
  if (w.extra_turn) s.extra = true;
  // Szósty Cud: niezbudowane Cuda obu graczy wracają do pudełka.
  if (wondersLeft(s) <= 0) for (const pl of s.players) {
    const gone = pl.wonders.filter(x => !x.built);
    if (gone.length) { s.removedWonders.push(...gone.map(x => x.id)); pl.wonders = builtWonders(pl); }
  }
}

function takeToken(s, p, tid) {
  const t = TOKENS[tid], me = s.players[p];
  s.board = s.board.filter(x => x !== tid);
  me.tokens.push(tid);
  log(s, p, `${me.name} bierze Odkrycie: ${t.name}.`);
  if (t.gain) gain(s, p, t.gain);
  if (t.shields) military(s, p, t.shields);
  if (s.winner) return;
  if (t.special === 'sym_waga') addSymbol(s, p, 'Waga Ziarna');
}

// ---------- kto teraz działa ----------
export function actor(s) {
  if (s.phase === 'end') return null;
  if (s.pending.length) return s.pending[0].p;
  if (s.phase === 'draft') return s.draft.order[s.draft.step];
  return s.turn;
}

// ---------- akcje ----------
export function apply(s, p, act) {
  if (s.phase === 'end') return { err: 'Gra się skończyła.' };
  if (!act || typeof act !== 'object') return { err: 'Nieprawidłowy ruch.' };
  if (actor(s) !== p) return { err: 'To nie Twój ruch.' };
  if (s.pending.length) return resolvePending(s, p, act);
  if (s.phase === 'draft') return pickWonder(s, p, act);
  const i = Number(act.slot);
  if (!Number.isInteger(i) || !s.layout[i] || !isFree(s, i)) return { err: 'Tej karty nie można teraz wziąć.' };
  const id = s.layout[i].id, me = s.players[p];
  if (act.a === 'build') {
    const price = cardPrice(s, p, id);
    if (!price.ok) return { err: 'Nie stać Cię na tę kartę.' };
    me.coins -= price.coins;
    take(s, i);
    me.cards.push(id);
    me.since[id] = s.turnNo;
    log(s, p, `${me.name} buduje ${CARDS[id].name}` + (price.chain ? ' za darmo (Ślad Pazurka).' : price.coins ? ` za ${price.coins} Ziaren.` : '.'));
    if (price.chain && hasToken(me, 'chain_bonus')) { gain(s, p, 2); me.chainVP++; }
    onCardBuilt(s, p, id);
  } else if (act.a === 'discard') {
    const k = R.discard_base + R.discard_per_2_yellow * Math.floor(countColor(me, 'yellow') / 2);
    take(s, i);
    s.discard.push(id);
    gain(s, p, k);
    log(s, p, `${me.name} odrzuca ${CARDS[id].name} i bierze ${k} Ziaren.`);
  } else if (act.a === 'wonder') {
    const w = me.wonders.find(x => x.id === act.wonder && !x.built);
    if (!w) return { err: 'Nie masz takiego niezbudowanego Cudu.' };
    if (wondersLeft(s) <= 0) return { err: 'Zbudowano już wszystkie Cuda.' };
    const price = wonderPrice(s, p, w.id);
    if (!price.ok) return { err: 'Nie stać Cię na ten Cud.' };
    me.coins -= price.coins;
    take(s, i);
    w.built = true;
    w.under = id;
    log(s, p, `${me.name} buduje Cud ${WONDERS[w.id].name}` + (price.coins ? ` za ${price.coins} Ziaren.` : '.'));
    onWonderBuilt(s, p, w.id);
  } else return { err: 'Nieznany ruch.' };
  s.lastMover = p;
  return endTurn(s, p);
}

function take(s, i) { s.layout[i].taken = true; s.layout[i].up = true; revealFree(s); }

function pickWonder(s, p, act) {
  const d = s.draft;
  if (act.a !== 'pickWonder' || !d.offer.includes(act.wonder)) return { err: 'Wybierz jeden z odkrytych Cudów.' };
  d.offer = d.offer.filter(x => x !== act.wonder);
  s.players[p].wonders.push({ id: act.wonder, built: false, under: null });
  log(s, p, `${s.players[p].name} wybiera Cud ${WONDERS[act.wonder].name}.`);
  d.step++;
  if (d.step === 4 || d.step === 8) {
    s.removedWonders.push(...d.offer);   // ostatni Cud z piątki wraca do pudełka
    if (d.step === 4) d.offer = [...d.sets[1]];
    else { s.draft = null; s.phase = 'play'; s.turn = s.first; dealEra(s, 1); log(s, null, 'Era Jajka.'); }
  }
  s.turnNo++;
  return { ok: true };
}

function resolvePending(s, p, act) {
  const pd = s.pending[0], me = s.players[p], other = s.players[opp(p)];
  if (pd.type === 'token' || pd.type === 'grab') {
    if (act.a !== 'token' || !s.board.includes(act.token)) return { err: 'Wybierz Odkrycie z planszy.' };
    s.pending.shift();
    takeToken(s, p, act.token);
  } else if (pd.type === 'destroy') {
    if (act.a !== 'destroy' || !other.cards.includes(act.card) || CARDS[act.card].color !== 'yellow') return { err: 'Wybierz żółtą kartę przeciwnika.' };
    s.pending.shift();
    other.cards = other.cards.filter(x => x !== act.card);
    s.discard.push(act.card);
    log(s, p, `${me.name} niszczy ${CARDS[act.card].name} przeciwnika.`);
  } else if (pd.type === 'steal') {
    const c = CARDS[act.card];
    if (act.a !== 'steal' || !other.cards.includes(act.card) || !['brown', 'grey'].includes(c.color)) return { err: 'Wybierz brązową lub szarą kartę przeciwnika.' };
    s.pending.shift();
    other.cards = other.cards.filter(x => x !== act.card);
    me.cards.push(act.card);
    me.since[act.card] = s.turnNo;
    log(s, p, `${me.name} przejmuje ${c.name}.`);
  } else return { err: 'Nieznany wybór.' };
  return endTurn(s, s.turn);
}

// Domyka turę, gdy nie czeka już żaden wybór: koniec gry, koniec Ery, dodatkowa tura albo zmiana gracza.
function endTurn(s, p) {
  // Wybory bez możliwych celów przepadają.
  s.pending = s.pending.filter(pd => (pd.type === 'token' || pd.type === 'grab') ? s.board.length > 0 : true);
  if (s.winner) { s.pending = []; return { ok: true }; }
  if (s.pending.length) return { ok: true };
  s.turnNo++;
  if (s.layout.every(c => c.taken)) {
    s.extra = false;   // dodatkowa tura z ostatniej karty Ery przepada
    if (s.era === 3) { finishCivil(s); return { ok: true }; }
    // Następną Erę zaczyna słabszy militarnie (Kogut po jego stronie); przy remisie ten, kto nie ruszał się ostatni.
    s.turn = s.track > 0 ? 1 : s.track < 0 ? 0 : opp(s.lastMover);
    dealEra(s, s.era + 1);
    log(s, null, s.era === 2 ? 'Era Pisklęcia.' : 'Era Koguta.');
    return { ok: true };
  }
  if (s.extra) { s.extra = false; s.turn = p; log(s, p, `${s.players[p].name} ma dodatkową turę.`); }
  else s.turn = opp(p);
  return { ok: true };
}

// ---------- punktacja ----------
export function militaryVP(s, p) {
  const d = s.track * (p === 0 ? 1 : -1);
  if (d <= 0) return 0;
  for (const [upTo, vp] of R.zone_vp.map(([, to, vp]) => [to, vp])) if (d <= upTo) return vp;
  return 0;
}
// Złote Pióra z jednego Bractwa (id) dla gracza p w obecnym stanie (bot liczy też Bractwo, którego gracz jeszcze nie ma).
export function guildVP(s, p, id) {
  const me = s.players[p], other = s.players[opp(p)];
  switch (CARDS[id].special) {
    case 'g_brown_grey': return countColor(me, 'brown', 'grey');
    case 'g_military': return Math.max(0, s.track * (p === 0 ? 1 : -1));
    case 'g_science': return new Set(me.syms).size + me.tokens.length;
    case 'g_yellow': return Math.floor(me.coins / 5);
    case 'g_wonders': return 3 * builtWonders(me).length;
    case 'g_blue_all': return Math.floor((countColor(me, 'blue') + countColor(other, 'blue')) / 2);
  }
  return 0;
}
export function scores(s) {
  return [0, 1].map(p => {
    const me = s.players[p];
    const cards = me.cards.reduce((n, id) => n + (CARDS[id].vp || 0), 0);
    const guilds = cardsOf(me, 'purple').reduce((n, id) => n + guildVP(s, p, id), 0);
    const wonders = builtWonders(me).reduce((n, w) => n + (WONDERS[w.id].vp || 0), 0) + me.wonderVP;
    const tokens = me.tokens.reduce((n, t) => n + (TOKENS[t].vp || 0), 0) + (hasToken(me, 'vp_per_token_2') ? 2 * me.tokens.length : 0) + me.chainVP;
    const parts = { military: militaryVP(s, p), cards, guilds, wonders, tokens, coins: Math.floor(me.coins / R.coins_per_vp) };
    return { ...parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
  });
}
function finishCivil(s) {
  const sc = scores(s);
  s.score = sc;
  s.phase = 'end';
  const [a, b] = sc.map(x => x.total);
  let w = a > b ? 0 : b > a ? 1 : null;
  if (w === null) {
    const wa = builtWonders(s.players[0]).length, wb = builtWonders(s.players[1]).length;
    w = wa > wb ? 0 : wb > wa ? 1 : null;
    if (w === null) { const ca = s.players[0].coins, cb = s.players[1].coins; w = ca > cb ? 0 : cb > ca ? 1 : null; }
  }
  s.winner = { p: w, how: 'civil' };
  log(s, w, w === null ? 'Remis: obaj gracze wygrywają.' : `${s.players[w].name} wygrywa cywilnie (${sc[w].total} : ${sc[1 - w].total}).`);
}

// ---------- domyślny ruch po upływie czasu ----------
export function timeoutMove(s) {
  const p = actor(s);
  if (p == null) return null;
  const pd = s.pending[0];
  let act;
  if (pd) {
    const other = s.players[opp(p)];
    if (pd.type === 'token' || pd.type === 'grab') act = { a: 'token', token: s.board[0] };
    else if (pd.type === 'destroy') act = { a: 'destroy', card: cardsOf(other, 'yellow')[0] };
    else act = { a: 'steal', card: other.cards.find(id => ['brown', 'grey'].includes(CARDS[id].color)) };
  } else if (s.phase === 'draft') act = { a: 'pickWonder', wonder: s.draft.offer[0] };
  else act = { a: 'discard', slot: s.layout.findIndex((c, i) => isFree(s, i)) };
  apply(s, p, act);
  return { p, act };
}

// ---------- widok dla gracza ----------
// Widać: odkryte karty układu, Imperia obu graczy, Cuda, Odkrycia na planszy, stos odrzuconych, tor i log.
// Nie widać: zakrytych kart układu, kart odłożonych w ciemno, Bractw poza grą, Odkryć w pudełku, stanu losowania.
export function view(s, p) {
  const v = {
    phase: s.phase, era: s.era, turn: s.turn, actor: actor(s), me: p, first: s.first, track: s.track,
    trackHalf: R.track_half, wondersLeft: wondersLeft(s), board: [...s.board], discard: [...s.discard],
    loss: s.loss.map(side => side.map(t => ({ at: t.at, amount: t.amount, used: t.used }))),
    log: [...s.log], winner: s.winner, score: s.score || null,
    pending: s.pending.length ? { type: s.pending[0].type, p: s.pending[0].p } : null,
  };
  v.players = s.players.map((pl, i) => ({
    name: pl.name, coins: pl.coins, cards: [...pl.cards], tokens: [...pl.tokens], syms: [...pl.syms],
    wonders: pl.wonders.map(w => ({ id: w.id, built: w.built })),
    prod: fixedProd(pl), choice: choiceProd(pl), price: unitPrice(s, i), vp: scores(s)[i].total,
  }));
  if (s.phase === 'draft') v.draft = { offer: [...s.draft.offer], step: s.draft.step };
  if (s.layout && s.phase !== 'draft') {
    v.slots = s.layout.map((c, i) => {
      const sl = SLOTS[s.era][i];
      const o = { row: sl.row, x: sl.x, taken: c.taken, up: c.up, id: c.up && !c.taken ? c.id : null, free: isFree(s, i) };
      if (o.free && s.phase === 'play') o.price = [0, 1].map(q => cardPrice(s, q, c.id));
      return o;
    });
    v.rows = R.layouts[String(s.era)];
  }
  if (s.phase === 'play') {
    v.wonderPrice = [0, 1].map(q => Object.fromEntries(s.players[q].wonders.filter(w => !w.built).map(w => [w.id, wonderPrice(s, q, w.id)])));
    v.discardGain = [0, 1].map(q => R.discard_base + R.discard_per_2_yellow * Math.floor(countColor(s.players[q], 'yellow') / 2));
  }
  return v;
}
