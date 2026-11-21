// Testy Kurczaczego Imperium: silnik (engine.js) i pokój (KiRoom), z atrapą ctx i gniazd.
import * as E from '../../../src/games/kurczacze/engine.js';
import { KiRoom, GRACE, BOT_DELAY } from '../../../src/games/kurczacze/room.js';
import { botMove, legalMoves, lastWork, evaluate, LEVELS, BOT_NAME } from '../../../src/games/kurczacze/bot.js';
import { DATA } from '../../../src/games/kurczacze/data.js';

export const kiTests = [];
const test = (name, fn) => kiTests.push({ name: 'kurczacze: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg || ''} oczekiwano ${JSON.stringify(b)}, jest ${JSON.stringify(a)}`);

// Gra po wyborze Cudów (zawsze pierwszy z oferty), na początku Ery Jajka.
function started(seed = 1) {
  const s = E.setup(seed, ['Ala', 'Ola']);
  while (s.phase === 'draft') { const r = E.apply(s, E.actor(s), { a: 'pickWonder', wonder: s.draft.offer[0] }); assert(r.ok, r.err); }
  return s;
}
// Czysty stan do testów reguł: pusta plansza Imperiów, dużo Ziaren, układ Ery 1.
function blank(seed = 1) {
  const s = started(seed);
  for (const pl of s.players) { pl.cards = []; pl.since = {}; pl.coins = 50; pl.syms = []; pl.tokens = []; }
  return s;
}
const give = (s, p, ...ids) => { for (const id of ids) { s.players[p].cards.push(id); s.players[p].since[id] = -1; } };
// Kładzie kartę id na pierwszym wolnym polu (podmienia), zwraca numer pola.
function put(s, id) {
  const i = s.layout.findIndex((c, k) => E.isFree(s, k));
  s.layout[i].id = id; s.layout[i].up = true;
  return i;
}
// Losowy legalny ruch (do pełnych partii): buduj, gdy stać, czasem Cud, inaczej odrzuć.
function randomMove(s, r) {
  const p = E.actor(s);
  if (s.pending.length) { E.timeoutMove(s); return; }
  if (s.phase === 'draft') { const o = s.draft.offer; return assertOk(E.apply(s, p, { a: 'pickWonder', wonder: o[Math.floor(r() * o.length)] })); }
  const free = s.layout.map((c, i) => i).filter(i => E.isFree(s, i));
  const slot = free[Math.floor(r() * free.length)];
  const w = s.players[p].wonders.find(x => !x.built && E.wonderPrice(s, p, x.id).ok);
  const roll = r();
  if (w && E.wondersLeft(s) > 0 && roll < 0.25) return assertOk(E.apply(s, p, { a: 'wonder', slot, wonder: w.id }));
  if (E.cardPrice(s, p, s.layout[slot].id).ok && roll < 0.85) return assertOk(E.apply(s, p, { a: 'build', slot }));
  return assertOk(E.apply(s, p, { a: 'discard', slot }));
}
const assertOk = r => assert(r && r.ok, r && r.err);
function rng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

// ---------- dane i przygotowanie ----------
test('dane: liczby kart, Cudów i Odkryć', () => {
  const n = e => DATA.cards.filter(c => c.era === e && c.color !== 'purple').length;
  eq([n(1), n(2), n(3)], [21, 21, 18], 'karty Er');
  eq(DATA.cards.filter(c => c.color === 'purple').length, 6, 'Bractwa');
  eq([DATA.wonders.length, DATA.tokens.length], [10, 8]);
});

test('układy: 18 kart, dostępne na starcie i przykrywanie', () => {
  for (const era of [1, 2, 3]) {
    const sl = E.layoutSlots(era);
    eq(sl.length, 18, 'era ' + era);
    const last = sl[sl.length - 1].row;
    assert(sl.filter(x => x.row === last).every(x => x.up), 'dolny rząd odkryty');
  }
  const e1 = E.layoutSlots(1);
  eq(e1.filter(x => !x.cover.length).length, 6, 'Era 1: 6 dostępnych');
  assert(e1[0].cover.length === 2 && !e1[0].up, 'Era 1: góra zakryta, przykryta 2 kartami');
  const e2 = E.layoutSlots(2);
  eq(e2.filter(x => !x.cover.length).length, 3, 'Era 2: 3 dostępne');
  eq(e2[0].cover.length, 1, 'Era 2: skrajna karta przykryta jedną');
  const e3 = E.layoutSlots(3);
  eq(e3.filter(x => !x.cover.length).length, 2, 'Era 3: 2 dostępne');
  const r2 = e3.filter(x => x.row === 2);
  assert(r2.every(x => x.cover.length === 1 && e3[x.cover[0]].x === x.x), 'Era 3: rzędy 4/4 — tylko karta pod spodem');
  eq(e3.map(x => x.up ? 'O' : 'Z').join(''), 'ZZOOOZZZZOOOOZZZOO', 'Era 3: wzór odkryte/zakryte');
});

test('przygotowanie: Ziarna, Odkrycia, talie, Bractwa, kolejność wyboru Cudów', () => {
  const s = E.setup(7);
  const f = s.first;
  eq([s.players[f].coins, s.players[1 - f].coins], [6, 7]);
  eq([s.board.length, s.box.length], [4, 4]);
  for (const e of [1, 2, 3]) eq(s.decks[e].length, 18, 'talia ' + e);
  eq(s.decks[3].filter(id => E.CARDS[id].color === 'purple').length, 3, 'Bractwa w Erze 3');
  eq(s.draft.order, [f, 1 - f, 1 - f, f, 1 - f, f, f, 1 - f]);
  assert(E.apply(s, 1 - f, { a: 'pickWonder', wonder: s.draft.offer[0] }).err, 'nie twoja kolej');
});

test('wybór Cudów: po 4 na gracza, 2 do pudełka, start Ery Jajka', () => {
  const s = started(3);
  eq(s.players.map(p => p.wonders.length), [4, 4]);
  eq(s.removedWonders.length, 2);
  assert(s.phase === 'play' && s.era === 1 && s.turn === s.first);
});

// ---------- koszty i handel ----------
test('handel: cena 1 + 2 za produkcję przeciwnika, produkcja do wyboru jej nie podnosi', () => {
  const s = blank();
  eq(E.tradeCost(s, 0, 'SB'), 2, 'pusto');
  give(s, 1, 'J-01', 'P-01', 'J-04');          // przeciwnik: Słoma 1 + 2, Grzebisko (S/B do wyboru)
  eq(E.unitPrice(s, 0).S, 7, 'Słoma: 1 + 2×3');
  eq(E.unitPrice(s, 0).B, 1, 'Błoto: wybór się nie liczy');
  give(s, 0, 'J-04');                            // ja: Grzebisko
  eq(E.tradeCost(s, 0, 'SB'), 1, 'Grzebisko pokrywa droższą Słomę');
  give(s, 0, 'J-02');
  eq(E.tradeCost(s, 0, 'SB'), 0, 'Błoto z produkcji, Słoma z wyboru');
});

test('handel: stała cena działa od następnej tury, Wymiana Barterowa', () => {
  const s = blank();
  give(s, 1, 'J-01', 'J-01');
  s.players[0].cards.push('J-19'); s.players[0].since['J-19'] = s.turnNo;   // Spichlerz Sąsiedzki: S i B po 1
  eq(E.unitPrice(s, 0).S, 5, 'jeszcze nie działa');
  s.turnNo++;
  eq(E.unitPrice(s, 0).S, 1, 'od następnej tury');
  s.players[0].tokens.push('O-05');
  eq(E.unitPrice(s, 0).Z, 1, 'barter: minimum 1');
  s.players[0].cards = [];
  eq(E.unitPrice(s, 0).S, 4, 'barter: 5 - 1');
});

test('Ślad Pazurka: darmowa budowa i Tajemnica Łańcucha', () => {
  const s = blank();
  give(s, s.turn, 'J-01');                        // Snopowisko daje Widły
  s.players[s.turn].tokens.push('O-07');
  const p = s.turn, coins = s.players[p].coins;
  const i = put(s, 'P-01');                        // Wielki Stóg ← Widły
  eq(E.cardPrice(s, p, 'P-01'), { coins: 0, chain: true, ok: true });
  assertOk(E.apply(s, p, { a: 'build', slot: i }));
  eq(s.players[p].coins, coins + 2, '+2 Ziarna z Tajemnicy');
  eq(E.scores(s)[p].tokens, 1, '+1 Pióro z Tajemnicy');
});

test('budowa: brak Ziaren blokuje, odrzucenie daje 3 + 1 za 2 żółte', () => {
  const s = blank();
  const p = s.turn;
  s.players[p].coins = 0;
  const i = put(s, 'J-04');
  assert(E.apply(s, p, { a: 'build', slot: i }).err, 'nie stać');
  give(s, p, 'J-18', 'J-21');
  assertOk(E.apply(s, p, { a: 'discard', slot: i }));
  eq(s.players[p].coins, 4);
  eq(s.turn, 1 - p, 'zmiana gracza');
  assert(s.discard.includes('J-04'));
});

// ---------- wojna ----------
test('wojna: znaczniki strat raz, zwycięstwo w Gnieździe', () => {
  const s = blank();
  const p = 0;
  s.turn = 0;
  s.players[1].coins = 5;
  give(s, 0, 'J-01');
  for (let k = 0; k < 3; k++) { s.turn = 0; assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'J-12') })); }
  eq(s.track, 3);
  eq(s.players[1].coins, 2, 'strata 3 na polu 3');
  s.track = 2; s.turn = 0;
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'J-12') }));
  eq(s.players[1].coins, 2, 'znacznik zużyty');
  s.turn = 0;
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'P-12') }));   // +2 → pole 5: strata 6 (ma tylko 2)
  eq(s.players[1].coins, 0, 'traci wszystko, co ma');
  s.track = 6; s.turn = 0;
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'J-12') }));
  eq(s.winner, { p, how: 'military' });
  eq(s.phase, 'end');
});

