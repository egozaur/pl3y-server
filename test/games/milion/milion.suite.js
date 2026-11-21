// Testy serwera Milion: pokój (MlRoom) i wspólny ranking (MlScores), z atrapą ctx i gniazd.
import { MlRoom, LADDER, GRACE, audienceSim, cleanPool } from '../../../src/games/milion/room.js';
import { MlScores, TOP } from '../../../src/games/milion/scores.js';

export const mlTests = [];
const test = (name, fn) => mlTests.push({ name: 'milion: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

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
// pl = gracz z potwierdzonym nickiem (Worker przekazuje go nagłówkiem X-PL3Y-Player)
async function connect(room, pl = null) { const ws = new WS(); room.attach(ws, await room.load(), pl); return ws; }

// Pytanie poziomu L w rundzie R: poprawna zawsze na pozycji (L % 4), zapasowe na ((L+1) % 4).
const Q = (r, l, alt) => ({ q: `R${r} P${l}${alt ? ' zapas' : ''}`, a: ['A', 'B', 'C', 'D'].map(x => `${x}${l}`), ok: alt ? (l + 1) % 4 : l % 4 });
const POOL = () => [0, 1, 2].map(r => LADDER.map((_, l) => ({ m: Q(r, l), s: Q(r, l, true) })));
const okOf = l => l % 4;
const badOf = l => (l + 2) % 4;

async function setup(n = 2, env = {}, verified = 0) {
  const ctx = mkCtx(); const room = new MlRoom(ctx, env);
  let t = 1_000_000; room.now = () => t;
  const clock = { add: ms => { t += ms; }, get: () => t };
  const info = await room.init('ABCDE');
  const host = await connect(room);
  await send(room, host, { t: 'hello', host: info.hostToken });
  const ps = [];
  for (let i = 0; i < n; i++) {
    const ws = await connect(room, i < verified ? { n: 'gracz' + i, nick: 'Gracz' + i } : null);
    await send(room, ws, { t: 'hello', join: 'Gracz' + i });
    ps.push(ws);
  }
  return { ctx, room, info, host, ps, clock };
}
const me = ws => ws.view().me;

test('pula pytań: walidacja', async () => {
  assert(cleanPool(POOL()), 'poprawna pula');
  const bad = POOL(); bad[1][3].m.ok = 7;
  assert(!cleanPool(bad), 'zła poprawna');
  assert(!cleanPool(POOL().slice(0, 2)), 'za mało rund');
});

test('dołączanie: nick, duplikaty, wznowienie tokenem, mecz w toku', async () => {
  const { room, host, ps } = await setup(1);
  const w = await connect(room);
  await send(room, w, { t: 'hello', join: 'gracz0' });
  const tok = w.last('welcome').token;
  assert(me(w).name === 'gracz0 2', 'unikalny nick: ' + me(w).name);
  const again = await connect(room);
  await send(room, again, { t: 'hello', player: tok });
  assert(again.last('welcome').id === me(w).id, 'wznowienie');
  assert(host.view().players.length === 2);
  await send(room, host, { t: 'start', time: 15, pool: POOL() });
  const late = await connect(room);
  await send(room, late, { t: 'hello', join: 'Spóźniony' });
  assert(late.last('error').code === 'started');
  assert(host.view().time === 15 && host.view().phase === 'q');
  assert(ps[0].view().q && ps[0].view().q.ok === undefined, 'brak poprawnej przed odsłonięciem');
});

test('brak wycieku poprawnej odpowiedzi przed odsłonięciem', async () => {
  const { host, ps, room } = await setup(2);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  for (const ws of [host, ...ps]) {
    const raw = JSON.stringify(ws.out.filter(m => m.t === 'state').map(m => m.view.q || null));
    assert(!raw.includes('"ok"'), 'ok w wiadomościach przed odsłonięciem');
  }
  await send(room, ps[0], { t: 'ans', i: okOf(0) });
  assert(!JSON.stringify(ps[1].view()).includes('"ok"'), 'po odpowiedzi jednego gracza nadal bez ok');
  await send(room, ps[1], { t: 'ans', i: okOf(0) });
  assert(host.view().phase === 'reveal' && host.view().q.ok === okOf(0), 'odsłonięcie po odpowiedziach wszystkich');
});

test('punkty: kwota + bonus za kolejność, błąd eliminuje', async () => {
  const { host, ps, room, clock } = await setup(3);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  clock.add(1000); await send(room, ps[2], { t: 'ans', i: okOf(0) });
  clock.add(1000); await send(room, ps[0], { t: 'ans', i: okOf(0) });
  clock.add(1000); await send(room, ps[1], { t: 'ans', i: badOf(0) });
  const v = host.view();
  assert(v.phase === 'reveal');
  const by = Object.fromEntries(v.players.map(p => [p.name, p]));
  assert(by.Gracz2.gain === 600 && by.Gracz2.rank === 1, 'pierwszy +20%: ' + by.Gracz2.gain);
  assert(by.Gracz0.gain === 550 && by.Gracz0.rank === 2, 'drugi +10%');
  assert(by.Gracz1.out && by.Gracz1.gain === 0 && by.Gracz1.correct === false, 'błąd eliminuje');
  assert(me(ps[1]).out && ps[1].view().q.ok === okOf(0), 'wyeliminowany widzi poprawną po odsłonięciu');
  await send(room, host, { t: 'next' });
  assert(host.view().qi === 1 && host.view().phase === 'q');
  assert(!ps[1].view().q, 'wyeliminowany nie dostaje kolejnych pytań');
  // gracz, który odpadł, nie blokuje odsłonięcia
  await send(room, ps[0], { t: 'ans', i: okOf(1) });
  await send(room, ps[2], { t: 'ans', i: okOf(1) });
  assert(host.view().phase === 'reveal');
});

test('limit czasu: alarm odsłania, brak odpowiedzi = odpada', async () => {
  const { host, ps, room, clock, ctx } = await setup(2);
  await send(room, host, { t: 'start', time: 15, pool: POOL() });
  assert(ctx.alarmAt() === clock.get() + 15000 + GRACE, 'alarm na koniec czasu');
  await send(room, ps[0], { t: 'ans', i: okOf(0) });
  clock.add(15000 + GRACE + 1);
  await send(room, ps[1], { t: 'ans', i: okOf(0) });   // za późno
  assert(host.view().phase === 'q', 'spóźniona odpowiedź ignorowana');
  await room.alarm();
  const v = host.view();
  assert(v.phase === 'reveal');
  assert(v.players.find(p => p.name === 'Gracz1').out, 'brak odpowiedzi = odpada');
});

test('runda kończy się, gdy wszyscy odpadną; 3 rundy, suma punktów, zapis rankingu', async () => {
  const posted = [];
  const env = { ML_SCORES: { idFromName: n => n, get: () => ({ fetch: async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); } }) } };
  const { host, ps, room } = await setup(2, env, 2);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  for (let r = 0; r < 3; r++) {
    // pytanie 1: obaj dobrze; pytanie 2: Gracz0 dobrze, Gracz1 źle; pytanie 3: Gracz0 źle -> koniec rundy
    await send(room, ps[0], { t: 'ans', i: okOf(0) }); await send(room, ps[1], { t: 'ans', i: okOf(0) });
    await send(room, host, { t: 'next' });
    await send(room, ps[0], { t: 'ans', i: okOf(1) }); await send(room, ps[1], { t: 'ans', i: badOf(1) });
    await send(room, host, { t: 'next' });
    await send(room, ps[0], { t: 'ans', i: badOf(2) });
    assert(host.view().phase === 'reveal');
    await send(room, host, { t: 'next' });
    if (r < 2) {
      assert(host.view().phase === 'roundEnd', 'koniec rundy ' + r);
      await send(room, host, { t: 'next' });
      assert(host.view().round === r + 1 && host.view().qi === 0 && !me(ps[1]).out, 'nowa runda resetuje');
    }
  }
  const v = host.view();
  assert(v.phase === 'end', 'koniec meczu');
  const g0 = v.players.find(p => p.name === 'Gracz0'), g1 = v.players.find(p => p.name === 'Gracz1');
  assert(g0.total === 3 * (600 + 1200) && g1.total === 3 * 550, 'sumy: ' + g0.total + '/' + g1.total);
  assert(g0.rp.every(x => x === 1800), 'punkty rund');
  assert(posted.length === 1 && posted[0].url.endsWith('/multi'), 'zapis rankingu');
  const e = posted[0].body.entries;
  assert(e.find(x => x.nick === 'Gracz0').win && !e.find(x => x.nick === 'Gracz1').win, 'zwycięzca');
  assert(e.every(x => x.n === x.nick.toLowerCase()), 'wpisy z kluczem gracza');
  await send(room, host, { t: 'next' });
  assert(posted.length === 1, 'bez podwójnego zapisu');
  await send(room, host, { t: 'reset' });
  assert(host.view().phase === 'lobby' && host.view().players.every(p => p.total === 0), 'rewanż');
});

