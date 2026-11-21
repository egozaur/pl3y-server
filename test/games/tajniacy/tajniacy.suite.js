// Testy serwera Tajniaków: pokój (TjRoom) i wspólne zapisy (TjSaves), z atrapą ctx i gniazd.
import { TjRoom, TJ_TTL } from '../../../src/games/tajniacy/room.js';
import { TjSaves, SAVES_MAX } from '../../../src/games/tajniacy/saves.js';

export const tjTests = [];
const test = (name, fn) => tjTests.push({ name: 'tajniacy: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

class WS {
  constructor() { this.open = true; this.out = []; this.att = null; this.closed = null; }
  send(d) { if (this.open) this.out.push(JSON.parse(d)); }
  close(code) { this.open = false; this.closed = code; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att == null ? null : structuredClone(this.att); }
  last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (!t || this.out[i].t === t) return this.out[i]; return null; }
}
function mkCtx() {
  const store = new Map(); const sockets = new Set(); let alarm = null;
  return {
    alarmAt: () => alarm, store,
    storage: {
      get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(), setAlarm: async at => { alarm = at; },
    },
    acceptWebSocket: ws => sockets.add(ws), getWebSockets: () => [...sockets].filter(w => w.open),
    setWebSocketAutoResponse() {},
  };
}
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));
async function connect(room) { const ws = new WS(); room.attach(ws, await room.load()); return ws; }
const GAME = () => ({ id: 7, words: Array.from({ length: 25 }, (_, i) => 'SŁOWO' + i), key: 'rrrrrrrrrbbbbbbbbnnnnnnna'.split(''),
  revealed: Array(25).fill(false), turn: 'r', winner: null, hits: { r: 0, b: 0 }, saveId: 5 });

async function setup() {
  const ctx = mkCtx(); const room = new TjRoom(ctx, {});
  const info = await room.init('ABCDE');
  const host = await connect(room);
  await send(room, host, { t: 'hello', host: info.hostToken });
  return { ctx, room, info, host };
}

test('pokój: klucze, zły kapitan, zajęty kod', async () => {
  const { room, info } = await setup();
  assert(info.hostToken && info.cap.r && info.cap.b && info.cap.r !== info.cap.b, 'tokeny');
  const ws = await connect(room);
  await send(room, ws, { t: 'hello', host: 'zly' });
  assert(ws.last('error').code === 'badhost');
  await send(room, ws, { t: 'hello', cap: 'zly' });
  assert(ws.last('error').code === 'badcap');
  await send(room, ws, { t: 'set', game: GAME() });
  assert(ws.last('error').code === 'nohost', 'set bez uprawnień');
  assert(await room.init('ABCDE') === null, 'kod zajęty');
});

test('pokój: prowadzący ustawia grę, kapitanowie dostają widok', async () => {
  const { room, info, host } = await setup();
  const cr = await connect(room), cb = await connect(room);
  await send(room, cr, { t: 'hello', cap: info.cap.r });
  await send(room, cb, { t: 'hello', cap: info.cap.b });
  assert(cr.last('welcome').team === 'r' && cb.last('welcome').team === 'b');
  assert(cr.last('state').view.game === null, 'przed grą brak planszy');
  const g = GAME(); g.revealed[3] = true; g.turn = 'b';
  await send(room, host, { t: 'set', game: g, cfg: { names: { r: 'Lisy', b: 'Sowy' }, theme: 'retro' } });
  const v = cb.last('state').view;
  assert(v.team === 'b' && v.game.revealed[3] === true && v.game.turn === 'b' && v.game.id === 7, 'stan gry');
  assert(v.names.r === 'Lisy' && v.theme === 'retro', 'nazwy i motyw');
  assert(!('saveId' in v.game) && !('hits' in v.game), 'tylko potrzebne pola');
  assert(host.last('state').caps.r === 1 && host.last('state').caps.b === 1, 'licznik kapitanów u prowadzącego');
});