test('wojna: punkty za pozycję i Bractwo Pierzastych Rycerzy', () => {
  const s = blank();
  s.track = -4;
  eq([E.militaryVP(s, 0), E.militaryVP(s, 1)], [0, 4]);
  s.track = 6; eq(E.militaryVP(s, 0), 8);
  s.track = 1; eq(E.militaryVP(s, 0), 2);
  give(s, 0, 'B-02'); s.track = 5;
  eq(E.scores(s)[0].guilds, 5);
});

// ---------- nauka ----------
test('nauka: para daje Odkrycie, 5 różnych wygrywa', () => {
  const s = blank();
  s.turn = 0;
  give(s, 0, 'J-15'); s.players[0].syms = ['Lotka i Atrament'];
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'P-16') }));
  eq(E.actor(s), 0, 'czeka wybór Odkrycia');
  assert(E.apply(s, 0, { a: 'build', slot: 0 }).err, 'najpierw wybór');
  const tok = s.board[0];
  assertOk(E.apply(s, 0, { a: 'token', token: tok }));
  assert(s.players[0].tokens.includes(tok) && s.board.length === 3);
  eq(s.turn, 1, 'tura przechodzi po wyborze');
  s.turn = 0;
  s.players[0].syms = ['Lotka i Atrament', 'Lotka i Atrament', 'Koło Grzebaka', 'Grzęda', 'Zegar Piania'];
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'J-17') }));
  eq(s.winner, { p: 0, how: 'science' });
});

