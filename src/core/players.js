// Gracze PL3Y: nick zarezerwowany 4-cyfrowym PIN-em + awatar. Bez kont i e-maili („zabezpieczenie z tektury”:
// chroni przed podpisaniem się cudzym nickiem w rankingu, nie przed hakerem).
//
// Durable Object „Players” (jeden na cały PL3Y). Klucz „p:<n>”, gdzie n = nick znormalizowany (małe litery,
// bez ogonków i zbędnych spacji), więc „Jonathan”, „JONATHAN” i „Jonáthan” to ten sam gracz.
// Rekord: { nick, salt, hash, v, avatar, fails, lockUntil, needPin, reqAt, created }.
//   v        – wersja PIN-u; rośnie przy resecie, a token gracza zawiera v, więc stare tokeny przestają działać.
//   needPin  – admin zresetował PIN: następne wejście ustawia nowy (jak przy zakładaniu).
// Token gracza („pt”): podpisany {n, v} (signData, cel „player”), bez daty ważności. Gry wysyłają go w treści
// zapytania (pole pt) albo w ?pt= przy WebSocket; Worker sprawdza podpis i wersję (playerFromToken).

import { signData, verifyData } from './auth.js';

export const PIN_FAILS = 5;                    // tyle błędnych PIN-ów z rzędu…
export const PIN_LOCK_MS = 15 * 60 * 1000;     // …i nick jest zablokowany na 15 min
export const RESET_GAP_MS = 60 * 60 * 1000;    // prośba o reset PIN-u najwyżej raz na godzinę na nick
export const RESET_LINK_MS = 7 * 24 * 60 * 60 * 1000;   // link resetu dla admina ważny 7 dni
export const AVATARS = 10;                     // awatary 1..10 (0 = brak)
const enc = new TextEncoder();

// Nick do wyświetlania + klucz porównania. null = nieprawidłowy (2–16 znaków: litery, cyfry, spacja, . _ -).
export function normNick(raw) {
  const nick = String(raw == null ? '' : raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (nick.length < 2 || nick.length > 16 || !/^[\p{L}\p{N} ._-]+$/u.test(nick)) return null;
  const n = nick.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
  return { nick, n };
}
export const validPin = p => typeof p === 'string' && /^\d{4}$/.test(p);
const avatarOf = a => (Number.isInteger(a) && a >= 0 && a <= AVATARS ? a : 0);

async function pinHash(salt, pin) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + pin));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
const pub = (n, r) => ({ n, nick: r.nick, avatar: r.avatar || 0 });

export const playerToken = (secret, n, v) => signData(secret, 'player', { n, v });

export class Players {
  constructor(ctx, env, now = () => Date.now()) { this.ctx = ctx; this.env = env; this.now = now; }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
    const n = b && typeof b.n === 'string' ? b.n : '';
    if (!n) return json({ err: 'Brak gracza.' }, 400);
    const key = 'p:' + n;
    const r = await this.ctx.storage.get(key);
    const now = this.now();