test('pokój: nowa plansza z rotate wydaje nowe kody i rozłącza starych kapitanów', async () => {
  const { room, info, host } = await setup();
  const cr = await connect(room), cb = await connect(room);
  await send(room, cr, { t: 'hello', cap: info.cap.r });
  await send(room, cb, { t: 'hello', cap: info.cap.b });
  await send(room, host, { t: 'set', game: GAME() });
  assert(cr.open && cb.open, 'set bez rotate nie rozłącza');
  assert(!host.last('caps') && room.state.cap.r === info.cap.r, 'set bez rotate nie zmienia kodów');
  const g = { ...GAME(), id: 8 };
  await send(room, host, { t: 'set', game: g, rotate: true });
  assert(cr.closed === 4401 && cb.closed === 4401, 'starzy kapitanowie rozłączeni');
  assert(cr.out.every(m => !(m.view && m.view.game && m.view.game.id === 8)), 'stary kapitan nie dostał nowej planszy');
  const caps = host.last('caps');
  assert(caps && caps.gameId === 8 && caps.cap.r && caps.cap.b && caps.cap.r !== info.cap.r && caps.cap.b !== info.cap.b, 'nowe kody u prowadzącego');
  assert(host.last('state').caps.r === 0 && host.last('state').caps.b === 0, 'licznik kapitanów wyzerowany');
  const old = await connect(room);
  await send(room, old, { t: 'hello', cap: info.cap.r });
  assert(old.last('error').code === 'badcap', 'stary kod nieaktualny');
  const nr = await connect(room);
  await send(room, nr, { t: 'hello', cap: caps.cap.r });
  assert(nr.last('state').view.game.id === 8, 'nowy kod działa');
});

test('pokój: odrzuca zły stan gry, nie gubi poprzedniego', async () => {
  const { room, info, host } = await setup();
  await send(room, host, { t: 'set', game: GAME() });
  for (const bad of [{ ...GAME(), words: ['a'] }, { ...GAME(), key: Array(25).fill('x') }, { ...GAME(), revealed: [] }, 'x']) {
    await send(room, host, { t: 'set', game: bad });
    assert(host.last('error').code === 'badgame', 'odrzucone: ' + JSON.stringify(bad).slice(0, 40));
  }
  const c = await connect(room);
  await send(room, c, { t: 'hello', cap: info.cap.r });
  assert(c.last('state').view.game.id === 7, 'stary stan został');
  host.out = [];
  await room.webSocketMessage(host, 'x'.repeat(20000));
  assert(host.last('error'), 'za duża wiadomość');
});

test('pokój: stan przetrwa restart obiektu, wygasa po TTL', async () => {
  const { ctx, room, info, host } = await setup();
  await send(room, host, { t: 'set', game: GAME() });
  const room2 = new TjRoom(ctx, {});
  const c = await connect(room2);
  await send(room2, c, { t: 'hello', cap: info.cap.b });
  assert(c.last('state').view.game.id === 7, 'po restarcie');
  assert(ctx.alarmAt() > Date.now() + TJ_TTL - 5000, 'alarm TTL');
  room2.state.touchedAt = Date.now() - TJ_TTL - 1;
  await room2.alarm();
  assert(room2.state === null && ctx.store.size === 0, 'wygasł');
  const late = new WS(); room2.attach(late, await room2.load());
  assert(late.closed === 4404, 'nieistniejący pokój');
});

async function call(saves, method, path, body) {
  const r = await saves.fetch(new Request('https://saves' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  return { status: r.status, body: await r.json() };
}

test('zapisy: dodawanie, nadpisywanie, usuwanie, limit', async () => {
  const saves = new TjSaves(mkCtx(), {});
  assert((await call(saves, 'GET', '/')).body.length === 0);
  assert((await call(saves, 'PUT', '/1', { name: 'Piątek', ts: 100, game: GAME(), cfg: { theme: 'noir' } })).status === 200);
  assert((await call(saves, 'PUT', '/2', { name: 'Sobota', ts: 200, game: GAME() })).status === 200);
  assert((await call(saves, 'PUT', '/1', { name: 'Piątek 2', ts: 300, game: GAME() })).status === 200);
  let l = (await call(saves, 'GET', '/')).body;
  assert(l.length === 2 && l[0].id === 1 && l[0].name === 'Piątek 2', 'nadpisane i na górze');
  assert((await call(saves, 'PUT', '/3', { name: '', game: GAME() })).status === 400, 'pusta nazwa');
  assert((await call(saves, 'PUT', '/3', { name: 'x', game: { words: [] } })).status === 400, 'zła gra');
  assert((await call(saves, 'PUT', '/3', { name: 'x', game: { ...GAME(), pad: 'x'.repeat(70000) } })).status === 400, 'za duży');
  await call(saves, 'DELETE', '/1');
  l = (await call(saves, 'GET', '/')).body;
  assert(l.length === 1 && l[0].id === 2, 'usunięte');
  for (let i = 10; i < 10 + SAVES_MAX + 5; i++) await call(saves, 'PUT', '/' + i, { name: 'z' + i, ts: i * 1000, game: GAME() });
  l = (await call(saves, 'GET', '/')).body;
  assert(l.length === SAVES_MAX && l[0].id === 10 + SAVES_MAX + 4, 'limit, najnowsze pierwsze');
  assert((await call(saves, 'GET', '/abc')).status === 404);
});