test('nauka: Kodeks Grzędowy daje Wagę Ziarna, bez Odkryć para nic nie daje', () => {
  const s = blank();
  s.turn = 0;
  s.board = ['O-01'];
  s.players[0].syms = ['Grzęda'];
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'P-15') }));
  assertOk(E.apply(s, 0, { a: 'token', token: 'O-01' }));
  assert(s.players[0].syms.includes('Waga Ziarna'));
  s.turn = 0;
  s.players[0].syms.push('Ucieracz Ziarna');
  assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'K-12') }));
  assert(!s.pending.length && s.turn === 1, 'pusta plansza: brak wyboru');
});

// ---------- Cuda ----------
test('Cuda: koszt, karta pod spodem, dodatkowa tura, Gniazdownictwo', () => {
  const s = blank();
  s.turn = 0;
  s.players[0].wonders = [{ id: 'C-10', built: false }, { id: 'C-01', built: false }];
  s.players[0].tokens.push('O-03');
  give(s, 1, 'J-03');                              // przeciwnik produkuje Żwirek → Żwirek kosztuje 3
  const full = E.tradeCost(s, 0, E.WONDERS['C-10'].cost);
  eq(full, 7, 'B B S Z K: 1+1+1+3+1');
  eq(E.wonderPrice(s, 0, 'C-10').coins, 4, 'Gniazdownictwo zdejmuje najdroższy surowiec (Żwirek)');
  const i = put(s, 'J-01');
  assertOk(E.apply(s, 0, { a: 'wonder', slot: i, wonder: 'C-10' }));
  assert(s.players[0].wonders[0].built && !s.players[0].cards.includes('J-01'), 'karta pod Cudem');
  eq(s.turn, 0, 'dodatkowa tura');
  eq(E.scores(s)[0].wonders, 6, '5 + 1 z Gniazdownictwa');
});

