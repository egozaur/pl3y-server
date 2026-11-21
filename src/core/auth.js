// Bramka autoryzacji serwera PL3Y: hasło sprawdzane w Workerze, sesja jako token podpisany HMAC-SHA256.
//
// Sekrety Cloudflare (nigdy w repozytorium):
//   PL3Y_PASSWORD      – hasło do PL3Y (długie, jawny tekst w sekrecie)
//   PL3Y_TOKEN_SECRET  – losowy klucz do podpisywania tokenów (zmiana unieważnia wszystkie sesje)
//   PL3Y_TEST_SECRET   – opcjonalnie: wymiana na krótki token testowy (E2E z localhost, ?server=prod)
// Zmienna AUTH_MODE (wrangler.toml): "off" | "optional" | "required".
//
// Token: base64url(JSON {k, exp, iat}) + "." + base64url(HMAC). k: "d" desktop/lobby (30 min), "p" telefon (12 h), "t" test (1 h).

export const TTL_MS = { d: 30 * 60 * 1000, p: 12 * 60 * 60 * 1000, t: 60 * 60 * 1000 };
const enc = new TextEncoder();

const b64u = buf => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

const hmacKey = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

// Porównanie w stałym czasie (skróty SHA-256 obu napisów, więc długość nie wycieka).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

export async function signToken(secret, kind, now = Date.now()) {
  const ttl = TTL_MS[kind];
  if (!ttl || !secret) throw new Error('Brak klucza albo nieznany rodzaj tokena.');
  const payload = b64u(enc.encode(JSON.stringify({ k: kind, iat: now, exp: now + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return { token: payload + '.' + b64u(sig), exp: now + ttl, kind };
}

// Zwraca { k, exp, iat } albo null (zły podpis, wygasły, uszkodzony).
export async function verifyToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 300) return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(token.slice(i + 1)), enc.encode(token.slice(0, i)));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(token.slice(0, i))));
    if (!p || !TTL_MS[p.k] || typeof p.exp !== 'number' || now >= p.exp) return null;
    return p;
  } catch { return null; }
}

// Podpisane dane ogólnego przeznaczenia (token gracza, link resetu PIN-u). `purpose` oddziela przestrzenie,
// więc token jednego rodzaju nie przejdzie jako inny (ani jako token sesji, który ma osobny klucz).
export async function signData(secret, purpose, obj) {
  if (!secret) throw new Error('Brak klucza.');
  const payload = b64u(enc.encode(JSON.stringify(obj)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret + '|' + purpose), enc.encode(payload));
  return payload + '.' + b64u(sig);
}
export async function verifyData(secret, purpose, token) {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret + '|' + purpose), unb64u(token.slice(i + 1)), enc.encode(token.slice(0, i)));
    return ok ? JSON.parse(new TextDecoder().decode(unb64u(token.slice(0, i)))) : null;
  } catch { return null; }
}

export const authMode = env => (['off', 'optional', 'required'].includes(env.AUTH_MODE) ? env.AUTH_MODE : 'required');

// Token z nagłówka Authorization: Bearer … albo z ?tok=… (przeglądarka nie ustawi nagłówka dla WebSocket).
export function tokenFrom(req, url) {
  const h = req.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return url.searchParams.get('tok') || '';
}

// Logowanie: { password, profile: 'd'|'p' } albo { test } (sekret testowy → token "t").
export async function login(env, body, now = Date.now()) {
  if (!env.PL3Y_TOKEN_SECRET) return { status: 503, err: 'Serwer nie ma ustawionego klucza sesji.' };
  if (body && typeof body.test === 'string' && body.test) {
    if (!env.PL3Y_TEST_SECRET || !(await safeEqual(body.test, env.PL3Y_TEST_SECRET))) return { status: 401, err: 'Złe hasło.' };
    return { status: 200, ...(await signToken(env.PL3Y_TOKEN_SECRET, 't', now)) };
  }
  if (!env.PL3Y_PASSWORD) return { status: 503, err: 'Serwer nie ma ustawionego hasła.' };
  const pw = body && typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!pw || !(await safeEqual(pw, env.PL3Y_PASSWORD))) return { status: 401, err: 'Złe hasło.' };
  const kind = body.profile === 'p' ? 'p' : 'd';
  return { status: 200, ...(await signToken(env.PL3Y_TOKEN_SECRET, kind, now)) };
}

// Odświeżenie (przesuwane okno): nowy token o ile obecny jest jeszcze ważny.
// Rodzaj zostaje ten sam, z jednym wyjątkiem: strona telefonu (profile "p") może awansować token "d" na "p",
// żeby okno 30 min nie wyskoczyło w trakcie partii. Token testowy "t" zawsze zostaje testowym.
export async function refresh(env, token, now = Date.now(), profile = null) {
  const p = await verifyToken(env.PL3Y_TOKEN_SECRET, token, now);
  if (!p) return { status: 401, err: 'Sesja wygasła.' };
  const kind = p.k === 'd' && profile === 'p' ? 'p' : p.k;
  return { status: 200, ...(await signToken(env.PL3Y_TOKEN_SECRET, kind, now)) };
}
