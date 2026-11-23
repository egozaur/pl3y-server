// Bulgot: Durable Object „BgRanks” (jeden na cały PL3Y): rankingi najlepszych wyników, osobno dla trybu szybkiego i pełnego.
// Trzy widoki tych samych wyników:
//  • ogólny: klucz „r:<tryb>”, jeden wpis na gracza (jego najlepszy wynik), posortowany malejąco;
//  • per postać i poziom Garnka: klucze „c:<tryb>:<postać>:<garnek>”, w każdym jeden wpis na gracza (najlepszy w tej kombinacji);
//  • per gracz: wszystkie jego wpisy z kluczy „c:…” (każda kombinacja postaci i Garnka osobno).
// Kolekcja „do analizy” (partie wysłane przez graczy): POST /analysis-put { entry }, GET /analysis-list, POST /analysis-del { ids }.
// POST /submit { mode, entry: { n, nick, avatar, score, rounds, win, char, garnek, at, fl?: { round, died } } } → { rank, crank, above, floor };
//  `above` = najbliższy wynik innego gracza nad tym i miejsce, jakie dałby ten wynik; `floor` = anonimowe liczniki pięter „f:<tryb>:<palnik>” { runs, wins, reach[], died[] }.
// GET /list?mode=quick|full[&char=<id>][&garnek=<0-5>][&nick=<nick>][&kind=deep] → { mode, list, char, garnek, nick, total } (kind=deep: ranking Dogrywki wg liczby pięter ponad limit trybu).
// Dyżur dnia: POST /daily-submit { date, entry: { n, nick, avatar, score, rounds, win, at, ttl } } → { rank } (jedno podejście na gracza i dzień, klucz „dy:<data>”), GET /daily-list?date=YYYY-MM-DD → { date, total, list }.
// Arena Duchów: POST /ghost-put { n, nick, avatar, ghost, at } (jeden duch na gracza i tryb, klucz „g:<tryb>:<n>”), /ghost-pick { n, mode, round, salt } → { ghost },
// /ghost-result { n, mode, ghostWon }, /ghost-get { n } → { ghosts: { quick, full } } (licznik zwycięstw i porażek ducha).
import { MODES, CHARS } from './data.js';
import { makeRng } from './rng.js';

