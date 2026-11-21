// Testy Tajniaków dla 2 osób (Duet): silnik (duo-engine.js) i pokój (TjDuo), z atrapą ctx i gniazd.
import * as E from '../../../src/games/tajniacy/duo-engine.js';
import { TjDuo } from '../../../src/games/tajniacy/duo.js';

export const tjDuoTests = [];
const test = (name, fn) => tjDuoTests.push({ name: 'tajniacy duo: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg || ''} oczekiwano ${JSON.stringify(b)}, jest ${JSON.stringify(a)}`);
const ok = r => assert(r && r.ok, r && r.err);

const WORDS = Array.from({ length: 25 }, (_, i) => 'słowo' + i);
const game = (seed = 1, turns = 9) => E.setup(seed, WORDS, turns, ['Ala', 'Ola']);
// Indeks karty o danej parze (klucz gracza 0, klucz gracza 1), pomijając podane.
const find = (g, k0, k1, skip = []) => g.keys[0].findIndex((k, i) => k === k0 && g.keys[1][i] === k1 && !skip.includes(i));

test('układ kluczy: 9 agentów i 3 zabójców na klucz, 3 wspólnych, 15 razem', () => {
  for (let seed = 1; seed < 30; seed++) {
    const g = game(seed);
    for (const s of [0, 1]) {
      eq(g.keys[s].filter(k => k === 'g').length, 9, 'agenci');
      eq(g.keys[s].filter(k => k === 'a').length, 3, 'zabójcy');
    }
    eq(g.keys[0].filter((k, i) => k === 'g' && g.keys[1][i] === 'g').length, 3, 'wspólni');
    eq(g.keys[0].filter((k, i) => k === 'g' || g.keys[1][i] === 'g').length, E.AGENTS_TOTAL);
    eq(E.AGENTS_TOTAL, 15);
  }
  const keys = new Set(Array.from({ length: 10 }, (_, s) => game(s + 1).keys[0].join('')));
  assert(keys.size > 5, 'klucze są losowe');
});

test('słowa: 25 różnych, niepuste', () => {
  assert(E.cleanWords(WORDS), 'poprawne');
  assert(!E.cleanWords(WORDS.slice(1)), '24 słowa');
  assert(!E.cleanWords([...WORDS.slice(1), 'SŁOWO1']), 'duplikat bez względu na wielkość liter');
  assert(!E.cleanWords([...WORDS.slice(1), '  ']), 'puste');
});

test('tura: tylko podający podaje hasło, tylko zgadujący klika, sprawdzanie według klucza podającego', () => {
  const g = game(3);
  const p = g.giver, q = 1 - p;
  assert(E.apply(g, q, { a: 'clue', word: 'x', n: 1 }).err, 'zgadujący nie podaje hasła');
  assert(E.apply(g, p, { a: 'guess', i: 0 }).err, 'przed hasłem nie ma zgadywania');
  assert(E.apply(g, p, { a: 'clue', word: 'owoc', n: 0 }).err, 'liczba 0 odrzucona');
  ok(E.apply(g, p, { a: 'clue', word: 'owoc', n: 2 }));
  assert(E.apply(g, p, { a: 'guess', i: 0 }).err, 'podający nie klika');
  const agent = g.keys[p].indexOf('g');
  ok(E.apply(g, q, { a: 'guess', i: agent }));
  assert(g.found[agent] && g.phase === 'guess', 'agent podającego odkryty, zgadujemy dalej');
  assert(E.apply(g, q, { a: 'guess', i: agent }).err, 'drugi raz ta sama karta');
});

test('postronny kończy turę i jest oznaczony tylko po stronie podającego', () => {
  const g = game(4);
  const p = g.giver, q = 1 - p;
  const i = p === 0 ? find(g, 'n', 'g') : find(g, 'g', 'n');
  ok(E.apply(g, p, { a: 'clue', word: 'x', n: 1 }));
  ok(E.apply(g, q, { a: 'guess', i }));
  assert(g.miss[p][i] && !g.miss[q][i] && !g.found[i], 'pudło tylko u podającego');
  eq([g.giver, g.phase, g.turnNo], [q, 'clue', 2], 'zmiana ról');
  // Teraz podaje q, a ta karta jest jego agentem: można ją odkryć.
  ok(E.apply(g, q, { a: 'clue', word: 'y', n: 1 }));
  ok(E.apply(g, p, { a: 'guess', i }));
  assert(g.found[i], 'agent drugiego gracza odkryty mimo wcześniejszego pudła');
});

test('limit prób: dokładnie liczba przy haśle, potem koniec tury', () => {
  const g = game(5, 0);
  const p = g.giver, q = 1 - p;
  ok(E.apply(g, p, { a: 'clue', word: 'x', n: 2 }));
  eq(E.view(g, q).max, 2);
  const ag = g.keys[p].map((k, i) => (k === 'g' ? i : -1)).filter(i => i >= 0);
  ok(E.apply(g, q, { a: 'guess', i: ag[0] }));
  eq(g.phase, 'guess');
  ok(E.apply(g, q, { a: 'guess', i: ag[1] }));
  eq([g.phase, g.giver], ['clue', q], 'po 2 trafieniach przy haśle „x · 2” tura się kończy');
  ok(E.apply(g, q, { a: 'clue', word: 'y', n: 1 }));
  ok(E.apply(g, p, { a: 'guess', i: g.keys[q].findIndex((k, i) => k === 'g' && !g.found[i]) }));
  eq([g.phase, g.giver], ['clue', p], 'przy liczbie 1 jedna próba');
});

test('hasło: jedno słowo, nie ze słów z planszy ani ich części', () => {
  const words = ['cyrk', 'Kotwica', 'rakieta', ...WORDS.slice(3)];
  const g = E.setup(12, words, 9, ['Ala', 'Ola']);
  const p = g.giver;
  assert(/jedno słowo/.test(E.apply(g, p, { a: 'clue', word: 'dwa słowa', n: 1 }).err), 'spacja');
  assert(E.apply(g, p, { a: 'clue', word: 'CYRK', n: 1 }).err, 'to samo słowo, inna wielkość liter');
  assert(E.apply(g, p, { a: 'clue', word: 'cyrkowy', n: 1 }).err, 'zawiera słowo z planszy');
  assert(E.apply(g, p, { a: 'clue', word: 'kot', n: 1 }).err, 'część słowa z planszy');
  assert(/rakieta/.test(E.apply(g, p, { a: 'clue', word: 'rak', n: 1 }).err), 'komunikat podaje słowo');
  eq(g.phase, 'clue', 'odrzucone hasła nic nie zmieniają');
  ok(E.apply(g, p, { a: 'clue', word: 'klaun', n: 1 }));
  eq(E.clashWord(words, 'Cyrkowiec'), 'cyrk');
  eq(E.clashWord(words, 'klaun'), null);
});

test('zabójca podającego = przegrana; poddanie = przegrana', () => {
  const g = game(6);
  const p = g.giver, q = 1 - p;
  ok(E.apply(g, p, { a: 'clue', word: 'x', n: 1 }));
  ok(E.apply(g, q, { a: 'guess', i: g.keys[p].indexOf('a') }));
  eq([g.phase, g.result.win, g.result.reason], ['end', false, 'assassin']);
  assert(E.apply(g, q, { a: 'end' }).err, 'po końcu nic');
  const h = game(7);
  ok(E.apply(h, 1, { a: 'surrender' }));
  eq([h.result.reason, h.result.by], ['surrender', 1]);
});

test('limit tur: po ostatniej turze przegrana', () => {
  const g = game(8, 9);
  for (let t = 1; t <= 9; t++) {
    eq(g.phase, 'clue', 'tura ' + t);
    ok(E.apply(g, g.giver, { a: 'clue', word: 'x', n: 1 }));
    ok(E.apply(g, 1 - g.giver, { a: 'end' }));
  }
  eq([g.phase, g.result.reason], ['end', 'time']);
});

test('pełna wygrana: wszyscy agenci; gracz bez agentów nie podaje', () => {
  const g = game(9, 0);
  let guard = 0;
  while (g.phase !== 'end' && guard++ < 200) {
    const p = g.giver;
    ok(E.apply(g, p, { a: 'clue', word: 'x', n: 9 }));
    const i = g.keys[p].findIndex((k, j) => k === 'g' && !g.found[j]);
    ok(E.apply(g, 1 - p, { a: 'guess', i }));
    if (g.phase === 'guess') ok(E.apply(g, 1 - p, { a: 'end' }));
    if (g.phase === 'clue') assert(E.view(g, g.giver).myLeft > 0, 'podający ma agentów');
  }
  eq([g.phase, g.result.win, E.foundCount(g)], ['end', true, 15]);
});

test('widok: tylko własny klucz, cudzy dopiero po końcu', () => {
  const g = game(10);
  const v0 = E.view(g, 0), v1 = E.view(g, 1);
  eq(v0.key, g.keys[0]); eq(v1.key, g.keys[1]);
  assert(v0.partnerKey === null && !('keys' in v0), 'bez klucza partnera');
  ok(E.apply(g, 0, { a: 'surrender' }));
  eq(E.view(g, 0).partnerKey, g.keys[1]);
});

// ---------- pokój ----------
test('serwer: index.js eksportuje TjDuo (wymagane przez wrangler.toml)', async () => {
  const W = await import('../../../src/index.js');
  assert(W.TjDuo === TjDuo, 'brak eksportu TjDuo');
});

class WS {
  constructor() { this.open = true; this.out = []; this.att = null; }
  send(d) { if (this.open) this.out.push(JSON.parse(d)); }
  close(code) { this.open = false; this.closed = code; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att == null ? null : structuredClone(this.att); }
  last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (!t || this.out[i].t === t) return this.out[i]; return null; }
  view() { const m = this.last('state'); return m && m.view; }
}
function mkCtx() {
  const store = new Map(); const sockets = new Set();
  return {
    storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, deleteAll: async () => store.clear(), setAlarm: async () => {} },
    acceptWebSocket: ws => sockets.add(ws), getWebSockets: () => [...sockets].filter(w => w.open), setWebSocketAutoResponse() {},
  };
}
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));
async function connect(room) { const ws = new WS(); room.attach(ws, await room.load()); return ws; }

