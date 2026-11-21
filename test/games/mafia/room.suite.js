// Testy protokołu Durable Object (Room) z atrapą ctx i gniazd.
import { Room } from '../../../src/games/mafia/room.js';

export const roomTests = [];
const test = (name, fn) => roomTests.push({ name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

class WS {
  constructor() { this.open = true; this.out = []; this.att = null; this.closed = null; }
  send(d) { if (this.open) this.out.push(JSON.parse(d)); }
  close(code) { this.open = false; this.closed = code; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att == null ? null : structuredClone(this.att); }
  last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (!t || this.out[i].t === t) return this.out[i]; return null; }
  clear() { this.out = []; }
}
function mkRoom() {
  const store = new Map(); const sockets = new Set(); let alarm = null;
  const ctx = {
    storage: {
      get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(), setAlarm: async at => { alarm = at; },
    },
    acceptWebSocket: ws => sockets.add(ws), getWebSockets: () => [...sockets].filter(w => w.open),
    setWebSocketAutoResponse() {},
  };
  const room = new Room(ctx, {});
  return { room, store, alarmAt: () => alarm };
}
async function connect(room) { const ws = new WS(); room.attach(ws, await room.load()); return ws; }
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));

async function setup(n = 6) {
  const R = mkRoom();
  const { hostToken } = await R.room.init('ABCDE');
  const host = await connect(R.room);
  await send(R.room, host, { t: 'hello', host: hostToken });
  const players = [];
  for (let i = 0; i < n; i++) {
    const ws = await connect(R.room);
    await send(R.room, ws, { t: 'hello' });
    await send(R.room, ws, { t: 'join', name: 'Osoba' + i });
    const tok = ws.last('token');
    players.push({ ws, token: tok.token, pid: tok.pid });
  }
  return { ...R, host, hostToken, players };
}

test('room: zły klucz gospodarza i zły token gracza', async () => {
  const R = mkRoom();
  await R.room.init('ABCDE');
  const ws = await connect(R.room);
  await send(R.room, ws, { t: 'hello', host: 'zly' });
  assert(ws.last('error').code === 'badhost');
  await send(R.room, ws, { t: 'act', id: 'x', action: { a: 'start' } });
  assert(ws.last('ack').ok === false, 'akcja bez autoryzacji');
  await send(R.room, ws, { t: 'hello', token: 'zly' });
  assert(ws.last('error').code === 'badtoken');
  assert(await R.room.init('ABCDE') === null, 'kod zajęty');
});

test('room: rola trafia tylko do gniazda właściciela', async () => {
  const { room, host, players } = await setup(6);
  await send(room, host, { t: 'act', id: 'a1', action: { a: 'start' } });
  assert(host.last('ack').ok, 'start');
  const p0 = players[0];
  await send(room, p0.ws, { t: 'act', id: 'o1', action: { a: 'open' } });
  const mine = p0.ws.last('state').view;
  assert(mine.role && mine.role.name, 'właściciel widzi rolę');
  for (const p of players.slice(1)) assert(!p.ws.last('state').view.role, 'inny gracz nie widzi roli');
  const scr = JSON.stringify(host.last('state').view);
  assert(!scr.includes(mine.role.ability), 'ekran nie zna roli');
  assert(!scr.includes(p0.token), 'ekran nie zna tokenów');
});

test('room: deduplikacja ponowionej akcji', async () => {
  const { room, host, store } = await setup(5);
  await send(room, host, { t: 'act', id: 'same', action: { a: 'start' } });
  const rev = store.get('state').rev;
  await send(room, host, { t: 'act', id: 'same', action: { a: 'start' } });
  assert(host.last('ack').dup === true, 'oznaczona jako duplikat');
  assert(store.get('state').rev === rev, 'stan nie zmieniony');
});

test('room: odświeżenie strony = ten sam gracz po tokenie', async () => {
  const { room, players } = await setup(5);
  const p = players[2];
  p.ws.close();
  const ws2 = await connect(room);
  await send(room, ws2, { t: 'hello', token: p.token });
  assert(ws2.last('welcome').pid === p.pid);
  assert(ws2.last('state').view.me.id === p.pid);
});

test('room: rebind zamyka stary telefon; usunięcie zamyka gniazdo', async () => {
  const { room, host, players } = await setup(6);
  await send(room, host, { t: 'act', id: 'a1', action: { a: 'start' } });
  await send(room, host, { t: 'act', id: 'a2', action: { a: 'rebind', id: players[1].pid } });
  const code = host.last('ack').data.rebind.token;
  const ws = await connect(room);
  await send(room, ws, { t: 'hello' });
  await send(room, ws, { t: 'rebind', code });
  assert(ws.last('token').pid === players[1].pid, 'nowy telefon przejął miejsce');
  assert(players[1].ws.closed === 4401, 'stary telefon rozłączony');
  const ws3 = await connect(room);
  await send(room, ws3, { t: 'rebind', code });
  assert(ws3.last('error').code === 'badrebind', 'kod jednorazowy');
  await send(room, host, { t: 'act', id: 'a3', action: { a: 'kick', id: players[3].pid } });
  assert(players[3].ws.closed === 4401, 'usunięty rozłączony');
});

test('room: alarm kończy fazę po czasie i planuje kolejny', async () => {
  const { room, host, players, store, alarmAt } = await setup(5);
  await send(room, host, { t: 'act', id: 'a1', action: { a: 'start' } });
  for (const p of players) {
    await send(room, p.ws, { t: 'act', id: 'o', action: { a: 'open' } });
    await send(room, p.ws, { t: 'act', id: 'm', action: { a: 'memorized' } });
  }
  await send(room, host, { t: 'act', id: 'a2', action: { a: 'begin' } });
  const s = store.get('state');
  assert(s.phase === 'night', 'noc');
  assert(alarmAt() === s.endsAt, 'alarm na koniec nocy');
  // przestawiamy czas nocy w przeszłość i odpalamy alarm
  s.endsAt = Date.now() - 1; store.set('state', s); room.state = undefined;
  await room.alarm();
  assert(store.get('state').phase === 'day', 'po alarmie dzień');
  assert(host.last('state').view.phase === 'day', 'rozesłano stan');
});

test('room: za duża lub błędna wiadomość nie psuje pokoju', async () => {
  const { room, host } = await setup(5);
  await room.webSocketMessage(host, 'x'.repeat(5000));
  assert(host.last('error'), 'odrzucona');
  await room.webSocketMessage(host, '{nie json');
  await send(room, host, { t: 'act', id: 'z', action: { a: 'kick', id: 'p999' } });
  assert(host.last('ack').ok === false);
  await send(room, host, { t: 'act', id: 'z2', action: { a: 'start' } });
  assert(host.last('ack').ok === true);
});
