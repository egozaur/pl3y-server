// Durable Object „RzWords”: wspólna baza słów gry „Rozejrzyj się” (jeden obiekt na cały PL3Y).
// Gra toczy się na jednym komputerze; po każdej rundzie przeglądarka wysyła tu listę przyjętych słów (bez zawetowanych).
//
// Klucze w storage:
//   r:<ts36>-<rand>  { letter, words: [...], ts }    surowy zapis rundy (kolejność podania), nigdy nie zmieniany
//   agg:<LITERA>     { rounds, first: {słowo:n}, all: {słowo:n} }   all = w ilu rundach słowo padło
//   rcount           liczba zapisanych rund (limit MAX_ROUNDS, nadmiar kasowany od najstarszych)
//   alias            { wariant: słowo docelowe }     scalenia, stosowane przy odczycie (więc odwracalne)
//   learned          [słowa]                          słowa przyjęte w grze (klient nie ostrzega o nich jako o spoza słownika)
//
// Trasy (ścieżki wewnętrzne, Worker mapuje /api/rz/* → tutaj):
//   GET  /stats            { letters: { L: { rounds, first:[[w,n]], all:[[w,n]] } }, alias, learned }
//   POST /rounds           { letter, words }  → { ok, id }
//   PUT  /alias            { from: [..], to }  → { ok, alias }
//   DELETE /alias/<słowo>  → { ok, alias }
//   GET  /export           { rounds: [...] }

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'Ł', 'M', 'N', 'O', 'P', 'R', 'S', 'Ś', 'T', 'U', 'W', 'Z', 'Ż'];
export const MAX_WORDS = 60;
export const MAX_LEN = 40;
const MAX_LEARNED = 20000;
// Limit surowych rund w storage: po przekroczeniu najstarsze są usuwane (liczniki agg:* zostają, więc statystyki się nie cofają).
export const MAX_ROUNDS = 5000;

// Ta sama normalizacja co w przeglądarce (rz.js): małe litery, zwinięte i obcięte spacje.
export const norm = s => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');

export function cleanRound(b) {
  if (!b || typeof b !== 'object') return null;
  const letter = String(b.letter || '').toLocaleUpperCase('pl');
  if (!LETTERS.includes(letter)) return null;
  if (!Array.isArray(b.words) || b.words.length > MAX_WORDS) return null;
  const lo = letter.toLocaleLowerCase('pl');
  const words = [];
  for (const raw of b.words) {
    if (typeof raw !== 'string') return null;
    const w = norm(raw);
    if (!w || w.length > MAX_LEN || !w.startsWith(lo) || words.includes(w)) return null;
    words.push(w);
  }
  return { letter, words };
}

// Cel ostateczny scalenia (alias nie tworzy łańcuchów, ale zabezpieczamy się przed pętlą).
const target = (alias, w) => { let x = w; for (let i = 0; i < 10 && alias[x]; i++) x = alias[x]; return x; };

function applyAlias(map, alias) {
  const out = {};
  for (const [w, n] of Object.entries(map)) { const t = target(alias, w); out[t] = (out[t] || 0) + n; }
  return out;
}

// Liczba rund, w których padło słowo, po scaleniu nie może przekroczyć liczby rund (dwa warianty w jednej rundzie).
const sorted = (m, cap) => Object.entries(m).map(([w, n]) => [w, Math.min(n, cap)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'));

export class RzWords {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.now = () => Date.now(); }

  async get(k, def) { const v = await this.ctx.storage.get(k); return v === undefined ? def : v; }

  // Pilnuje limitu MAX_ROUNDS: licznik w `rcount`, nadmiar kasujemy od najstarszych (klucze r:<ts36>-… sortują się chronologicznie).
  async trimRounds() {
    const n = (await this.get('rcount', 0)) + 1;
    if (n <= MAX_ROUNDS) { await this.ctx.storage.put('rcount', n); return; }
    const over = n - MAX_ROUNDS;
    const old = await this.ctx.storage.list({ prefix: 'r:', limit: over });
    await this.ctx.storage.delete([...old.keys()]);
    await this.ctx.storage.put('rcount', n - old.size);
  }

  async stats() {
    const alias = await this.get('alias', {});
    const learned = await this.get('learned', []);
    const letters = {};
    for (const L of LETTERS) {
      const a = await this.get('agg:' + L, null);
      if (!a || !a.rounds) continue;
      letters[L] = { rounds: a.rounds, first: sorted(applyAlias(a.first, alias), a.rounds), all: sorted(applyAlias(a.all, alias), a.rounds) };
    }
    return { letters, alias, learned };
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const body = async () => { try { return await req.json(); } catch { return undefined; } };

    if (path === '/stats' && req.method === 'GET') return json(await this.stats());

    if (path === '/export' && req.method === 'GET') {
      const list = await this.ctx.storage.list({ prefix: 'r:' });
      const rounds = [...list.values()].sort((a, b) => a.ts - b.ts);
      return json({ rounds, alias: await this.get('alias', {}) });
    }

    if (path === '/rounds' && req.method === 'POST') {
      const r = cleanRound(await body());
      if (!r) return json({ err: 'Nieprawidłowa runda.' }, 400);
      const ts = this.now();
      const id = ts.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      await this.ctx.storage.put('r:' + id, { letter: r.letter, words: r.words, ts });
      await this.trimRounds();
      const a = await this.get('agg:' + r.letter, { rounds: 0, first: {}, all: {} });
      a.rounds++;
      if (r.words.length) a.first[r.words[0]] = (a.first[r.words[0]] || 0) + 1;
      for (const w of r.words) a.all[w] = (a.all[w] || 0) + 1;
      await this.ctx.storage.put('agg:' + r.letter, a);
      if (r.words.length) {
        const learned = new Set(await this.get('learned', []));
        const before = learned.size;
        for (const w of r.words) learned.add(w);
        if (learned.size !== before && learned.size <= MAX_LEARNED) await this.ctx.storage.put('learned', [...learned]);
      }
      return json({ ok: true, id });
    }

    if (path === '/alias' && req.method === 'PUT') {
      const b = await body();
      const to = norm(b && b.to);
      const from = Array.isArray(b && b.from) ? b.from.slice(0, 50).map(norm) : [];
      if (!to || to.length > MAX_LEN || !from.length || from.some(w => !w || w.length > MAX_LEN || w[0] !== to[0])) return json({ err: 'Nieprawidłowe scalenie.' }, 400);
      const alias = await this.get('alias', {});
      const dest = target(alias, to);
      for (const w of from) {
        if (w === dest) continue;
        alias[w] = dest;
      }
      delete alias[dest];
      // Wszystko, co wskazywało na scalony wariant, wskazuje teraz bezpośrednio na cel.
      for (const k of Object.keys(alias)) alias[k] = target(alias, alias[k]);
      await this.ctx.storage.put('alias', alias);
      return json({ ok: true, alias });
    }

    const m = path.match(/^\/alias\/(.+)$/);
    if (m && req.method === 'DELETE') {
      const alias = await this.get('alias', {});
      delete alias[norm(m[1])];
      await this.ctx.storage.put('alias', alias);
      return json({ ok: true, alias });
    }

    return json({ err: 'Nie znaleziono.' }, 404);
  }
}