const KEEP = 100, SHOW = 100, AN_KEEP = 1000, GHOST_KEEP = 300;
const betterDeep = (a, c) => (c.deep | 0) - (a.deep | 0) || c.score - a.score || a.at - c.at;
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
    if (url.pathname === '/daily-list' && req.method === 'GET') {
      const date = url.searchParams.get('date') || '';
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return json({ err: 'Zła data.' }, 400);
      const list = (await this.ctx.storage.get('dy:' + date)) || [];
      return json({ date, total: list.length, list: list.slice(0, SHOW).map(pub) });
    }
    if (url.pathname === '/list' && req.method === 'GET') {
      const mode = url.searchParams.get('mode');
      if (!MODES[mode]) return json({ err: 'Nieznany tryb.' }, 400);
      await this.migrate();
      if (url.searchParams.get('kind') === 'deep') { const list = (await this.ctx.storage.get('d:' + mode)) || []; return json({ mode, kind: 'deep', total: list.length, list: list.slice(0, SHOW).map(pub) }); }
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
    if (url.pathname === '/daily-submit' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const st = this.ctx.storage;
      const date = String(b.date || ''), e = b.entry || {};
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || typeof e.n !== 'string') return json({ err: 'Zły wpis.' }, 400);
      const key = 'dy:' + date, list = (await st.get(key)) || [];
      if (!list.some(x => x.n === e.n)) {
        list.push({ n: e.n, nick: String(e.nick || '').slice(0, 16), avatar: e.avatar | 0, score: e.score | 0, rounds: e.rounds | 0, win: !!e.win, at: e.at | 0, ttl: String(e.ttl || '').slice(0, 16) });
        list.sort(better);
        await st.put(key, list.slice(0, KEEP));
        // sprzątanie: trzymamy tylko ostatnie dni
        const old = [...(await st.list({ prefix: 'dy:' })).keys()].sort();
        while (old.length > 14) await st.delete(old.shift());
      }
      return json({ rank: list.findIndex(x => x.n === e.n) + 1 });
    }
    if (url.pathname === '/submit' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const e = b && b.entry;
      if (!b || !MODES[b.mode] || !e || typeof e.n !== 'string' || !Number.isFinite(e.score)) return json({ err: 'Nieprawidłowe dane.' }, 400);
      await this.migrate();
      const st = this.ctx.storage;
      const row = { n: e.n, nick: String(e.nick || '').slice(0, 16), avatar: e.avatar | 0, score: e.score | 0, rounds: e.rounds | 0, win: !!e.win, char: String(e.char || ''), garnek: e.garnek | 0, deep: e.deep | 0, at: e.at | 0 };
      if (row.deep > 0) {   // ranking Dogrywki: jeden wpis na gracza (najgłębszy, potem najlepszy wynik)
        let dl = (await st.get('d:' + b.mode)) || [];
        const od = dl.find(x => x.n === row.n);
        if (!od || betterDeep(od, row) > 0) { dl = dl.filter(x => x.n !== row.n); dl.push(row); dl.sort(betterDeep); await st.put('d:' + b.mode, dl.slice(0, KEEP)); }
      }
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
      // „Prawie”: kto jest tuż nad tym wynikiem (bez samego gracza) i które miejsce dałby ten wynik. Do ciekawostek na ekranie końca.
      const others = ((await st.get('r:' + b.mode)) || []).filter(x => x.n !== row.n && x.score > row.score);
      const nearest = others[others.length - 1];
      const above = nearest ? { nick: nearest.nick, score: nearest.score, place: others.length + 1, gap: nearest.score - row.score } : null;
      const rank = await put('r:' + b.mode);
      const crank = CHARS[row.char] ? await put(cKey(b.mode, row.char, row.garnek)) : 0;
      // Anonimowe liczniki pięter (tryb × palnik): ilu graczy dotarło na piętro i ilu na nim odpadło. Tylko normalne zakończenia (bez poddania).
      const fl = e.fl, M = MODES[b.mode], fkey = 'f:' + b.mode + ':' + row.garnek;
      let floor = (await st.get(fkey)) || { runs: 0, wins: 0, reach: [], died: [] };
      if (fl && Number.isFinite(fl.round)) {
        const last = Math.max(1, Math.min(M.rounds, fl.round | 0));
        for (let i = 0; i < M.rounds; i++) { floor.reach[i] = floor.reach[i] | 0; floor.died[i] = floor.died[i] | 0; }
        for (let i = 0; i < last; i++) floor.reach[i]++;
        if (fl.died) floor.died[last - 1]++;
        floor.runs++; if (row.win) floor.wins++;
        await st.put(fkey, floor);
      }
      return json({ rank, crank, above, floor: floor.runs ? floor : null });
    }
    if (url.pathname.startsWith('/ghost-') && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
      const st = this.ctx.storage;
      if (!b || typeof b.n !== 'string') return json({ err: 'Nieprawidłowe dane.' }, 400);
      if (url.pathname === '/ghost-put') {
        const g = b.ghost;
        if (!g || !MODES[g.mode] || !Array.isArray(g.curve) || g.curve.length < 3 || g.curve.length > 60 || !CHARS[g.char]) return json({ err: 'Nieprawidłowe dane.' }, 400);
        const curve = g.curve.map(r => Array.isArray(r) ? r.slice(0, 6).map(x => Number.isFinite(x) ? Math.max(0, Math.min(99999, Math.floor(x))) : 0) : [1, 1, 100, 0, 0, 0]);
        await st.put('g:' + g.mode + ':' + b.n, { n: b.n, nick: String(b.nick || '').slice(0, 16), avatar: b.avatar | 0, char: g.char, mode: g.mode, garnek: g.garnek | 0, floors: g.floors | 0, win: !!g.win, score: g.score | 0, curve, tiles: Array.isArray(g.tiles) ? g.tiles.slice(0, 40).map(x => String(x).slice(0, 40)) : [], at: b.at | 0, wins: 0, losses: 0 });
        const all = await st.list({ prefix: 'g:' });
        if (all.size > GHOST_KEEP) { const old = [...all.entries()].sort((a, c) => (a[1].at || 0) - (c[1].at || 0)).slice(0, all.size - GHOST_KEEP).map(x => x[0]); await st.delete(old); }
        return json({ ok: true });
      }
      if (url.pathname === '/ghost-pick') {
        if (!MODES[b.mode]) return json({ err: 'Nieznany tryb.' }, 400);
        const round = b.round | 0, all = await st.list({ prefix: 'g:' + b.mode + ':' });
        let c = [...all.values()].filter(g => g.n !== b.n);
        const near = c.filter(g => g.curve.length >= Math.min(round, 4));   // Duch z krótkiego runu nie nadaje się na późne piętra
        if (near.length) c = near;
        if (!c.length) return json({ ghost: null });
        c.sort((a, d) => a.n < d.n ? -1 : 1);
        return json({ ghost: c[makeRng(b.salt >>> 0).int(c.length)] });
      }
      if (url.pathname === '/ghost-result') {
        if (!MODES[b.mode]) return json({ err: 'Nieznany tryb.' }, 400);
        const key = 'g:' + b.mode + ':' + b.n, g = await st.get(key);
        if (g) { if (b.ghostWon) g.wins = (g.wins | 0) + 1; else g.losses = (g.losses | 0) + 1; await st.put(key, g); }
        return json({ ok: true });
      }
      if (url.pathname === '/ghost-get') {
        const out = {};
        for (const mode of Object.keys(MODES)) { const g = await st.get('g:' + mode + ':' + b.n); if (g) out[mode] = { floors: g.floors, win: g.win, char: g.char, wear: g.wear || null, wins: g.wins | 0, losses: g.losses | 0, at: g.at }; }
        return json({ ghosts: out });
      }
      return json({ err: 'Nie znaleziono.' }, 404);
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