test('Cuda: szósty zamyka resztę, Pomnik niszczy żółtą, Brama przejmuje, Lisia Nora kradnie', () => {
  const s = blank();
  s.turn = 0;
  s.players[0].wonders = ['C-06', 'C-09', 'C-07', 'C-03'].map(id => ({ id, built: false }));
  s.players[1].wonders = ['C-01', 'C-02', 'C-04', 'C-05'].map((id, k) => ({ id, built: k < 3 }));
  give(s, 1, 'J-19', 'J-04');
  s.players[1].coins = 3;
  assertOk(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-01'), wonder: 'C-06' }));
  assert(E.apply(s, 0, { a: 'destroy', card: 'J-04' }).err, 'tylko żółta');
  assertOk(E.apply(s, 0, { a: 'destroy', card: 'J-19' }));
  assert(!s.players[1].cards.includes('J-19') && s.discard.includes('J-19'));
  s.turn = 0;
  assertOk(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-02'), wonder: 'C-09' }));
  assertOk(E.apply(s, 0, { a: 'steal', card: 'J-04' }));
  assert(s.players[0].cards.includes('J-04') && !s.players[1].cards.includes('J-04'));
  s.turn = 0;
  const before = s.players[0].coins, cost = E.wonderPrice(s, 0, 'C-07').coins;
  assertOk(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-03'), wonder: 'C-07' }));
  eq(s.players[0].coins, before - cost + 3, 'kradnie tyle, ile przeciwnik miał');
  eq(E.wondersLeft(s), 0);
  eq(s.players[0].wonders.length, 3, 'niezbudowany Cud wraca do pudełka');
  eq(s.players[1].wonders.length, 3);
  s.turn = 0;
  assert(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-05'), wonder: 'C-03' }).err);
});

test('koniec Ery: zaczyna słabszy, dodatkowa tura z ostatniej karty przepada', () => {
  const s = blank();
  s.layout.forEach(c => { c.taken = true; });
  const last = s.layout.length - 1;
  s.layout[last].taken = false; s.layout[last].id = 'J-01'; s.layout[last].up = true;
  s.turn = 0; s.track = 2;
  s.players[0].wonders = [{ id: 'C-03', built: false }];
  assertOk(E.apply(s, 0, { a: 'wonder', slot: last, wonder: 'C-03' }));
  eq(s.era, 2);
  eq(s.turn, 1, 'Kogut po stronie gracza 1 → on zaczyna');
  assert(!s.extra);
});

// ---------- punktacja ----------
test('punktacja: karty, Bractwa, Odkrycia, Ziarna i remis', () => {
  const s = blank();
  give(s, 0, 'J-11', 'J-09', 'B-01', 'J-01', 'J-07', 'B-06');
  give(s, 1, 'P-07', 'P-08', 'P-09');
  s.players[0].tokens = ['O-06', 'O-08'];
  s.players[0].coins = 9;
  const sc = E.scores(s)[0];
  eq(sc.cards, 5, 'niebieskie 3 + 2');
  eq(sc.guilds, 2 + 2, 'Grzebacze 2 (brązowa+szara), Grzędowe: 5 niebieskich → 2');
  eq(sc.tokens, 6 + 4, 'Złote Jajo 6 + Kronika 2×2');
  eq(sc.coins, 2);
});

test('pełne partie: losowe legalne ruchy kończą się zwycięzcą lub remisem, nic nie ujemne', () => {
  for (let k = 1; k <= 60; k++) {
    const s = E.setup(k * 7919);
    const r = rng(k);
    let n = 0;
    while (s.phase !== 'end') {
      randomMove(s, r);
      assert(++n < 400, 'gra się nie kończy, seed ' + k);
      assert(s.players.every(p => p.coins >= 0), 'ujemne Ziarna');
      assert(Math.abs(s.track) <= 7);
    }
    assert(s.winner && ['military', 'science', 'civil'].includes(s.winner.how), 'brak wyniku');
    assert(s.score && s.score.length === 2);
  }
});

test('widok: zakryte karty, talie i pudełko nie wyciekają', () => {
  const s = started(11);
  const v = JSON.stringify(E.view(s, 0));
  const hidden = [...s.layout.filter(c => !c.up).map(c => c.id), ...s.box, ...s.decks[2], ...s.decks[3]]
    .filter(id => !s.layout.some(c => c.up && !c.taken && c.id === id));
  for (const id of hidden) assert(!v.includes(`"${id}"`), 'wyciek ' + id);
  assert(!v.includes('"rng"') && !v.includes('"decks"') && !v.includes('"box"'));
  const vv = E.view(s, 0);
  assert(vv.slots.filter(x => x.free).every(x => x.id && x.price.length === 2), 'dostępne karty z cenami');
});

test('ruch domyślny po czasie: wybór Cudu, odrzucenie karty, wybór Odkrycia', () => {
  const s = E.setup(5);
  const p = E.actor(s);
  E.timeoutMove(s);
  eq(s.players[p].wonders.length, 1);
  const g = blank();
  const q = g.turn, coins = g.players[q].coins;
  E.timeoutMove(g);
  eq(g.players[q].coins, coins + 3, 'odrzucenie');
});

// ---------- pokój ----------
test('serwer: index.js eksportuje KiRoom (wymagane przez wrangler.toml przy wdrożeniu)', async () => {
  const W = await import('../../../src/index.js');
  assert(W.KiRoom === KiRoom, 'brak eksportu KiRoom');
});

class WS {
  constructor() { this.open = true; this.out = []; this.att = null; this.closed = null; }
  send(d) { if (this.open) this.out.push(JSON.parse(d)); }
  close(code) { this.open = false; this.closed = code; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att == null ? null : structuredClone(this.att); }
  last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (!t || this.out[i].t === t) return this.out[i]; return null; }
  view() { const m = this.last('state'); return m && m.view; }
}
function mkCtx() {
  const store = new Map(); const sockets = new Set(); let alarm = null;
  return {
    alarmAt: () => alarm,
    storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, deleteAll: async () => store.clear(), setAlarm: async at => { alarm = at; } },
    acceptWebSocket: ws => sockets.add(ws), getWebSockets: () => [...sockets].filter(w => w.open), setWebSocketAutoResponse() {},
  };
}
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));
async function connect(room) { const ws = new WS(); room.attach(ws, await room.load()); return ws; }
async function roomWith2() {
  const ctx = mkCtx(); const room = new KiRoom(ctx, {});
  let t = 1_000_000; room.now = () => t; room.seed = () => 42;
  await room.init('KURCZ');
  const a = await connect(room); await send(room, a, { t: 'hello', join: 'Ala' });
  const b = await connect(room); await send(room, b, { t: 'hello', join: 'Ola' });
  return { ctx, room, a, b, clock: { add: ms => { t += ms; }, get: () => t } };
}