test('runda kończy się po 12 pytaniach', async () => {
  const { host, ps, room } = await setup(1);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  for (let l = 0; l < 12; l++) {
    await send(room, ps[0], { t: 'ans', i: okOf(l) });
    assert(me(ps[0]).correct, 'poprawna ' + l);
    await send(room, host, { t: 'next' });
  }
  assert(host.view().phase === 'roundEnd');
  assert(me(ps[0]).total === Math.round(LADDER.reduce((a, b) => a + b, 0) * 1.2), 'wszystkie pytania z bonusem');
});

test('koła: 50:50 zostawia poprawną, zamiana daje zapasowe, raz na rundę', async () => {
  const { host, ps, room } = await setup(2);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  await send(room, ps[0], { t: 'life', k: 'f' });
  const f = me(ps[0]).fifty;
  assert(f.length === 2 && !f.includes(okOf(0)), '50:50 usuwa 2 złe');
  assert(!me(ps[1]).fifty.length, '50:50 tylko u siebie');
  await send(room, ps[0], { t: 'ans', i: f[0] });
  assert(me(ps[0]).ans === null, 'nie można kliknąć usuniętej');
  await send(room, ps[1], { t: 'life', k: 's' });
  assert(ps[1].view().q.q.includes('zapas') && !ps[0].view().q.q.includes('zapas'), 'zamiana tylko u siebie');
  assert(host.view().sq && host.view().sq.q.ok === undefined, 'TV: zapasowe bez poprawnej przed odsłonięciem');
  await send(room, ps[0], { t: 'ans', i: okOf(0) });
  await send(room, ps[1], { t: 'ans', i: (0 + 1) % 4 });   // poprawna zapasowego
  assert(me(ps[1]).correct, 'liczy się zapasowe pytanie');
  const hv = host.view();
  assert(hv.sq && hv.sq.q.q.includes('zapas') && hv.sq.q.ok === 1 && hv.sq.names.join() === 'Gracz1', 'TV: zapasowe z poprawną przy odsłonięciu');
  assert(hv.sq.counts[1] === 1 && hv.counts[1] === 0, 'TV: osobne liczniki odpowiedzi');
  await send(room, host, { t: 'next' });
  assert(!host.view().sq, 'TV: bez zamiany brak sq');
  await send(room, ps[0], { t: 'life', k: 'f' });
  assert(!me(ps[0]).fifty.length && !me(ps[0]).life.f, 'drugi raz w rundzie nie działa');
});

