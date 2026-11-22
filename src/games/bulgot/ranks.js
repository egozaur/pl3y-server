// Bulgot: Durable Object „BgRanks” (jeden na cały PL3Y): rankingi najlepszych wyników, osobno dla trybu szybkiego i pełnego.
// Trzy widoki tych samych wyników:
//  • ogólny: klucz „r:<tryb>”, jeden wpis na gracza (jego najlepszy wynik), posortowany malejąco;
//  • per postać i poziom Garnka: klucze „c:<tryb>:<postać>:<garnek>”, w każdym jeden wpis na gracza (najlepszy w tej kombinacji);
//  • per gracz: wszystkie jego wpisy z kluczy „c:…” (każda kombinacja postaci i Garnka osobno).
// Kolekcja „do analizy” (partie wysłane przez graczy): POST /analysis-put { entry }, GET /analysis-list, POST /analysis-del { ids }.
// POST /submit { mode, entry: { n, nick, avatar, score, rounds, win, char, garnek, at } } → { rank, crank };
// GET /list?mode=quick|full[&char=<id>][&garnek=<0-5>][&nick=<nick>] → { mode, list, char, garnek, nick, total }.
import { MODES, CHARS } from './data.js';

const KEEP = 100, SHOW = 100, AN_KEEP = 500;
const cKey = (mode, char, g) => 'c:' + mode + ':' + char + ':' + g;
const better = (a, c) => c.score - a.score || a.at - c.at;
const pub = ({ n, ...x }) => x;

export class BgRanks {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  // Jednorazowa migracja: dotychczasowe wpisy ogólne (z postacią i Garnkiem) zasilają listy kombinacji.
  async migrate() {
    const st = this.ctx.storage;
    if (await st.get('m2')) return;
    for (const mode of Object.keys(MODES)) {
      const old = (await st.get('r:' + mode)) || [];
      for (const e of old) {
        if (!CHARS[e.char]) continue;
        const key = cKey(mode, e.char, e.garnek | 0), list = (await st.get(key)) || [];
        if (!list.some(x => x.n === e.n)) { list.push(e); list.sort(better); await st.put(key, list.slice(0, KEEP)); }
      }
    }
    await st.put('m2', 1);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/list' && req.method === 'GET') {
      const mode = url.searchParams.get('mode');
      if (!MODES[mode]) return json({ err: 'Nieznany tryb.' }, 400);
      await this.migrate();
      const char = url.searchParams.get('char') || '', nick = (url.searchParams.get('nick') || '').trim().slice(0, 16).toLowerCase();
      const gs = url.searchParams.get('garnek'), garnek = gs === null || gs === '' ? -1 : Number(gs);
      if (char && !CHARS[char]) return json({ err: 'Nieznana postać.' }, 400);
      if (garnek !== -1 && !(Number.isInteger(garnek) && garnek >= 0 && garnek <= 9)) return json({ err: 'Zły poziom Garnka.' }, 400);
      let list;
      if (!char && garnek === -1 && !nick) list = (await this.ctx.storage.get('r:' + mode)) || [];
      else {
        // Wpisy ze wszystkich pasujących kombinacji (postać × Garnek).
        const all = await this.ctx.storage.list({ prefix: 'c:' + mode + ':' });
        list = [];
        for (const [k, v] of all) {
          const [, , c, g] = k.split(':');
          if ((char && c !== char) || (garnek !== -1 && Number(g) !== garnek)) continue;
          list.push(...v);
        }
        if (nick) list = list.filter(e => String(e.nick || '').toLowerCase() === nick);
        else {   // bez wskazanego gracza: jeden (najlepszy) wpis na gracza w wybranym przekroju
          const best = new Map();
          for (const e of list) { const o = best.get(e.n); if (!o || better(o, e) > 0) best.set(e.n, e); }
          list = [...best.values()];
        }
        list.sort(better);
      }
      return json({ mode, char, garnek, nick, total: list.length, list: list.slice(0, SHOW).map(pub) });
    }
    if (url.pathname === '/submit' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const e = b && b.entry;
      if (!b || !MODES[b.mode] || !e || typeof e.n !== 'string' || !Number.isFinite(e.score)) return json({ err: 'Nieprawidłowe dane.' }, 400);
      await this.migrate();
      const st = this.ctx.storage;
      const row = { n: e.n, nick: String(e.nick || '').slice(0, 16), avatar: e.avatar | 0, score: e.score | 0, rounds: e.rounds | 0, win: !!e.win, char: String(e.char || ''), garnek: e.garnek | 0, at: e.at | 0 };
      // Wpis w liście: zostaje tylko najlepszy wynik gracza (w ogólnej – w ogóle, w kombinacji – dla tej postaci i Garnka).
      const put = async (key) => {
        let list = (await st.get(key)) || [];
        const old = list.find(x => x.n === row.n);
        if (!old || row.score > old.score) {
          list = list.filter(x => x.n !== row.n); list.push(row); list.sort(better); list = list.slice(0, KEEP);
          await st.put(key, list);
        }
        return list.findIndex(x => x.n === row.n) + 1;
      };
      const rank = await put('r:' + b.mode);
      const crank = CHARS[row.char] ? await put(cKey(b.mode, row.char, row.garnek)) : 0;
      return json({ rank, crank });
    }
    if (url.pathname === '/analysis-put' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const e = b && b.entry;
      if (!e || typeof e.id !== 'string' || !e.id || typeof e.n !== 'string' || !MODES[e.mode]) return json({ err: 'Nieprawidłowe dane.' }, 400);
      const st = this.ctx.storage, key = 'an:' + e.id.slice(0, 40);
      await st.put(key, e);
      // limit: najstarsze wysyłki wypadają po przekroczeniu AN_KEEP
      const all = await st.list({ prefix: 'an:' });
      if (all.size > AN_KEEP) { const old = [...all.entries()].sort((a, c) => (a[1].sentAt || 0) - (c[1].sentAt || 0)).slice(0, all.size - AN_KEEP).map(x => x[0]); await st.delete(old); }
      return json({ ok: true });
    }
    if (url.pathname === '/analysis-list' && req.method === 'GET') {
      const all = await this.ctx.storage.list({ prefix: 'an:' });
      return json({ list: [...all.values()].sort((a, c) => (a.sentAt || 0) - (c.sentAt || 0)) });
    }
    if (url.pathname === '/analysis-del' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const ids = Array.isArray(b && b.ids) ? b.ids.filter(x => typeof x === 'string').slice(0, 200).map(x => 'an:' + x.slice(0, 40)) : [];
      if (ids.length) await this.ctx.storage.delete(ids);
      return json({ ok: true, deleted: ids.length });
    }
    return json({ err: 'Nie znaleziono.' }, 404);
  }
}
