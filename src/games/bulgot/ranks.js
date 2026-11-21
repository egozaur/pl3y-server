// Bulgot: Durable Object „BgRanks” (jeden na cały PL3Y): ranking najlepszych wyników, osobno dla trybu szybkiego i pełnego.
// Każdy gracz ma w tabeli jeden wpis (jego najlepszy wynik). Klucz „r:<tryb>” = lista posortowana malejąco.
// POST /submit { mode, entry: { n, nick, avatar, score, rounds, win, char, garnek, at } } → { rank }; GET /list?mode=quick|full.
import { MODES } from './data.js';

const KEEP = 100, SHOW = 50;

export class BgRanks {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/list' && req.method === 'GET') {
      const mode = url.searchParams.get('mode');
      if (!MODES[mode]) return json({ err: 'Nieznany tryb.' }, 400);
      const list = (await this.ctx.storage.get('r:' + mode)) || [];
      return json({ mode, list: list.slice(0, SHOW).map(({ n, ...x }) => x) });
    }
    if (url.pathname === '/submit' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const e = b && b.entry;
      if (!b || !MODES[b.mode] || !e || typeof e.n !== 'string' || !Number.isFinite(e.score)) return json({ err: 'Nieprawidłowe dane.' }, 400);
      const key = 'r:' + b.mode;
      let list = (await this.ctx.storage.get(key)) || [];
      const old = list.find(x => x.n === e.n);
      if (!old || e.score > old.score) {
        list = list.filter(x => x.n !== e.n);
        list.push({ n: e.n, nick: String(e.nick || '').slice(0, 16), avatar: e.avatar | 0, score: e.score | 0, rounds: e.rounds | 0, win: !!e.win, char: String(e.char || ''), garnek: e.garnek | 0, at: e.at | 0 });
        list.sort((a, c) => c.score - a.score || a.at - c.at);
        list = list.slice(0, KEEP);
        await this.ctx.storage.put(key, list);
      }
      return json({ rank: list.findIndex(x => x.n === e.n) + 1 });
    }
    return json({ err: 'Nie znaleziono.' }, 404);
  }
}