test('pokój: dwa miejsca, trzeci odrzucony, powrót tokenem', async () => {
  const { room, a, b } = await roomWith2();
  eq([a.last('welcome').seat, b.last('welcome').seat], [0, 1]);
  const c = await connect(room); await send(room, c, { t: 'hello', join: 'Ela' });
  eq(c.last('error').code, 'full');
  const back = await connect(room); await send(room, back, { t: 'hello', player: b.last('welcome').token });
  eq(back.last('welcome').seat, 1);
  eq(a.view().seats.map(x => x.name), ['Ala', 'Ola']);
});

test('pokój: start tylko gospodarz, ruchy tylko w swojej kolejce, widok bez cudzych sekretów', async () => {
  const { room, a, b } = await roomWith2();
  await send(room, b, { t: 'start' });
  eq(b.last('error').code, 'nothost');
  await send(room, a, { t: 'start' });
  const v = a.view().game;
  assert(v && v.phase === 'draft');
  const me = v.actor === 0 ? a : b, other = me === a ? b : a;
  await send(room, other, { t: 'move', act: { a: 'pickWonder', wonder: v.draft.offer[0] } });
  eq(other.last('error').code, 'move');
  await send(room, me, { t: 'move', id: 'm1', act: { a: 'pickWonder', wonder: v.draft.offer[0] } });
  eq(a.view().game.draft.step, 1);
  await send(room, me, { t: 'move', id: 'm1', act: { a: 'pickWonder', wonder: v.draft.offer[1] } });
  eq(a.view().game.draft.step, 1, 'powtórzony ruch zignorowany');
  assert(!JSON.stringify(a.view()).includes('"token"'), 'brak tokenów graczy w widoku');
});

test('pokój: limit czasu tury — alarm wykonuje ruch domyślny, rewanż po końcu', async () => {
  const { ctx, room, a, b, clock } = await roomWith2();
  await send(room, a, { t: 'cfg', time: 60 });
  await send(room, a, { t: 'start' });
  const d = room.state.deadline;
  eq(d, clock.get() + 60000 + GRACE);
  eq(ctx.alarmAt(), d);
  clock.add(61000 + GRACE);
  await room.alarm();
  eq(a.view().game.draft.step, 1, 'Cud wybrany za gracza');
  assert(room.state.deadline > clock.get(), 'nowy termin dla kolejnego gracza');
  await send(room, a, { t: 'rematch' });
  eq(a.last('error').code, 'phase');
  room.state.game.phase = 'end';
  await send(room, b, { t: 'rematch' });
  eq(room.state.games, 2);
});