test('publiczność: symulacja bez widzów, głosy wyeliminowanych', async () => {
  const { host, ps, room } = await setup(3);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  await send(room, ps[0], { t: 'life', k: 'a' });
  const a = me(ps[0]).aud;
  assert(a.sim && a.pct.reduce((x, y) => x + y, 0) === 100, 'symulacja sumuje się do 100');
  // Gracz2 odpada, potem głosuje dla Gracza1
  await send(room, ps[0], { t: 'ans', i: okOf(0) }); await send(room, ps[1], { t: 'ans', i: okOf(0) }); await send(room, ps[2], { t: 'ans', i: badOf(0) });
  await send(room, host, { t: 'next' });
  await send(room, ps[1], { t: 'life', k: 'a' });
  assert(!me(ps[1]).aud.sim && me(ps[1]).aud.n === 0, 'czeka na głosy');
  const req = ps[2].view().audReq;
  assert(req.length === 1 && req[0].pid === me(ps[1]).id && req[0].q.ok === undefined, 'prośba bez poprawnej');
  await send(room, ps[2], { t: 'vote', pid: me(ps[1]).id, i: 3 });
  assert(me(ps[1]).aud.n === 1 && me(ps[1]).aud.pct[3] === 100, 'głos policzony');
  assert(!ps[2].view().audReq.length, 'jeden głos na osobę');
  await send(room, ps[0], { t: 'vote', pid: me(ps[1]).id, i: 1 });
  assert(me(ps[1]).aud.n === 1, 'grający nie głosują');
});