    switch (url.pathname) {
      case '/check':
        return json(r ? { exists: true, nick: r.nick, avatar: r.avatar || 0, needPin: !!r.needPin } : { exists: false });

      case '/get':
        return json(r ? { ...pub(n, r), v: r.v, needPin: !!r.needPin } : { err: 'Nie ma takiego gracza.' }, r ? 200 : 404);

      case '/claim': {
        // nowy nick albo nowy PIN po resecie przez admina
        if (r && !r.needPin) return json({ err: 'Ten nick jest już zajęty.', code: 'taken' }, 409);
        if (!validPin(b.pin)) return json({ err: 'PIN to 4 cyfry.', code: 'pin' }, 400);
        const salt = newSalt();
        const rec = { nick: r ? r.nick : String(b.nick || n).slice(0, 16), salt, hash: await pinHash(salt, b.pin), v: (r ? r.v : 0) + 1,
          avatar: avatarOf(b.avatar ?? (r && r.avatar)), fails: 0, lockUntil: 0, needPin: false, reqAt: 0, created: r ? r.created : now };
        await this.ctx.storage.put(key, rec);
        return json({ ok: true, ...pub(n, rec), v: rec.v });
      }

      case '/login': {
        if (!r) return json({ err: 'Nie ma takiego gracza.', code: 'nouser' }, 404);
        if (r.needPin) return json({ err: 'Admin zresetował PIN. Ustaw nowy.', code: 'needpin' }, 409);
        if (r.lockUntil > now) return json({ err: 'Za dużo błędnych PIN-ów. Spróbuj później.', code: 'locked', until: r.lockUntil }, 429);
        if (!validPin(b.pin) || (await pinHash(r.salt, b.pin)) !== r.hash) {
          r.fails = (r.fails || 0) + 1;
          if (r.fails >= PIN_FAILS) { r.lockUntil = now + PIN_LOCK_MS; r.fails = 0; }
          await this.ctx.storage.put(key, r);
          if (r.lockUntil > now) return json({ err: 'Za dużo błędnych PIN-ów. Spróbuj za 15 minut.', code: 'locked', until: r.lockUntil }, 429);
          return json({ err: 'Zły PIN.', code: 'badpin', left: PIN_FAILS - r.fails }, 401);
        }
        if (r.fails) { r.fails = 0; await this.ctx.storage.put(key, r); }
        return json({ ok: true, ...pub(n, r), v: r.v });
      }

      case '/avatar': {
        if (!r || r.v !== b.v) return json({ err: 'Zaloguj się ponownie.', code: 'player' }, 401);
        r.avatar = avatarOf(b.avatar);
        await this.ctx.storage.put(key, r);
        return json({ ok: true, ...pub(n, r) });
      }

      case '/reqreset': {
        if (!r) return json({ err: 'Nie ma takiego gracza.', code: 'nouser' }, 404);
        if (r.needPin) return json({ ok: true, send: false, needPin: true });
        if (now - (r.reqAt || 0) < RESET_GAP_MS) return json({ ok: true, send: false });
        r.reqAt = now;
        await this.ctx.storage.put(key, r);
        return json({ ok: true, send: true, nick: r.nick });
      }

      case '/reset': {
        if (!r) return json({ err: 'Nie ma takiego gracza.' }, 404);
        Object.assign(r, { needPin: true, hash: '', v: r.v + 1, fails: 0, lockUntil: 0, reqAt: 0 });
        await this.ctx.storage.put(key, r);
        return json({ ok: true, nick: r.nick });
      }
    }
    return json({ err: 'Nie znaleziono.' }, 404);
  }
}

// ---------- pomocnicze dla Workera (index.js) ----------

const stubOf = env => env.PLAYERS.get(env.PLAYERS.idFromName('players'));
export async function playersCall(env, path, body) {
  const res = await stubOf(env).fetch('https://players' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

// Token gracza → { n, nick, avatar } albo null (zły podpis, PIN zresetowany, gracz nie istnieje).
export async function playerFromToken(env, pt) {
  const d = await verifyData(env.PL3Y_TOKEN_SECRET, 'player', pt);
  if (!d || typeof d.n !== 'string' || !Number.isInteger(d.v)) return null;
  const r = await playersCall(env, '/get', { n: d.n });
  if (r.status !== 200 || r.body.v !== d.v || r.body.needPin) return null;
  return { n: d.n, nick: r.body.nick, avatar: r.body.avatar };
}

// Link dla admina (Discord): podpisany n + termin ważności.
export async function resetLink(env, base, n, now = Date.now()) {
  const exp = now + RESET_LINK_MS;
  const sig = await signData(env.PL3Y_TOKEN_SECRET, 'pinreset', { n, exp });
  return `${base}/api/pl/admin-reset?t=${encodeURIComponent(sig)}`;
}
export async function resetFromLink(env, t, now = Date.now()) {
  const d = await verifyData(env.PL3Y_TOKEN_SECRET, 'pinreset', t);
  return d && typeof d.n === 'string' && typeof d.exp === 'number' && now < d.exp ? d.n : null;
}

// Powiadomienie admina: webhook Discorda (sekret PL3Y_DISCORD_WEBHOOK). Bez sekretu nic nie wysyła.
export async function notifyAdmin(env, text, fetcher = fetch) {
  const url = env.PL3Y_DISCORD_WEBHOOK;
  if (!url) return false;
  try {
    const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) });
    return res.ok;
  } catch { return false; }
}