// ---------- bot „Kogut Zenek” (bot.js) ----------
// Partia bot kontra bot. Bot dostaje tylko E.view(s, p); każdy ruch musi być na liście legalnych z widoku i przejść przez silnik.
function botGame(levels, seed, rnd, times) {
  const s = E.setup(seed);
  let n = 0;
  while (s.phase !== 'end') {
    const p = E.actor(s), v = E.view(s, p);
    const t0 = performance.now();
    const act = botMove(v, levels[p], rnd);
    if (times) (times[levels[p]] = times[levels[p]] || []).push(performance.now() - t0);
    if (times && levels[p] === 'hard') times.work = Math.max(times.work || 0, lastWork());
    assert(act && legalMoves(v).some(m => JSON.stringify(m) === JSON.stringify(act)), `${levels[p]}: ruch spoza listy legalnych ${JSON.stringify(act)} (seed ${seed})`);
    const r = E.apply(s, p, act);
    assert(r.ok, `${levels[p]}: ${r.err} ${JSON.stringify(act)} (seed ${seed})`);
    assert(++n < 400, 'gra się nie kończy, seed ' + seed);
  }
  return s;
}
// Mecz poziomów a i b: każdy seed dwa razy, z zamianą miejsc (bez przewagi rozdania). Zwraca odsetek punktów a.
function botMatch(a, b, pairs, base, times) {
  let pts = 0;
  for (let k = 0; k < pairs; k++) for (const sw of [0, 1]) {
    const lv = sw ? [b, a] : [a, b];
    const s = botGame(lv, (base + k) * 7919 + 13, rng(base + k + 1), times);
    const w = s.winner.p;
    pts += w == null ? 0.5 : lv[w] === a ? 1 : 0;
  }
  return pts / (2 * pairs);
}

test('bot: 200 partii bot kontra bot na różnych seedach bez błędów i nielegalnych ruchów', () => {
  const PAIRS = [['easy', 'easy'], ['easy', 'medium'], ['medium', 'medium'], ['medium', 'easy'], ['hard', 'easy'], ['medium', 'hard'], ['easy', 'hard'], ['hard', 'hard']];
  const how = {};
  for (let k = 0; k < 200; k++) {
    const s = botGame(PAIRS[k % PAIRS.length], 104729 * (k + 1), rng(k + 77));
    assert(s.winner && ['military', 'science', 'civil'].includes(s.winner.how), 'brak wyniku');
    assert(s.players.every(p => p.coins >= 0) && Math.abs(s.track) <= 7);
    how[s.winner.how] = (how[s.winner.how] || 0) + 1;
  }
  assert(how.civil > 0 && (how.military || 0) + (how.science || 0) > 0, 'różne zakończenia ' + JSON.stringify(how));
});

test('bot: Średni wygrywa z Łatwym w ≥ 75% partii', () => {
  const r = botMatch('medium', 'easy', 50, 3000);
  assert(r >= 0.75, `Średni : Łatwy = ${(100 * r).toFixed(0)}%`);
});

test('bot: Trudny wygrywa ze Średnim w ≥ 60% partii, ruch liczy szybko', () => {
  const times = {};
  const r = botMatch('hard', 'medium', 50, 5000, times);
  assert(r >= 0.6, `Trudny : Średni = ${(100 * r).toFixed(0)}%`);
  const t = times.hard.sort((x, y) => x - y), avg = t.reduce((x, y) => x + y, 0) / t.length;
  assert(avg < 50, `Trudny: średnio ${avg.toFixed(1)} ms na ruch`);
  assert(t[Math.floor(t.length * 0.99)] < 150, `Trudny: 99. percentyl ${t[Math.floor(t.length * 0.99)].toFixed(1)} ms`);
  assert(times.work <= 2000, 'budżet pracy (kopii stanu) na ruch: ' + times.work);
});

test('bot: wybiera tylko na podstawie widoku (zakryte karty go nie zmieniają) i nie wycieka nic z widoku', () => {
  const s = started(21);
  const p = E.actor(s);
  for (let k = 0; k < 6; k++) { const v = E.view(s, p); assertOk(E.apply(s, p, botMove(v, 'medium', rng(k)))); if (E.actor(s) !== p) assertOk(E.apply(s, E.actor(s), botMove(E.view(s, E.actor(s)), 'easy', rng(k)))); }
  const q = E.actor(s);
  const hid = s.layout.map((c, i) => (!c.up ? i : -1)).filter(i => i >= 0);
  assert(hid.length > 1, 'są zakryte karty');
  const other = structuredClone(s);
  const ids = hid.map(i => other.layout[i].id).reverse();
  hid.forEach((i, k) => { other.layout[i].id = ids[k]; });
  eq(E.view(other, q), E.view(s, q), 'widok ten sam');
  for (const lv of LEVELS) eq(botMove(E.view(other, q), lv, rng(9)), botMove(E.view(s, q), lv, rng(9)), lv);
});