test('audienceSim: zakresy i 50:50', async () => {
  let seed = 1; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let lead = 0;
  for (let i = 0; i < 400; i++) {
    const p = audienceSim(2, 0, [0, 3], r);
    assert(p.reduce((a, b) => a + b, 0) === 100 && p[0] === 0 && p[3] === 0, 'suma i usunięte: ' + p);
    if (p[2] > p[1]) lead++;
  }
  assert(lead > 300, 'łatwe pytania: zwykle poprawna wygrywa (' + lead + ')');
});

test('prowadzący: tylko host steruje, wyrzucanie w lobby', async () => {
  const { host, ps, room } = await setup(2);
  await send(room, ps[0], { t: 'start', time: 30, pool: POOL() });
  assert(host.view().phase === 'lobby', 'gracz nie startuje');
  const id = me(ps[1]).id;
  await send(room, host, { t: 'kick', id });
  assert(ps[1].closed === 4401 && host.view().players.length === 1, 'wyrzucony');
  await send(room, host, { t: 'start', time: 30, pool: [] });
  assert(host.last('error').code === 'badpool');
});

function mkScores() {
  const store = new Map();
  return new MlScores({ storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); } } }, {});
}
const req = (s, method, path, body) => s.fetch(new Request('https://scores' + path, { method, body: body ? JSON.stringify(body) : undefined })).then(r => r.json().then(j => ({ status: r.status, j })));

// wpisy z kluczem gracza n (Worker dopisuje go po sprawdzeniu tokena gracza)
const P = (nick, x) => ({ nick, n: nick.toLowerCase(), ...x });
test('ranking: solo (walidacja, sortowanie, limit), multi, wygrane', async () => {
  const s = mkScores();
  assert((await req(s, 'POST', '/solo', P('Ala', { amount: 1234, qs: 3 }))).status === 400, 'kwota spoza drabinki');
  assert((await req(s, 'POST', '/solo', { nick: '', n: 'x', amount: 500, qs: 1 })).status === 400, 'bez nicku');
  assert((await req(s, 'POST', '/solo', { nick: 'Bez', amount: 500, qs: 1 })).status === 400, 'bez potwierdzonego gracza');
  await req(s, 'POST', '/solo', P('Ala', { amount: 40000, qs: 8 }));
  await req(s, 'POST', '/solo', P('Ola', { amount: 1000000, qs: 12 }));
  for (let i = 0; i < TOP + 5; i++) await req(s, 'POST', '/solo', P('X' + i, { amount: 500, qs: 1 }));
  await req(s, 'POST', '/multi', { entries: [P('Ala', { pts: 5000, win: true }), P('Ola', { pts: 300, win: false }), P('Ala', { pts: 99e9, win: true }), { nick: 'Gość', pts: 100, win: false }] });
  await req(s, 'POST', '/multi', { entries: [P('Ala', { pts: 7000, win: true })] });
  const { j } = await req(s, 'GET', '/');
  assert(j.solo.length === TOP && j.solo[0].nick === 'Ola' && j.solo[1].nick === 'Ala', 'solo');
  assert(j.multi[0].pts === 7000 && j.multi.length === 3, 'multi (bez absurdalnych wyników)');
  assert(j.wins[0].nick === 'Ala' && j.wins[0].n === 2, 'wygrane');
  assert(j.solo.every(e => e.lvl === 'n'), 'bez poziomu = normalny');
  assert(!j.multi.some(e => e.nick === 'Gość'), 'gość bez PIN-u poza rankingiem');
  assert(!j.solo.some(e => 'n' in e) && !j.multi.some(e => 'n' in e), 'klucz gracza nie wychodzi na zewnątrz');
});

