// Durable Object „MlScores”: wspólny ranking teleturnieju Milion (jeden obiekt na cały PL3Y).
// solo:  [{ nick, amount, qs, lvl, ts }] — najwyższe wygrane, TOP osobno dla każdego poziomu trudności
//         (lvl: e łatwy, n normalny, x ekstremalny; stare wpisy bez lvl = n). Wpis wysyła przeglądarka, walidacja zakresu.
// multi: [{ nick, pts, ts }]         — najwyższe sumy punktów z meczów (wpisy wysyła tylko MlRoom)
// wins:  { n: { nick, c } } — liczba wygranych meczów gracza
// Od v2 do rankingu trafiają tylko gracze z potwierdzonym nickiem (nick + PIN, players.js): wpis ma też n (klucz gracza),
// a nick zawsze pochodzi z serwera, nie od przeglądarki. Przy przejściu na v2 stary ranking został wyczyszczony.

import { LADDER } from './room.js';

export const TOP = 50;
export const LEVELS = ['e', 'n', 'x'];
export const DATA_V = 2;
const MAX_WINS = 500;
const MAX_PTS = LADDER.reduce((a, b) => a + b, 0) * 1.2 * 3;   // 3 rundy, zawsze pierwszy

const nickOf = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);

export function cleanSolo(e) {
  if (!e || typeof e !== 'object') return null;
  const nick = nickOf(e.nick), n = typeof e.n === 'string' ? e.n.slice(0, 40) : '';
  const amount = Number(e.amount), qs = Number(e.qs);
  if (!nick || !n || !Number.isInteger(qs) || qs < 0 || qs > LADDER.length) return null;
  if (amount !== 0 && !LADDER.includes(amount)) return null;
  const lvl = e.lvl == null ? 'n' : e.lvl;
  if (!LEVELS.includes(lvl)) return null;
  return { nick, n, amount, qs, lvl, ts: Date.now() };
}

export class MlScores {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async data() {
    const d = await this.ctx.storage.get('data');
    return d && d.v === DATA_V ? d : { v: DATA_V, solo: [], multi: [], wins: {} };   // v1 (nicki bez PIN-u) = wyczyszczony
  }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const d = await this.data();
    if (url.pathname === '/' && req.method === 'GET') {
      const wins = Object.values(d.wins).map(w => ({ nick: w.nick, n: w.c })).sort((a, b) => b.n - a.n).slice(0, TOP);
      const strip = l => l.map(({ n, ...x }) => x);
      return json({ solo: strip(d.solo), multi: strip(d.multi), wins });
    }
    if (req.method !== 'POST') return json({ err: 'Metoda niedozwolona.' }, 405);
    let body; try { body = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
    if (url.pathname === '/solo') {
      const e = cleanSolo(body);
      if (!e) return json({ err: 'Nieprawidłowy wynik.' }, 400);
      const all = [...d.solo.map(x => x.lvl ? x : { ...x, lvl: 'n' }), e].sort((a, b) => b.amount - a.amount || b.qs - a.qs || a.ts - b.ts);
      d.solo = LEVELS.flatMap(l => all.filter(x => x.lvl === l).slice(0, TOP));
      await this.ctx.storage.put('data', d);
      return json({ ok: true, rank: d.solo.filter(x => x.lvl === e.lvl).indexOf(e) + 1 });
    }
    if (url.pathname === '/multi') {
      const list = Array.isArray(body && body.entries) ? body.entries.slice(0, 12) : [];
      const ts = Date.now();
      for (const x of list) {
        const nick = nickOf(x && x.nick), pts = Number(x && x.pts), n = x && typeof x.n === 'string' ? x.n : '';
        if (!nick || !n || !Number.isFinite(pts) || pts < 0 || pts > MAX_PTS) continue;
        if (pts > 0) d.multi.push({ nick, n, pts: Math.round(pts), ts });
        if (x.win) { const w = d.wins[n] || { nick, c: 0 }; w.nick = nick; w.c++; d.wins[n] = w; }
      }
      d.multi = d.multi.sort((a, b) => b.pts - a.pts || a.ts - b.ts).slice(0, TOP);
      const w = Object.entries(d.wins);
      if (w.length > MAX_WINS) d.wins = Object.fromEntries(w.sort((a, b) => b[1].c - a[1].c).slice(0, MAX_WINS));
      await this.ctx.storage.put('data', d);
      return json({ ok: true });
    }
    return json({ err: 'Nie znaleziono.' }, 404);
  }
}
