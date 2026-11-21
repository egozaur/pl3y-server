// Testy bramki autoryzacji (tokeny HMAC), limitów tempa i skróconego TTL po zakończeniu gry.
import { signToken, verifyToken, login, refresh, safeEqual, authMode, tokenFrom, TTL_MS } from '../../src/core/auth.js';
import { Bucket, IpLimiter, limitMessage, ttlFor, ENDED_TTL, WS_BURST, WS_MAX_STRIKES } from '../../src/core/limits.js';
import worker, { limitKind } from '../../src/index.js';
import { KiRoom, KI_TTL } from '../../src/games/kurczacze/room.js';
import { Room } from '../../src/games/mafia/room.js';

export const authTests = [];
const test = (name, fn) => authTests.push({ name: 'auth/limity: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

const SECRET = 'klucz-do-testow-1234567890';
const ENV = { PL3Y_PASSWORD: 'bardzo długie hasło testowe 123', PL3Y_TOKEN_SECRET: SECRET, PL3Y_TEST_SECRET: 'sekret-e2e', AUTH_MODE: 'required',
  ALLOWED_ORIGINS: 'https://pl3y.pl', ALLOW_LOCALHOST: 'false' };
const MIN = 60 * 1000, H = 60 * MIN;
const p0 = x => x.token;

// ---------- tokeny ----------

test('token: podpis, weryfikacja i czas życia wg rodzaju (30 min / 12 h / test 1 h)', async () => {
  const t0 = 1_800_000_000_000;
  for (const [k, ttl] of [['d', 30 * MIN], ['p', 12 * H], ['t', H]]) {
    const { token, exp } = await signToken(SECRET, k, t0);
    assert(exp === t0 + ttl && TTL_MS[k] === ttl, 'exp ' + k);
    const p = await verifyToken(SECRET, token, t0 + ttl - 1);
    assert(p && p.k === k, 'ważny tuż przed końcem ' + k);
    assert(!(await verifyToken(SECRET, token, t0 + ttl)), 'wygasa w chwili exp ' + k);
  }
});

test('token: zmiana treści, zły klucz i śmieci są odrzucane', async () => {
  const { token } = await signToken(SECRET, 'd', 1000);
  const [pay, sig] = token.split('.');
  const forged = JSON.parse(atob(pay.replace(/-/g, '+').replace(/_/g, '/')));
  forged.k = 'p'; forged.exp = 9e15;                         // próba podniesienia profilu i czasu
  const fpay = btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert(!(await verifyToken(SECRET, fpay + '.' + sig, 2000)), 'podrobiona treść');
  assert(!(await verifyToken('inny-klucz', token, 2000)), 'zły klucz');
  for (const bad of ['', 'abc', '.', 'a.b', null, undefined, 5, 'x'.repeat(400)]) assert(!(await verifyToken(SECRET, bad, 2000)), 'śmieć ' + String(bad).slice(0, 8));
  assert(!(await verifyToken('', token, 2000)), 'brak klucza po stronie serwera nie przepuszcza');
});

test('safeEqual porównuje bez względu na długość', async () => {
  assert(await safeEqual('abc', 'abc'), 'równe');
  assert(!(await safeEqual('abc', 'abcd')) && !(await safeEqual('', 'a')), 'różne');
});

// ---------- logowanie ----------

test('login: poprawne hasło daje token d lub p, złe i puste dają 401', async () => {
  const d = await login(ENV, { password: ENV.PL3Y_PASSWORD, profile: 'd' }, 5000);
  const p = await login(ENV, { password: ENV.PL3Y_PASSWORD, profile: 'p' }, 5000);
  assert(d.status === 200 && d.kind === 'd' && d.exp === 5000 + 30 * MIN, 'desktop 30 min');
  assert(p.status === 200 && p.kind === 'p' && p.exp === 5000 + 12 * H, 'telefon 12 h');
  assert((await login(ENV, { password: 'zle' })).status === 401, 'złe hasło');
  assert((await login(ENV, { password: '' })).status === 401 && (await login(ENV, null)).status === 401 && (await login(ENV, {})).status === 401, 'puste');
  assert((await login(ENV, { password: 5 })).status === 401, 'nie-tekst');
});

test('login: sekret testowy daje token t, błędny nie; bez sekretów serwer odmawia (503)', async () => {
  const t = await login(ENV, { test: ENV.PL3Y_TEST_SECRET }, 7000);
  assert(t.status === 200 && t.kind === 't' && t.exp === 7000 + H, 'token testowy 1 h');
  assert((await login(ENV, { test: 'zly' })).status === 401, 'zły sekret testowy');
  assert((await login({ ...ENV, PL3Y_TEST_SECRET: undefined }, { test: 'cokolwiek' })).status === 401, 'bez sekretu testowego nie ma tokena t');
  assert((await login({ ...ENV, PL3Y_PASSWORD: undefined }, { password: 'x' })).status === 503, 'brak hasła w sekretach');
  assert((await login({ ...ENV, PL3Y_TOKEN_SECRET: undefined }, { password: ENV.PL3Y_PASSWORD })).status === 503, 'brak klucza sesji');
});

test('refresh: przesuwa okno tego samego rodzaju, wygasły i obcy nie przechodzą', async () => {
  const { token } = await signToken(SECRET, 'p', 1000);
  const r = await refresh(ENV, token, 1000 + 11 * H);
  assert(r.status === 200 && r.kind === 'p' && r.exp === 1000 + 11 * H + 12 * H, 'nowe 12 h');
  assert((await refresh(ENV, token, 1000 + 12 * H)).status === 401, 'wygasły');
  assert((await refresh(ENV, 'smieci')).status === 401, 'śmieci');
  const d = await signToken(SECRET, 'd', 1000);
  assert((await refresh(ENV, d.token, 2000)).kind === 'd', 'd zostaje d');
  const up = await refresh(ENV, d.token, 2000, 'p');
  assert(up.kind === 'p' && up.exp === 2000 + 12 * H, 'strona telefonu awansuje d → p');
  assert((await refresh(ENV, p0(await signToken(SECRET, 't', 1000)), 2000, 'p')).kind === 't', 'testowy nie awansuje');
});

test('authMode i tokenFrom', () => {
  assert(authMode({}) === 'required' && authMode({ AUTH_MODE: 'cokolwiek' }) === 'required', 'domyślnie wymagany (fail closed)');
  assert(authMode({ AUTH_MODE: 'off' }) === 'off' && authMode({ AUTH_MODE: 'optional' }) === 'optional', 'tryby');
  const u = new URL('https://x/api?tok=zQuery');
  assert(tokenFrom(new Request(u, { headers: { Authorization: 'Bearer zHead' } }), u) === 'zHead', 'nagłówek ma pierwszeństwo');
  assert(tokenFrom(new Request(u), u) === 'zQuery' && tokenFrom(new Request('https://x/'), new URL('https://x/')) === '', 'query / brak');
});

// ---------- bramka w Workerze ----------

const fakeNs = () => ({ idFromName: n => n, get: () => ({ fetch: async () => new Response(JSON.stringify({ code: 'ABCDE' }), { status: 200 }) }) });
const ENV_FULL = { ...ENV, ROOMS: fakeNs(), TJ_ROOMS: fakeNs(), ML_ROOMS: fakeNs(), KI_ROOMS: fakeNs(), TJ_DUO: fakeNs() };
const call = (env, path, { method = 'GET', origin = 'https://pl3y.pl', token, body, ip } = {}) => worker.fetch(new Request('https://srv' + path, {
  method, body, headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(ip ? { 'CF-Connecting-IP': ip } : {}) } }), env);

test('Worker (required): bez tokena 401, ze złym 401, z dobrym przechodzi; health i login otwarte', async () => {
  const ip = '10.0.0.1';
  assert((await call(ENV_FULL, '/api/health', { ip })).status === 200, 'health otwarte');
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', ip })).status === 401, 'tworzenie pokoju bez tokena');
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', token: 'zly.token', ip })).status === 401, 'zły token');
  assert((await call(ENV_FULL, '/api/rz/stats', { ip })).status === 401, 'statystyki bez tokena');
  assert((await call(ENV_FULL, '/api/rooms/ABCDE/ws', { ip })).status === 401, 'WebSocket bez tokena');
  const { token } = await signToken(SECRET, 'd');
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', token, ip })).status === 200, 'z tokenem działa');
  const exp = await signToken(SECRET, 'd', Date.now() - 31 * MIN);
  const r = await call(ENV_FULL, '/api/rooms', { method: 'POST', token: exp.token, ip });
  assert(r.status === 401 && (await r.json()).code === 'auth', 'wygasły token = 401 z code:auth');
});

test('Worker: logowanie po HTTP, odświeżenie i brak ucieczki przez Origin', async () => {
  const ip = '10.0.0.2';
  const l = await call(ENV_FULL, '/api/auth/login', { method: 'POST', body: JSON.stringify({ password: ENV.PL3Y_PASSWORD, profile: 'p' }), ip });
  const lj = await l.json();
  assert(l.status === 200 && lj.kind === 'p' && lj.token && l.headers.get('Access-Control-Allow-Origin') === 'https://pl3y.pl', 'login');
  const bad = await call(ENV_FULL, '/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'zle' }), ip });
  assert(bad.status === 401, 'złe hasło');
  const rf = await call(ENV_FULL, '/api/auth/refresh', { method: 'POST', token: lj.token, ip });
  assert(rf.status === 200 && (await rf.json()).kind === 'p', 'refresh');
  assert((await call(ENV_FULL, '/api/auth/login', { method: 'POST', origin: 'https://obcy.pl', body: JSON.stringify({ password: ENV.PL3Y_PASSWORD }), ip })).status === 403, 'obcy Origin odrzucony');
  assert((await call(ENV_FULL, '/api/auth/login', { method: 'POST', origin: null, body: '{}', ip })).status === 403, 'brak Origin odrzucony');
});

test('Worker: localhost zamknięty na produkcji, otwarty tylko z tokenem testowym', async () => {
  const ip = '10.0.0.3';
  const local = 'http://localhost:8080';
  const t = (await signToken(SECRET, 't')).token;
  const d = (await signToken(SECRET, 'd')).token;
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', origin: local, token: d, ip })).status === 403, 'token zwykły z localhost = 403');
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', origin: local, ip })).status === 401, 'localhost bez tokena = 401');
  const ok = await call(ENV_FULL, '/api/rooms', { method: 'POST', origin: local, token: t, ip });
  assert(ok.status === 200 && ok.headers.get('Access-Control-Allow-Origin') === local, 'token testowy z localhost działa');
  assert((await call(ENV_FULL, '/api/rooms', { method: 'POST', origin: 'https://obcy.pl', token: t, ip })).status === 403, 'token testowy nie otwiera obcych domen');
  const lg = await call(ENV_FULL, '/api/auth/login', { method: 'POST', origin: local, body: JSON.stringify({ test: ENV.PL3Y_TEST_SECRET }), ip });
  assert(lg.status === 200 && (await lg.json()).kind === 't', 'wymiana sekretu testowego na token z localhost');
  const pre = await call(ENV_FULL, '/api/rooms', { method: 'OPTIONS', origin: local, ip });
  assert(pre.status === 204 && /Authorization/.test(pre.headers.get('Access-Control-Allow-Headers')), 'preflight z Authorization');
  const noTest = { ...ENV_FULL, PL3Y_TEST_SECRET: undefined };
  assert(!(await call(noTest, '/api/rooms', { method: 'OPTIONS', origin: local, ip })).headers.get('Access-Control-Allow-Origin'), 'bez sekretu testowego preflight localhost zamknięty');
});

test('Worker: tryby optional (bez tokena wolno, zły token nie) i off', async () => {
  const ip = '10.0.0.4';
  const opt = { ...ENV_FULL, AUTH_MODE: 'optional' };
  assert((await call(opt, '/api/rooms', { method: 'POST', ip })).status === 200, 'optional: bez tokena');
  assert((await call(opt, '/api/rooms', { method: 'POST', token: 'zly.token', ip })).status === 401, 'optional: zły token = 401, żeby klient odświeżył');
  const off = { ...ENV_FULL, AUTH_MODE: 'off' };
  assert((await call(off, '/api/rooms', { method: 'POST', ip })).status === 200, 'off');
  const noKey = { ...ENV_FULL, PL3Y_TOKEN_SECRET: undefined };
  assert((await call(noKey, '/api/rooms', { method: 'POST', ip })).status === 503, 'required bez klucza = 503, nie otwarte drzwi');
});

// ---------- limity ----------

test('Bucket: serwuje burst, potem tempo, odnawia się z czasem', () => {
  const b = new Bucket(3, 1, 0);
  assert(b.take(0) && b.take(0) && b.take(0) && !b.take(0), 'burst 3');
  assert(!b.take(500) && b.take(1000), 'po sekundzie wraca 1');
  assert(!b.take(1000), 'a nie więcej');
});

test('IpLimiter: okno przesuwne, osobno na IP i rodzaj, Retry-After', () => {
  const L = new IpLimiter({ x: { max: 2, windowMs: 1000 }, y: { max: 1, windowMs: 1000 } });
  assert(L.check('x', 'a', 0) === 0 && L.check('x', 'a', 100) === 0, 'dwa przechodzą');
  assert(L.check('x', 'a', 200) > 0, 'trzeci blokowany z Retry-After');
  assert(L.check('x', 'b', 200) === 0 && L.check('y', 'a', 200) === 0, 'inne IP i rodzaj niezależne');
  assert(L.check('x', 'a', 1001) === 0, 'po oknie wolno');
  assert(L.check('nieznany', 'a', 0) === 0, 'rodzaj bez limitu');
});

test('Worker: 429 po przekroczeniu prób logowania z jednego IP, inny IP nie cierpi', async () => {
  const body = JSON.stringify({ password: 'zle' });
  let last;
  for (let i = 0; i < 9; i++) last = await call(ENV_FULL, '/api/auth/login', { method: 'POST', body, ip: '10.9.9.9' });
  assert(last.status === 429 && Number(last.headers.get('Retry-After')) >= 1, '9. próba = 429 z Retry-After');
  assert((await call(ENV_FULL, '/api/auth/login', { method: 'POST', body, ip: '10.9.9.8' })).status === 401, 'inny IP dalej dostaje 401, nie 429');
});

test('Worker: dołączanie po kodzie (ws) limitowane do 30/min z IP, tworzenie pokoju do 10/min', async () => {
  const { token } = await signToken(SECRET, 'd');
  let r;
  for (let i = 0; i < 11; i++) r = await call(ENV_FULL, '/api/rooms', { method: 'POST', token, ip: '10.8.0.1' });
  assert(r.status === 429, 'tworzenie: 11. = 429');
  for (let i = 0; i < 31; i++) r = await call(ENV_FULL, '/api/rooms/ABCDE/ws', { token, ip: '10.8.0.2' });
  assert(r.status === 429, 'ws: 31. = 429');
  assert(limitKind('POST', '/api/rz/rounds') === 'write' && limitKind('PUT', '/api/rz/alias') === 'admin' && limitKind('GET', '/api/rz/stats') === 'read', 'klasyfikacja rz');
  assert(limitKind('POST', '/api/ml/scores') === 'write' && limitKind('GET', '/api/health') === null, 'klasyfikacja ml / health');
});

class FakeWs {
  constructor() { this.out = []; this.closed = null; }
  send(d) { this.out.push(JSON.parse(d)); }
  close(c) { this.closed = c; }
}
const fakeRoom = { send: (ws, o) => ws.send(JSON.stringify(o)) };

test('limit wiadomości WS: normalna gra nie zostaje dotknięta, zalew tak', () => {
  const ws = new FakeWs();
  let t = 0;
  for (let i = 0; i < 200; i++) { t += 250; assert(!limitMessage(fakeRoom, ws, t), 'cztery wiadomości na sekundę przechodzą'); }
  const flood = new FakeWs();
  let blocked = 0;
  for (let i = 0; i < WS_BURST + 50; i++) if (limitMessage(fakeRoom, flood, 1000)) blocked++;
  assert(blocked === 50, 'po burście odrzucone, jest ' + blocked);
  assert(flood.out.length === 1 && flood.out[0].code === 'rate', 'jeden komunikat po polsku, bez zalewania odpowiedziami');
  for (let i = 0; i < WS_MAX_STRIKES + 5; i++) limitMessage(fakeRoom, flood, 1000);
  assert(flood.closed === 4429, 'uporczywy zalew zamyka gniazdo');
});

test('limit wiadomości WS: pokój odrzuca zalew, a po chwili znów przyjmuje', async () => {
  const store = new Map(); const sockets = new Set();
  const ctx = { storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, deleteAll: async () => store.clear(), setAlarm: async () => {} },
    acceptWebSocket: w => sockets.add(w), getWebSockets: () => [...sockets], setWebSocketAutoResponse() {} };
  const room = new Room(ctx, {});
  await room.init('ABCDE');
  const ws = new FakeWs(); ws.att = null;
  ws.serializeAttachment = a => { ws.att = a; }; ws.deserializeAttachment = () => ws.att;
  room.attach(ws, await room.load());
  for (let i = 0; i < WS_BURST + 20; i++) await room.webSocketMessage(ws, JSON.stringify({ t: 'hello' }));
  assert(ws.out.some(o => o.code === 'rate'), 'zalew dostał komunikat o tempie');
});

// ---------- TTL po zakończeniu gry ----------

test('ttlFor: po zakończeniu gry krócej, nigdy dłużej niż bazowy TTL', () => {
  assert(ttlFor(true, 24 * H) === ENDED_TTL && ENDED_TTL === 30 * MIN, 'po końcu 30 min');
  assert(ttlFor(false, 24 * H) === 24 * H, 'w trakcie bez zmian');
  assert(ttlFor(true, 10 * MIN) === 10 * MIN, 'nie wydłuża krótszego TTL');
});

test('Mafia Room: alarm po zakończeniu ustawiony na 30 min, a pokój po tym czasie znika', async () => {
  const store = new Map(); let alarm = null; const sockets = new Set();
  const ctx = { storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, deleteAll: async () => store.clear(), setAlarm: async a => { alarm = a; } },
    acceptWebSocket: w => sockets.add(w), getWebSockets: () => [...sockets], setWebSocketAutoResponse() {} };
  const room = new Room(ctx, {});
  await room.init('ABCDE');
  const s = await room.load();
  const trwa = alarm;
  assert(trwa - s.touchedAt === 24 * H, 'w trakcie: alarm za dobę');
  room.state = { ...s, phase: 'end', touchedAt: Date.now() - 31 * MIN };
  await room.schedule();
  assert(alarm - room.state.touchedAt === ENDED_TTL, 'po końcu: alarm za 30 min od ostatniej aktywności');
  await room.alarm();
  assert(room.state === null && store.size === 0, 'pokój skasowany po 31 min od zakończenia');
});

test('Kurczacze KiRoom: skrócony TTL po końcu partii, normalny w trakcie', async () => {
  const store = new Map(); let alarm = null;
  const ctx = { storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, deleteAll: async () => store.clear(), setAlarm: async a => { alarm = a; } },
    acceptWebSocket() {}, getWebSockets: () => [], setWebSocketAutoResponse() {} };
  const room = new KiRoom(ctx, {});
  await room.init('ABCDE');
  const s = room.state;
  assert(room.ttl(s) === KI_TTL, 'bez gry: pełny TTL');
  s.game = { phase: 'play' }; assert(room.ttl(s) === KI_TTL, 'w trakcie: pełny TTL');
  s.game = { phase: 'end' }; assert(room.ttl(s) === ENDED_TTL, 'po końcu: 30 min');
  await room.save();
  assert(alarm === s.touchedAt + ENDED_TTL, 'alarm po końcu');
  s.touchedAt = Date.now() - 31 * MIN;
  const keep = await room.init('ABCDE');
  assert(keep, 'kod zwolniony po skróconym TTL (init nie zwraca null)');
});