test('pokój: dwa miejsca, start gospodarza ze słowami, każdy widzi tylko swój klucz', async () => {
  const room = new TjDuo(mkCtx(), {}); room.seed = () => 11;
  await room.init('DUETA');
  const a = await connect(room); await send(room, a, { t: 'hello', join: 'Ala' });
  const b = await connect(room); await send(room, b, { t: 'hello', join: 'Ola' });
  const c = await connect(room); await send(room, c, { t: 'hello', join: 'Ela' });
  eq(c.last('error').code, 'full');
  await send(room, b, { t: 'start', words: WORDS });
  eq(b.last('error').code, 'nothost');
  await send(room, a, { t: 'cfg', turns: 11 });
  await send(room, a, { t: 'start', words: WORDS.slice(1) });
  eq(a.last('error').code, 'badwords');
  await send(room, a, { t: 'start', words: WORDS });
  const va = a.view(), vb = b.view();
  eq([va.game.turns, va.game.words.length], [11, 25]);
  eq(va.game.key, room.state.game.keys[0]); eq(vb.game.key, room.state.game.keys[1]);
  assert(!JSON.stringify(va).includes('"token"') && va.game.partnerKey === null, 'bez sekretów');
  const p = va.game.giver, gv = p === 0 ? a : b, gs = p === 0 ? b : a;
  await send(room, gs, { t: 'move', act: { a: 'clue', word: 'x', n: 1 } });
  eq(gs.last('error').code, 'move');
  await send(room, gv, { t: 'move', id: 'm1', act: { a: 'clue', word: 'owoc', n: 2 } });
  eq(a.view().game.clue, { word: 'owoc', n: 2 });
  await send(room, gs, { t: 'move', id: 'm2', act: { a: 'surrender' } });
  eq(b.view().game.phase, 'end');
  assert(b.view().game.partnerKey, 'po końcu klucz partnera');
  await send(room, b, { t: 'start', words: WORDS });
  eq([a.view().games, a.view().game.phase], [2, 'clue'], 'nowa gra po końcu (każdy może zacząć)');
  const back = await connect(room); await send(room, back, { t: 'hello', player: b.last('welcome').token });
  eq(back.last('welcome').seat, 1, 'powrót tokenem');
});