test('ranking solo: osobne listy i miejsca dla poziomów', async () => {
  const s = mkScores();
  for (let i = 0; i < TOP + 3; i++) await req(s, 'POST', '/solo', P('N' + i, { amount: 1000, qs: 2, lvl: 'n' }));
  const r = await req(s, 'POST', '/solo', P('Ex', { amount: 500, qs: 1, lvl: 'x' }));
  assert(r.j.rank === 1, 'pierwsze miejsce na ekstremalnym: ' + r.j.rank);
  await req(s, 'POST', '/solo', P('Ea', { amount: 2000, qs: 3, lvl: 'e' }));
  await req(s, 'POST', '/solo', P('Zly', { amount: 2000, qs: 3, lvl: 'zzz' }));
  const { j } = await req(s, 'GET', '/');
  const of = l => j.solo.filter(e => e.lvl === l);
  assert(of('n').length === TOP && of('x').length === 1 && of('e').length === 1, 'limit na poziom');
  assert(!j.solo.some(e => e.nick === 'Zly'), 'zły poziom odrzucony');
});

test('emotki: lecą tylko do TV, limit tempa, walidacja indeksu', async () => {
  const { room, host, ps, clock } = await setup(2);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  const n0 = host.out.filter(m => m.t === 'emo').length;
  await send(room, ps[0], { t: 'emo', e: 3 });
  const em = host.out.filter(m => m.t === 'emo');
  assert(em.length === n0 + 1 && em[em.length - 1].e === 3 && em[em.length - 1].name === 'Gracz0', 'host dostał emotkę');
  assert(!ps[1].out.some(m => m.t === 'emo') && !ps[0].out.some(m => m.t === 'emo'), 'telefony nie dostają emotek');
  await send(room, ps[0], { t: 'emo', e: 4 });
  assert(host.out.filter(m => m.t === 'emo').length === n0 + 1, 'limit tempa');
  clock.add(1500);
  await send(room, ps[0], { t: 'emo', e: 99 });
  await send(room, ps[0], { t: 'emo', e: -1 });
  await send(room, ps[0], { t: 'emo', e: 'x' });
  assert(host.out.filter(m => m.t === 'emo').length === n0 + 1, 'zły indeks odrzucony');
  await send(room, ps[0], { t: 'emo', e: 7 });
  assert(host.out.filter(m => m.t === 'emo').length === n0 + 2, 'po przerwie znów działa');
});

test('statystyki meczu: najszybsza poprawna, seria, koła', async () => {
  const { room, host, ps, clock } = await setup(2);
  await send(room, host, { t: 'start', time: 30, pool: POOL() });
  clock.add(2000);
  await send(room, ps[0], { t: 'ans', i: okOf(0) });
  await send(room, ps[1], { t: 'ans', i: badOf(0) });
  let pl = host.view().players;
  assert(pl[0].fast >= 2000 && pl[0].fast < 2100 && pl[0].best === 1, 'gracz 0: czas i seria');
  assert(pl[1].fast === null && pl[1].best === 0, 'gracz 1: brak poprawnych');
  await send(room, host, { t: 'next' });
  await send(room, ps[0], { t: 'life', k: 'f' });
  await send(room, ps[0], { t: 'ans', i: okOf(1) });
  pl = host.view().players;
  assert(pl[0].best === 2 && pl[0].used === 1, 'seria 2, jedno koło');
});
