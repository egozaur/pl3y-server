// Durable Object „TjSaves”: wspólna lista zapisanych gier Tajniaków (jeden obiekt na cały PL3Y).
// Wpis: { id, name, ts, game, cfg }. Ostatni zapis danego id wygrywa.

export const SAVES_MAX = 50;
export const SAVE_MAX_BYTES = 65536;

export function cleanSave(id, e) {
  if (!e || typeof e !== 'object') return null;
  const name = String(e.name || '').trim().slice(0, 40);
  if (!name || !e.game || typeof e.game !== 'object' || !Array.isArray(e.game.words) || e.game.words.length !== 25) return null;
  const out = { id, name, ts: Number(e.ts) || Date.now(), game: e.game, cfg: e.cfg && typeof e.cfg === 'object' ? e.cfg : {} };
  if (JSON.stringify(out).length > SAVE_MAX_BYTES) return null;
  return out;
}

export class TjSaves {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async list() { return (await this.ctx.storage.get('list')) || []; }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/' && req.method === 'GET') return json(await this.list());
    const m = url.pathname.match(/^\/(\d{1,16})$/);
    if (!m) return json({ err: 'Nie znaleziono.' }, 404);
    const id = Number(m[1]);
    const list = await this.list();
    if (req.method === 'DELETE') {
      await this.ctx.storage.put('list', list.filter(s => s.id !== id));
      return json({ ok: true });
    }
    if (req.method === 'PUT') {
      let body; try { body = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const e = cleanSave(id, body);
      if (!e) return json({ err: 'Nieprawidłowy zapis.' }, 400);
      const next = [e, ...list.filter(s => s.id !== id)].sort((a, b) => b.ts - a.ts).slice(0, SAVES_MAX);
      await this.ctx.storage.put('list', next);
      return json({ ok: true });
    }
    return json({ err: 'Metoda niedozwolona.' }, 405);
  }
}