test('bot: wybory Odkrycia, zniszczenia i przejęcia na każdym poziomie', () => {
  for (const lv of LEVELS) {
    const s = blank();
    s.turn = 0;
    give(s, 0, 'J-15'); s.players[0].syms = ['Lotka i Atrament'];
    assertOk(E.apply(s, 0, { a: 'build', slot: put(s, 'P-16') }));
    const t = botMove(E.view(s, 0), lv, rng(1));
    assert(t.a === 'token' && s.board.includes(t.token), lv + ': Odkrycie');
    assertOk(E.apply(s, 0, t));
    s.turn = 0;
    s.players[0].wonders = [{ id: 'C-06', built: false }, { id: 'C-09', built: false }];
    give(s, 1, 'J-19', 'J-18', 'J-04', 'J-07');
    assertOk(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-01'), wonder: 'C-06' }));
    const d = botMove(E.view(s, 0), lv, rng(2));
    assert(d.a === 'destroy' && ['J-19', 'J-18'].includes(d.card), lv + ': zniszczenie');
    assertOk(E.apply(s, 0, d));
    s.turn = 0;
    assertOk(E.apply(s, 0, { a: 'wonder', slot: put(s, 'J-02'), wonder: 'C-09' }));
    const st = botMove(E.view(s, 0), lv, rng(3));
    assert(st.a === 'steal' && ['J-04', 'J-07'].includes(st.card), lv + ': przejęcie');
    assertOk(E.apply(s, 0, st));
  }
});

test('bot: Średni i Trudny zabierają rywalowi kartę z natychmiastową wygraną', () => {
  for (const lv of ['medium', 'hard']) {
    const s = blank();
    s.turn = 0;
    s.track = -6;                                     // Kogut 6 pól w stronę gracza 0: rywalowi brakuje 1 Ostrogi
    s.players[0].wonders = [];                        // bez Cudu z dodatkową turą (to też byłaby obrona)
    const free = s.layout.map((c, i) => i).filter(i => E.isFree(s, i));
    free.forEach((i, k) => { s.layout[i].id = ['J-12', 'J-09', 'J-10', 'J-11', 'J-17', 'J-18'][k]; s.layout[i].up = true; });
    const m = botMove(E.view(s, 0), lv, rng(4));
    assert(s.layout[m.slot].id === 'J-12', `${lv}: zostawił rywalowi Strażnicę (${JSON.stringify(m)})`);
  }
});

test('punktacja: guildVP = Pióra z Bractwa w scores(), także dla Bractwa, którego gracz jeszcze nie ma (bot)', () => {
  const s = blank();
  give(s, 0, 'J-11', 'J-09', 'J-01', 'J-07');
  give(s, 1, 'P-07', 'P-08', 'P-09');
  s.players[0].coins = 11;
  eq(E.guildVP(s, 0, 'B-01'), 2, 'Grzebacze: brązowa + szara');
  eq(E.guildVP(s, 0, 'B-06'), 2, 'Grzędowe: 5 niebieskich u obu → 2');
  eq(E.guildVP(s, 0, 'B-04'), 2, 'Kupcy: 11 Ziaren → 2');
  eq(E.guildVP(s, 1, 'B-06'), 2, 'Grzędowe liczą niebieskie obu graczy');
  give(s, 0, 'B-01', 'B-06');
  eq(E.scores(s)[0].guilds, 4);
});

test('bot: pod koniec Ery Koguta Ziarno jest warte tyle, ile daje w punktacji (1 Pióro za 4)', () => {
  let s = null;
  for (let seed = 1; !s; seed++) {   // losowa partia do Ery Koguta (bez wcześniejszej wygranej)
    const t = started(seed), r = rng(seed);
    while (t.phase === 'play' && t.era < 3) randomMove(t, r);
    if (t.phase === 'play' && !t.pending.length) s = t;
  }
  const worth = st => { const a = structuredClone(st), b = structuredClone(st); a.players[0].coins = 8; b.players[0].coins = 12; return evaluate(b, 0) - evaluate(a, 0); };
  const early = worth(s);
  s.layout.forEach((c, i) => { if (i > 0) c.taken = true; });   // w układzie została jedna karta
  const late = worth(s);
  assert(early > 1.3, `początek Ery Koguta: 4 Ziarna warte ${early.toFixed(2)} (Pióro + siła nabywcza)`);
  assert(late < 1.25 && late >= 1 && early - late > 0.25, `koniec gry: 4 Ziarna warte ${late.toFixed(2)}, czyli ~1 Pióro`);
});

test('pokój z botem: gra od razu, bot sam rusza się po alarmie, nigdy za człowieka, rewanż', async () => {
  const ctx = mkCtx(); const room = new KiRoom(ctx, {});
  let t = 1_000_000; room.now = () => t; room.seed = () => 42; room.rand = rng(5);
  eq(await room.init('KOGUT', { bot: 'medium' }), { code: 'KOGUT', bot: 'medium' });
  const a = await connect(room); await send(room, a, { t: 'hello', join: 'Ala' });
  eq(a.last('welcome').seat, 0);
  const v0 = a.view();
  assert(v0.game && v0.game.phase === 'draft', 'gra startuje bez poczekalni');
  eq(v0.seats[1], { name: BOT_NAME, on: true, bot: 'medium' });
  eq(v0.record, null, 'zapis niewidoczny w trakcie gry');
  const c = await connect(room); await send(room, c, { t: 'hello', join: 'Ela' });
  eq(c.last('error').code, 'full', 'miejsce bota zajęte');
  let botMoves = 0, n = 0;
  while (room.state.game.phase !== 'end') {
    assert(++n < 500, 'gra się nie kończy');
    const g = room.state.game, who = E.actor(g), before = JSON.stringify(g);
    if (who === 1) {
      const d = room.state.deadline;
      assert(d - t >= BOT_DELAY[0] && d - t <= BOT_DELAY[1], 'opóźnienie bota ' + (d - t));
      eq(ctx.alarmAt(), d, 'alarm na ruch bota');
      eq(a.view().left, 0, 'bez zegara w turze bota');
      t = d - 1; await room.alarm();
      eq(JSON.stringify(room.state.game), before, 'za wcześnie');
      t = d; await room.alarm();
      assert(JSON.stringify(room.state.game) !== before, 'bot wykonał ruch');
      botMoves++;
    } else {
      eq(room.state.deadline, 0, 'brak terminu dla człowieka bez limitu czasu');
      t += 600_000; await room.alarm();
      eq(JSON.stringify(room.state.game), before, 'bot nie rusza się za człowieka');
      await send(room, a, { t: 'move', id: 'h' + n, act: botMove(a.view().game, 'easy', rng(n)) });
      assert(JSON.stringify(room.state.game) !== before, 'ruch człowieka przyjęty');
    }
  }
  assert(botMoves > 20, 'bot grał całą partię: ' + botMoves);
  // Zapis partii: dopiero po końcu; seed + ruchy odtwarzają ją co do punktu.
  const rec = a.view().record;
  assert(rec && rec.moves.length === n, 'zapis wszystkich ruchów');
  const re = E.setup(rec.seed, rec.names);
  for (const [p, act] of rec.moves) assertOk(E.apply(re, p, act));
  eq(re.score, room.state.game.score, 'odtworzony wynik');
  eq(a.view().game.log.length, room.state.game.log.length, 'pełna historia w widoku');
  await send(room, a, { t: 'rematch' });
  eq(a.view().record, null, 'nowa gra: zapis ukryty');
  eq(room.state.games, 2);
  eq(room.state.seats[1].bot, 'medium', 'rewanż z tym samym botem');
});

test('pokój z botem: limit czasu człowieka działa jak dotąd, nieznany poziom = zwykły pokój', async () => {
  const ctx = mkCtx(); const room = new KiRoom(ctx, {});
  let t = 5_000_000; room.now = () => t; room.seed = () => 7; room.rand = rng(6);
  await room.init('KOGUT', { bot: 'hard' });
  room.state.time = 60;
  const a = await connect(room); await send(room, a, { t: 'hello', join: 'Ala' });
  for (let n = 0; n < 40; n++) {
    const who = E.actor(room.state.game);
    if (who === 0) {
      eq(room.state.deadline, t + 60000 + GRACE, 'termin człowieka');
      assert(a.view().left > 0, 'zegar widoczny w turze człowieka');
      const step = room.state.game.turnNo;
      t = room.state.deadline; await room.alarm();
      assert(room.state.game.turnNo > step || E.actor(room.state.game) !== 0, 'ruch domyślny po czasie');
    } else { t = room.state.deadline; await room.alarm(); }
  }
  const r2 = new KiRoom(mkCtx(), {});
  eq(await r2.init('ZWYKL', { bot: 'mistrz' }), { code: 'ZWYKL' });
  eq(r2.state.seats, [null, null]);
  const res = await new KiRoom(mkCtx(), {}).fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'ABCDE', bot: 'easy' }) }));
  eq(await res.json(), { code: 'ABCDE', bot: 'easy' }, 'init przez fetch (index.js)');
});
