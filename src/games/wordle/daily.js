// Wordle PL: wspólne słowo dnia i ranking. Durable Object „WdDaily” (jeden na cały PL3Y).
//
// Słowo dnia zna tylko serwer: przeglądarka wysyła próbę, serwer odsyła kolory (correct/present/absent),
// a samo słowo dopiero po wygranej albo po 6. próbie. Dzięki temu wyniku nie da się podejrzeć w kodzie strony.
// Dzień liczony wg czasu w Polsce (Europe/Warsaw), nowe słowo o północy.
// Kolejność słów: tasowanie listy ANSWERS ziarnem z HMAC(sekret, numer cyklu); w jednym cyklu słowa się nie powtarzają.
// Sekret: PL3Y_WORDLE_SECRET, a gdy go nie ma, PL3Y_TOKEN_SECRET (zmiana sekretu zmienia słowa).
//
// Gracz przychodzi już sprawdzony przez Worker (index.js → playerFromToken): body.pl = { n, nick, avatar }.
// Klucze: „g:<dzień>:<n>” gra gracza { guesses, start, end, status }, „d:<dzień>” wyniki dnia [{ n, nick, avatar, tries, ms, won }],
// „s:<n>” statystyki { nick, avatar, played, wins, streak, max, last, sum }.

import { ANSWERS, ALLOWED } from './words-pl.js';

export const MAX_TRIES = 6;
export const LEN = 5;
export const LAUNCH_DAY = Date.UTC(2026, 0, 1) / 86400000;   // numer #1 (taki sam jak w kliencie)
const KEEP_GAMES = 8;                                        // gry graczy trzymamy tyle dni, wyniki dnia na zawsze
const ALLOWED_SET = new Set(ALLOWED.split(' ').concat(ANSWERS));

// Numer dnia (dni od 1970-01-01) wg kalendarza w Polsce + godzina następnej północy (ms).
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function warsaw(now) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map(x => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const day = Math.floor(wall / 86400000);
  const offset = wall - Math.floor(now / 1000) * 1000;       // +1 h zimą, +2 h latem
  return { day, nextAt: (day + 1) * 86400000 - offset };
}

export function evaluate(guess, answer) {
  const g = [...guess], a = [...answer], res = Array(g.length).fill('absent'), left = {};
  for (let i = 0; i < g.length; i++) { if (g[i] === a[i]) res[i] = 'correct'; else left[a[i]] = (left[a[i]] || 0) + 1; }
  for (let i = 0; i < g.length; i++) { if (res[i] === 'correct') continue; if (left[g[i]] > 0) { res[i] = 'present'; left[g[i]]--; } }
  return res;
}

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
async function seedFor(secret, cycle) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'pl3y'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('wordle-pl|' + cycle)));
  return (sig[0] << 24 | sig[1] << 16 | sig[2] << 8 | sig[3]) >>> 0;
}
export async function wordFor(secret, day, list = ANSWERS) {
  const N = list.length, cycle = Math.floor(day / N), a = list.slice(), r = mulberry32(await seedFor(secret, cycle));
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a[((day % N) + N) % N];
}

// Ranking dnia: wygrani przed przegranymi, mniej prób, krótszy czas.
export const byRank = (x, y) => (y.won - x.won) || (x.tries - y.tries) || (x.ms - y.ms);

export class WdDaily {
  constructor(ctx, env, now = () => Date.now()) { this.ctx = ctx; this.env = env; this.now = now; }

  secret() { return this.env.PL3Y_WORDLE_SECRET || this.env.PL3Y_TOKEN_SECRET; }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const now = this.now(), { day, nextAt } = warsaw(now);
    if (url.pathname === '/rank' && req.method === 'GET') return json(await this.rank(day));

    let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
    const pl = b && b.pl;
    if (!pl || typeof pl.n !== 'string') return json({ err: 'Zaloguj się nickiem.', code: 'player' }, 401);
    const answer = await wordFor(this.secret(), day);
    const gk = `g:${day}:${pl.n}`;
    const g = (await this.ctx.storage.get(gk)) || { guesses: [], start: 0, end: 0, status: 'playing' };
    const out = () => ({ day, no: day - LAUNCH_DAY + 1, nextAt, len: LEN, guesses: g.guesses.map(w => ({ w, r: evaluate(w, answer) })),
      status: g.status, ...(g.status !== 'playing' ? { answer, ms: g.end - g.start } : {}) });

    if (url.pathname === '/state') return json(out());

    if (url.pathname === '/guess') {
      const w = typeof b.w === 'string' ? b.w.normalize('NFC').toLocaleUpperCase('pl') : '';
      if (g.status !== 'playing') return json({ ...out(), err: 'Dzisiejsza gra jest już skończona.', code: 'done' }, 409);
      if ([...w].length !== LEN || !ALLOWED_SET.has(w)) return json({ err: 'Nie ma takiego słowa.', code: 'word' }, 400);
      if (!g.guesses.length) { g.start = now; await this.cleanup(day); }
      g.guesses.push(w);
      const won = w === answer;
      if (won || g.guesses.length >= MAX_TRIES) { g.status = won ? 'won' : 'lost'; g.end = now; }
      await this.ctx.storage.put(gk, g);
      const res = out();
      if (g.status !== 'playing') res.rank = await this.finish(day, pl, g, won);
      return json(res);
    }
    return json({ err: 'Nie znaleziono.' }, 404);
  }

  // Koniec gry: wpis do rankingu dnia i statystyk gracza. Zwraca miejsce w rankingu dnia.
  async finish(day, pl, g, won) {
    const e = { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, tries: g.guesses.length, ms: g.end - g.start, won: won ? 1 : 0 };
    const list = ((await this.ctx.storage.get('d:' + day)) || []).filter(x => x.n !== pl.n).concat(e).sort(byRank);
    const s = (await this.ctx.storage.get('s:' + pl.n)) || { played: 0, wins: 0, streak: 0, max: 0, last: -1, sum: 0 };
    s.nick = pl.nick; s.avatar = pl.avatar || 0; s.played++;
    if (won) { s.wins++; s.sum += e.tries; s.streak = (s.last === day - 1 ? s.streak : 0) + 1; s.max = Math.max(s.max, s.streak); } else s.streak = 0;
    s.last = day;
    await this.ctx.storage.put({ ['d:' + day]: list, ['s:' + pl.n]: s });
    return list.findIndex(x => x.n === pl.n) + 1;
  }

  async rank(day) {
    const today = (await this.ctx.storage.get('d:' + day)) || [];
    const stats = await this.ctx.storage.list({ prefix: 's:' });
    const all = [...stats.values()].map(s => ({ nick: s.nick, avatar: s.avatar || 0, played: s.played, wins: s.wins,
      streak: s.last >= day - 1 ? s.streak : 0, max: s.max, avg: s.wins ? Math.round(s.sum / s.wins * 100) / 100 : null }))
      .sort((a, b) => b.wins - a.wins || (a.avg ?? 9) - (b.avg ?? 9) || b.max - a.max).slice(0, 50);
    return { day, no: day - LAUNCH_DAY + 1, today: today.map(({ n, ...x }) => x), all };
  }

  // Sprzątanie starych gier graczy (wyniki dnia i statystyki zostają).
  async cleanup(day) {
    try {
      const old = await this.ctx.storage.list({ prefix: `g:${day - KEEP_GAMES}:` });
      if (old.size) await this.ctx.storage.delete([...old.keys()]);
    } catch {}
  }
}
