// Wspólny serwer gier PL3Y: Mafia, Tajniacy, Milion, Rozejrzyj się, Kurczacze Imperium, Wordle i gracze (nick + PIN). Tworzenie pokojów, połączenia WebSocket do Durable Objects
// i wspólna lista zapisanych gier Tajniaków.
import { Room } from './games/mafia/room.js';
import { TjRoom } from './games/tajniacy/room.js';
import { TjSaves } from './games/tajniacy/saves.js';
import { MlRoom } from './games/milion/room.js';
import { MlScores } from './games/milion/scores.js';
import { RzWords } from './games/rozejrzyj/words.js';
import { KiRoom } from './games/kurczacze/room.js';
import { LEVELS as KI_LEVELS } from './games/kurczacze/bot.js';
import { TjDuo } from './games/tajniacy/duo.js';
import { Players, normNick, validPin, playersCall, playerFromToken, playerToken, resetLink, resetFromLink, notifyAdmin, AVATARS } from './core/players.js';
import { WdDaily } from './games/wordle/daily.js';
import { authMode, login, refresh, tokenFrom, verifyToken, verifyData } from './core/auth.js';
import { IpLimiter } from './core/limits.js';

export { Room, TjRoom, TjSaves, MlRoom, MlScores, RzWords, KiRoom, TjDuo, Players, WdDaily };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // bez 0/O, 1/I
const CODE_LEN = 5;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`);

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...b].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Origin z listy ALLOWED_ORIGINS. Localhost przechodzi tylko z ALLOW_LOCALHOST="true" (dev) albo
// z tokenem testowym (kind "t"), czyli E2E na prawdziwym serwerze (?server=prod) bez otwierania produkcji.
// `local` = wolno localhost (np. preflight CORS, który nie niesie tokena).
function allowedOrigin(req, env, kind, local = false) {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (LOCAL_RE.test(origin) && (env.ALLOW_LOCALHOST === 'true' || kind === 't' || local)) return origin;
  return null;
}

function cors(origin, res) {
  if (!origin) return res;
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

// Zakłada pokój pod wolnym kodem w danej przestrzeni Durable Objects (opts trafia do init pokoju, np. {bot}).
async function createRoom(ns, origin, opts = {}) {
  if (!origin) return new Response('Forbidden', { status: 403 });
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const stub = ns.get(ns.idFromName(code));
    const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ ...opts, code }) });
    if (res.status === 409) continue;
    return cors(origin, new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
  }
  return cors(origin, new Response('Brak wolnych kodów', { status: 503 }));
}

function roomSocket(ns, req, origin, rawCode) {
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  if (!origin) return new Response('Forbidden', { status: 403 });
  const code = rawCode.toUpperCase();
  if (!CODE_RE.test(code)) return new Response('Bad code', { status: 400 });
  return ns.get(ns.idFromName(code)).fetch(req);
}

// Rodzaj limitu tempa dla żądania (patrz HTTP_LIMITS w limits.js).
export function limitKind(method, path) {
  if (path === '/api/auth/login') return 'login';
  if (path === '/api/auth/refresh') return 'read';
  if (method === 'POST' && /^\/api\/(rooms|tj\/rooms|tj\/duo\/rooms|ml\/rooms|ki\/rooms)$/.test(path)) return 'create';
  if (/\/ws$/.test(path)) return 'ws';
  if (path.startsWith('/api/rz/')) return method === 'GET' ? 'read' : method === 'POST' ? 'write' : 'admin';
  if (path === '/api/ml/scores') return method === 'GET' ? 'read' : 'write';
  if (path === '/api/pl/login' || path === '/api/pl/claim') return 'pin';
  if (path === '/api/pl/reset-request' || path === '/api/pl/avatar') return 'write';
  if (path === '/api/pl/admin-reset') return 'admin';
  if (path.startsWith('/api/pl/')) return 'read';
  if (path === '/api/wd/guess') return 'guess';
  if (path.startsWith('/api/wd/')) return 'read';
  if (path.startsWith('/api/tj/saves')) return method === 'GET' ? 'read' : 'write';
  return null;
}

const limiter = new IpLimiter();
const deny = (origin, status, err, code, extra) =>
  cors(origin, new Response(JSON.stringify({ err, code }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) } }));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Preflight CORS nie niesie tokena: odpowiadamy samymi nagłówkami (dane zostają za tokenem w żądaniu właściwym).
    if (req.method === 'OPTIONS') return cors(allowedOrigin(req, env, null, !!env.PL3Y_TEST_SECRET), new Response(null, { status: 204 }));

    // ---------- Autoryzacja (hasło sprawdza Worker, sesja = token HMAC) ----------
    const mode = authMode(env);
    const tok = tokenFrom(req, url);
    const claims = tok ? await verifyToken(env.PL3Y_TOKEN_SECRET, tok) : null;
    const origin = allowedOrigin(req, env, claims && claims.k, url.pathname.startsWith('/api/auth/') && !!env.PL3Y_TEST_SECRET);

    if (url.pathname === '/api/health') return cors(origin, Response.json({ ok: true }));

    const kind = limitKind(req.method, url.pathname);
    if (kind) {
      const wait = limiter.check(kind, req.headers.get('CF-Connecting-IP') || 'brak');
      if (wait) return deny(origin, 429, 'Za dużo prób. Spróbuj za chwilę.', 'rate', { 'Retry-After': String(wait) });
    }

    // Link resetu PIN-u z Discorda: admin otwiera go w dowolnej przeglądarce, bez sesji PL3Y. Chroni go podpis HMAC.
    // GET pokazuje tylko przycisk (podgląd linku w Discordzie nie może sam zresetować PIN-u), dopiero POST resetuje.
    if (url.pathname === '/api/pl/admin-reset' && (req.method === 'GET' || req.method === 'POST')) return adminReset(req, env, url);

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      let body; try { body = JSON.parse((await req.text()).slice(0, 1000)); } catch { body = null; }
      const r = await login(env, body);
      return cors(origin, new Response(JSON.stringify(r.err ? { err: r.err, code: 'auth' } : { token: r.token, exp: r.exp, kind: r.kind, mode }), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
    }
    if (url.pathname === '/api/auth/refresh' && req.method === 'POST') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      let rb; try { rb = JSON.parse((await req.text()).slice(0, 200)); } catch { rb = null; }
      const r = await refresh(env, tok, Date.now(), rb && rb.profile === 'p' ? 'p' : null);
      return cors(origin, new Response(JSON.stringify(r.err ? { err: r.err, code: 'auth' } : { token: r.token, exp: r.exp, kind: r.kind, mode }), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
    }

    // Wszystko poza health i logowaniem wymaga ważnego tokena (tryb "required"); w "optional" token jest sprawdzany tylko, gdy jest.
    if (mode !== 'off' && url.pathname.startsWith('/api/')) {
      if (mode === 'required' && !env.PL3Y_TOKEN_SECRET) return deny(origin, 503, 'Serwer nie ma ustawionego klucza sesji.', 'config');
      if (mode === 'required' ? !claims : (tok && !claims)) return deny(origin, 401, 'Sesja wygasła. Zaloguj się ponownie.', 'auth');
    }

    // ---------- Mafia ----------
    if (url.pathname === '/api/rooms' && req.method === 'POST') return createRoom(env.ROOMS, origin);
    let m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) return roomSocket(env.ROOMS, req, origin, m[1]);

    // ---------- Tajniacy ----------
    if (url.pathname === '/api/tj/rooms' && req.method === 'POST') return createRoom(env.TJ_ROOMS, origin);
    m = url.pathname.match(/^\/api\/tj\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) return roomSocket(env.TJ_ROOMS, req, origin, m[1]);
    // Tryb dla 2 osób (Duet): osobny pokój, serwer pilnuje zasad i kluczy.
    if (url.pathname === '/api/tj/duo/rooms' && req.method === 'POST') return createRoom(env.TJ_DUO, origin);
    m = url.pathname.match(/^\/api\/tj\/duo\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) return roomSocket(env.TJ_DUO, req, origin, m[1]);
    m = url.pathname.match(/^\/api\/tj\/saves(\/\d{1,16})?$/);
    if (m) {
      if (!origin) return new Response('Forbidden', { status: 403 });
      const stub = env.TJ_SAVES.get(env.TJ_SAVES.idFromName('saves'));
      const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
      if (req.method === 'PUT') init.body = await req.text();
      return cors(origin, await stub.fetch('https://saves' + (m[1] || '/'), init));
    }

    // ---------- Milion ----------
    if (url.pathname === '/api/ml/rooms' && req.method === 'POST') return createRoom(env.ML_ROOMS, origin);
    m = url.pathname.match(/^\/api\/ml\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) {
      const h = new Headers(req.headers); h.delete('X-PL3Y-Player');   // nagłówek ustawia tylko Worker
      const pl = url.searchParams.get('pt') ? await playerFromToken(env, url.searchParams.get('pt')) : null;
      if (pl) h.set('X-PL3Y-Player', JSON.stringify({ n: pl.n, nick: pl.nick }));
      return roomSocket(env.ML_ROOMS, new Request(req, { headers: h }), origin, m[1]);
    }
    // Z zewnątrz tylko odczyt rankingu i wynik solo; wyniki meczów multi zapisuje sam pokój (MlRoom).
    if (url.pathname === '/api/ml/scores' && (req.method === 'GET' || req.method === 'POST')) {
      if (!origin) return new Response('Forbidden', { status: 403 });
      const stub = env.ML_SCORES.get(env.ML_SCORES.idFromName('scores'));
      const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
      if (req.method === 'POST') {
        // wynik solo tylko z potwierdzonym nickiem: nick bierzemy z serwera, nie od przeglądarki
        const b = await readJson(req, 2000);
        const pl = b && await playerFromToken(env, b.pt);
        if (!pl) return deny(origin, 401, 'Zaloguj się swoim nickiem, żeby zapisać wynik.', 'player');
        init.body = JSON.stringify({ amount: b.amount, qs: b.qs, lvl: b.lvl, nick: pl.nick, n: pl.n });
      }
      return cors(origin, await stub.fetch('https://scores' + (req.method === 'POST' ? '/solo' : '/'), init));
    }

    // ---------- Gracze: nick + PIN + awatar (wspólne dla wszystkich gier) ----------
    m = url.pathname.match(/^\/api\/pl\/(check|claim|login|me|avatar|reset-request)$/);
    if (m && req.method === 'POST') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      return cors(origin, await playersRoute(m[1], await readJson(req, 1000), env, url));
    }

    // ---------- Wordle PL: słowo dnia na serwerze + ranking ----------
    if (url.pathname === '/api/wd/rank' && req.method === 'GET') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      return cors(origin, await env.WD_DAILY.get(env.WD_DAILY.idFromName('wordle')).fetch('https://wd/rank'));
    }
    m = url.pathname.match(/^\/api\/wd\/(state|guess)$/);
    if (m && req.method === 'POST') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      const b = await readJson(req, 1000);
      const pl = b && await playerFromToken(env, b.pt);
      if (!pl) return deny(origin, 401, 'Zaloguj się swoim nickiem.', 'player');
      const stub = env.WD_DAILY.get(env.WD_DAILY.idFromName('wordle'));
      return cors(origin, await stub.fetch('https://wd/' + m[1], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pl, w: b.w }) }));
    }

    // ---------- Kurczacze Imperium (2 graczy, serwer pilnuje zasad) ----------
    if (url.pathname === '/api/ki/rooms' && req.method === 'POST') {
      // Opcjonalnie {bot: 'easy'|'medium'|'hard'}: gra z Kogutem Zenkiem (poziom sprawdza też KiRoom.init).
      let b = null;
      try { b = JSON.parse((await req.text()).slice(0, 200) || 'null'); } catch {}
      const bot = b && KI_LEVELS.includes(b.bot) ? b.bot : undefined;
      return createRoom(env.KI_ROOMS, origin, bot ? { bot } : {});
    }
    m = url.pathname.match(/^\/api\/ki\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) return roomSocket(env.KI_ROOMS, req, origin, m[1]);

    // ---------- Rozejrzyj się (gra na jednym komputerze; tylko wspólna baza słów) ----------
    m = url.pathname.match(/^\/api\/rz\/(stats|export|rounds|alias(?:\/[^/]{1,200})?)$/);
    if (m) {
      if (!origin) return new Response('Forbidden', { status: 403 });
      const ok = { stats: ['GET'], export: ['GET'], rounds: ['POST'], alias: ['PUT'] }[m[1]] || (m[1].startsWith('alias/') ? ['DELETE'] : []);
      if (!ok.includes(req.method)) return cors(origin, new Response('Method not allowed', { status: 405 }));
      const stub = env.RZ_WORDS.get(env.RZ_WORDS.idFromName('words'));
      const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
      if (req.method === 'POST' || req.method === 'PUT') init.body = (await req.text()).slice(0, 8000);
      return cors(origin, await stub.fetch('https://words/' + m[1], init));
    }

    return new Response('Not found', { status: 404 });
  },
};

async function readJson(req, max) {
  try { return JSON.parse((await req.text()).slice(0, max)); } catch { return null; }
}
const jres = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// /api/pl/*: sprawdzenie nicka, założenie (nick + PIN + awatar), logowanie PIN-em, „kim jestem”, zmiana awatara, prośba o reset.
async function playersRoute(what, b, env, url) {
  if (!b) return jres({ err: 'Nieprawidłowe dane.' }, 400);
  if (what === 'me' || what === 'avatar') {
    const pl = await playerFromToken(env, b.pt);
    if (!pl) return jres({ err: 'Zaloguj się ponownie.', code: 'player' }, 401);
    if (what === 'me') return jres(pl);
    const d = await verifyData(env.PL3Y_TOKEN_SECRET, 'player', b.pt);
    const r = await playersCall(env, '/avatar', { n: pl.n, v: d.v, avatar: Number(b.avatar) });
    return jres(r.body, r.status);
  }
  const nn = normNick(b.nick);
  if (!nn) return jres({ err: 'Nick: 2–16 znaków (litery, cyfry, spacja, . _ -).', code: 'nick' }, 400);
  if (what === 'check') { const r = await playersCall(env, '/check', { n: nn.n }); return jres({ ...r.body, n: nn.n }, r.status); }
  if (what === 'claim' || what === 'login') {
    if (!validPin(b.pin)) return jres({ err: 'PIN to 4 cyfry.', code: 'pin' }, 400);
    const av = Number(b.avatar);
    const r = await playersCall(env, '/' + what, { n: nn.n, nick: nn.nick, pin: b.pin, avatar: Number.isInteger(av) && av >= 0 && av <= AVATARS ? av : 0 });
    if (r.status !== 200) return jres(r.body, r.status);
    return jres({ n: nn.n, nick: r.body.nick, avatar: r.body.avatar, pt: await playerToken(env.PL3Y_TOKEN_SECRET, nn.n, r.body.v) });
  }
  if (what === 'reset-request') {
    const r = await playersCall(env, '/reqreset', { n: nn.n });
    if (r.status !== 200) return jres(r.body, r.status);
    if (r.body.send) {
      const link = await resetLink(env, url.origin, nn.n);
      await notifyAdmin(env, `🔑 PL3Y: gracz **${r.body.nick.replace(/[*_~`|>]/g, '')}** prosi o nowy PIN.\nReset: ${link}\n(po resecie gracz ustawi nowy PIN przy następnym wejściu)`);
    }
    return jres({ ok: true });
  }
  return jres({ err: 'Nie znaleziono.' }, 404);
}

// Strona resetu PIN-u dla admina (link z Discorda).
async function adminReset(req, env, url) {
  const page = (title, body) => new Response(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>PL3Y · reset PIN-u</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0C0B09;color:#EFE8D8;font:16px/1.5 system-ui,sans-serif;padding:24px}main{max-width:380px;text-align:center}h1{color:#C9A85C;font-size:22px}button{margin-top:12px;padding:14px 28px;border:0;border-radius:999px;background:#C9A85C;color:#0C0B09;font:700 16px system-ui;cursor:pointer}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } });
  const t = url.searchParams.get('t') || '';
  const n = await resetFromLink(env, t);
  if (!n) return page('Link nieważny', '<p>Link wygasł albo jest uszkodzony. Poproś gracza o nową prośbę.</p>');
  const info = await playersCall(env, '/check', { n });
  if (!info.body.exists) return page('Nie ma takiego gracza', '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (req.method === 'GET') {
    if (info.body.needPin) return page('Już zresetowany', `<p>Gracz <b>${esc(info.body.nick)}</b> ustawi nowy PIN przy następnym wejściu.</p>`);
    return page('Reset PIN-u', `<p>Zresetować PIN gracza <b>${esc(info.body.nick)}</b>? Przy następnym wejściu ustawi nowy, a stare zalogowania przestaną działać.</p><form method="post"><button>Resetuj PIN</button></form>`);
  }
  const r = await playersCall(env, '/reset', { n });
  return page('Gotowe ✓', `<p>PIN gracza <b>${esc(r.body.nick || info.body.nick)}</b> zresetowany. Przy następnym wejściu ustawi nowy.</p>`);
}
