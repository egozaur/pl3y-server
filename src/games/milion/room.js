// Durable Object „MlRoom”: pokój teleturnieju Milion w trybie multi. Tu (inaczej niż w Tajniakach) serwer jest
// źródłem prawdy: trzyma pytania meczu, czas, odpowiedzi i punkty. Prowadzący (ekran TV) wysyła pulę pytań przy
// starcie i klika „Dalej”; telefony graczy dostają pytanie BEZ poprawnej odpowiedzi aż do odsłonięcia.
//
// Mecz = 3 rundy po maks. 12 pytań. Błąd albo brak odpowiedzi w czasie = gracz odpada z rundy (zostaje publicznością).
// Poprawna odpowiedź = kwota z drabinki + bonus za kolejność wśród poprawnych (1. +20%, 2. +10%, 3. +5%).
// Wygrywa suma punktów z 3 rund. Koła ratunkowe (50:50, publiczność, zamiana) każdy gracz ma raz na rundę.
import { limitMessage, ttlFor } from '../../core/limits.js';

export const ML_TTL = 24 * 60 * 60 * 1000;   // pokój bez aktywności znika po dobie
export const LADDER = [500, 1000, 2000, 5000, 10000, 20000, 40000, 75000, 125000, 250000, 500000, 1000000];
export const BONUS = [0.2, 0.1, 0.05];
export const ROUNDS = 3;
export const TIMES = [15, 30, 45, 60];
export const MAX_PLAYERS = 12;
export const GRACE = 800;                     // zapas na opóźnienie sieci po upływie czasu (ms)
const MAX_MSG = 120000;
const LIFES = ['f', 'a', 's'];                // 50:50, publiczność, zamiana pytania
export const EMOTES = 8;                      // liczba emotek do wysyłania z telefonu (indeksy 0..7, obrazki na kliencie)
export const EMO_GAP = 1000;                  // min. odstęp między emotkami jednego gracza (ms)

const token = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// ---------- pytania ----------
export function cleanQ(q) {
  if (!q || typeof q !== 'object') return null;
  const text = typeof q.q === 'string' ? q.q.trim() : '';
  if (!text || text.length > 300) return null;
  if (!Array.isArray(q.a) || q.a.length !== 4 || !q.a.every(x => typeof x === 'string' && x.trim() && x.length <= 120)) return null;
  const ok = Number(q.ok);
  if (!Number.isInteger(ok) || ok < 0 || ok > 3) return null;
  return { q: text, a: q.a.map(x => x.trim()), ok };
}

// Pula meczu: 3 rundy × 12 poziomów × { m: pytanie główne, s: zapasowe do zamiany }.
export function cleanPool(p) {
  if (!Array.isArray(p) || p.length !== ROUNDS) return null;
  const out = [];
  for (const r of p) {
    if (!Array.isArray(r) || r.length !== LADDER.length) return null;
    const row = [];
    for (const lv of r) {
      const m = cleanQ(lv && lv.m), s = cleanQ(lv && lv.s);
      if (!m || !s) return null;
      row.push({ m, s });
    }
    out.push(row);
  }
  return out;
}

const pub = q => ({ q: q.q, a: [...q.a] });   // pytanie bez poprawnej odpowiedzi

// Symulowana publiczność: procenty (suma 100), poprawna dostaje wagę zależną od poziomu, czasem tłum się myli.
export function audienceSim(ok, qi, removed = [], r = rnd) {
  const opts = [0, 1, 2, 3].filter(i => !removed.includes(i));
  const band = qi < 4 ? [60, 85] : qi < 8 ? [40, 65] : [25, 50];
  let lead = ok;
  if (r() < 0.1) { const wrong = opts.filter(i => i !== ok); lead = wrong[Math.floor(r() * wrong.length)]; }
  const pct = [0, 0, 0, 0];
  pct[lead] = Math.round(band[0] + r() * (band[1] - band[0]));
  const rest = opts.filter(i => i !== lead);
  const w = rest.map(() => 0.2 + r());
  if (lead !== ok) w[rest.indexOf(ok)] += 0.8;   // przy pomyłce poprawna i tak dostaje sporo
  const sum = w.reduce((a, b) => a + b, 0);
  let left = 100 - pct[lead];
  rest.forEach((i, k) => { const v = k === rest.length - 1 ? left : Math.round((100 - pct[lead]) * w[k] / sum); pct[i] = Math.max(0, Math.min(v, left)); left -= pct[i]; });
  return pct;
}

function newPlayer(name) {
  return { id: token(4), token: token(12), name, total: 0, rp: [0, 0, 0], out: false, outQ: null,
    life: { f: true, a: true, s: true }, ans: null, at: 0, seq: 0, swap: false, fifty: null, aud: null, gain: 0, correct: null,
    fast: null, streak: 0, best: 0, used: 0 };   // statystyki meczu: najszybsza poprawna (ms), seria, najdłuższa seria, użyte koła
}

function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16); }

export class MlRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.state = undefined;
    this.now = () => Date.now();
    this.rnd = rnd;
    this.lastEmo = new Map();                  // id gracza → czas ostatniej emotki (limit tempa, tylko w pamięci)
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    }
  }

  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get('state')) || null;
    return this.state;
  }

  async save() {
    const s = this.state;
    await this.ctx.storage.put('state', s);
    await this.ctx.storage.setAlarm(s.phase === 'q' ? s.deadline : s.touchedAt + ttlFor(s.phase === 'end', ML_TTL));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      const { code } = await req.json();
      const out = await this.init(code);
      return out ? Response.json(out) : new Response('taken', { status: 409 });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const s = await this.load();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Gracz z potwierdzonym nickiem (nick + PIN): Worker sprawdził token i dopisał nagłówek (od klienta jest usuwany).
      let pl = null;
      try { const h = req.headers.get('X-PL3Y-Player'); if (h) { const x = JSON.parse(h); if (x && typeof x.n === 'string' && typeof x.nick === 'string') pl = { n: x.n, nick: x.nick }; } } catch {}
      this.attach(server, s, pl);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  async init(code) {
    const cur = await this.load();
    if (cur && this.now() - cur.touchedAt < ttlFor(cur.phase === 'end', ML_TTL)) return null;
    this.state = { code, hostToken: token(), phase: 'lobby', time: 30, players: [], round: 0, qi: 0, deadline: 0,
      pool: null, seq: 0, saved: false, touchedAt: this.now() };
    await this.save();
    return { code, hostToken: this.state.hostToken };
  }

  attach(ws, s, pl = null) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ kind: 'guest', pl });
    if (!s) { this.send(ws, { t: 'error', code: 'noroom', err: 'Taki pokój nie istnieje albo wygasł.' }); ws.close(4404, 'noroom'); }
  }

  async webSocketMessage(ws, raw) {
    if (limitMessage(this, ws)) return;
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return this.send(ws, { t: 'error', err: 'Nieprawidłowa wiadomość.' });
    let msg;
    try { msg = JSON.parse(raw); } catch { return this.send(ws, { t: 'error', err: 'Nieprawidłowa wiadomość.' }); }
    if (!msg || typeof msg !== 'object') return;
    const s = await this.load();
    if (!s) { this.send(ws, { t: 'error', code: 'noroom', err: 'Taki pokój nie istnieje albo wygasł.' }); return ws.close(4404, 'noroom'); }
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'hello') return this.hello(ws, msg);
    const att = ws.deserializeAttachment() || {};
    if (att.kind === 'host') {
      if (msg.t === 'start') return this.start(ws, msg);
      if (msg.t === 'next') return this.next(ws, msg);
      if (msg.t === 'kick') return this.kick(msg);
      if (msg.t === 'reset') return this.reset();
      return;
    }
    if (att.kind === 'player') {
      const p = s.players.find(x => x.id === att.id);
      if (!p) return ws.close(4401, 'revoked');
      if (msg.t === 'ans') return this.answer(p, msg);
      if (msg.t === 'life') return this.life(ws, p, msg);
      if (msg.t === 'vote') return this.vote(p, msg);
      if (msg.t === 'emo') return this.emote(p, msg);
      return;
    }
    this.send(ws, { t: 'error', code: 'nohello', err: 'Najpierw się przywitaj.' });
  }

  async webSocketClose(ws) {
    try { ws.serializeAttachment({ kind: 'closed' }); } catch {}
    if (await this.load()) this.broadcast();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  async hello(ws, msg) {
    const s = this.state;
    if (typeof msg.host === 'string' && msg.host) {
      if (msg.host !== s.hostToken) return this.send(ws, { t: 'error', code: 'badhost', err: 'Nieprawidłowy klucz prowadzącego.' });
      ws.serializeAttachment({ kind: 'host' });
      this.send(ws, { t: 'welcome', as: 'host' });
      return this.broadcast();
    }
    if (typeof msg.player === 'string' && msg.player) {
      const p = s.players.find(x => x.token === msg.player);
      if (p) {
        ws.serializeAttachment({ kind: 'player', id: p.id });
        this.send(ws, { t: 'welcome', as: 'player', id: p.id, token: p.token });
        return this.broadcast();
      }
      if (msg.join == null) return this.send(ws, { t: 'error', code: 'badplayer', err: 'Nie ma Cię już w tym pokoju. Dołącz jeszcze raz.' });
    }
    const pl = (ws.deserializeAttachment() || {}).pl;
    if (msg.join != null && pl) {
      // ten sam gracz z innego urządzenia: wraca na swoje miejsce zamiast dołączać drugi raz
      const same = s.players.find(x => x.n === pl.n);
      if (same) {
        ws.serializeAttachment({ kind: 'player', id: same.id });
        this.send(ws, { t: 'welcome', as: 'player', id: same.id, token: same.token });
        return this.broadcast();
      }
    }
    if (msg.join != null) {
      if (s.phase !== 'lobby') return this.send(ws, { t: 'error', code: 'started', err: 'Mecz już trwa. Poczekaj na następny.' });
      if (s.players.length >= MAX_PLAYERS) return this.send(ws, { t: 'error', code: 'full', err: 'Pokój jest pełny.' });
      let name = pl ? cleanName(pl.nick) : cleanName(msg.join);
      if (!name) return this.send(ws, { t: 'error', code: 'noname', err: 'Wpisz swój nick.' });
      const base = name; let k = 2;
      while (s.players.some(x => x.name.toLowerCase() === name.toLowerCase())) name = (base.slice(0, 13) + ' ' + k++);
      const p = newPlayer(name);
      if (pl) p.n = pl.n;                  // tylko tacy gracze trafiają do rankingu
      s.players.push(p);
      s.touchedAt = this.now();
      await this.save();
      ws.serializeAttachment({ kind: 'player', id: p.id });
      this.send(ws, { t: 'welcome', as: 'player', id: p.id, token: p.token });
      return this.broadcast();
    }
    this.send(ws, { t: 'error', code: 'badhello', err: 'Nieprawidłowe powitanie.' });
  }

  // ---------- prowadzący ----------
  async start(ws, msg) {
    const s = this.state;
    if (s.phase !== 'lobby') return this.send(ws, { t: 'error', code: 'phase', err: 'Mecz już trwa.' });
    if (!s.players.length) return this.send(ws, { t: 'error', code: 'noplayers', err: 'Nikt jeszcze nie dołączył.' });
    const pool = cleanPool(msg.pool);
    if (!pool) return this.send(ws, { t: 'error', code: 'badpool', err: 'Nieprawidłowa pula pytań.' });
    s.pool = pool;
    s.time = TIMES.includes(Number(msg.time)) ? Number(msg.time) : 30;
    s.round = 0; s.saved = false;
    for (const p of s.players) { p.total = 0; p.rp = [0, 0, 0]; p.fast = null; p.streak = 0; p.best = 0; p.used = 0; }
    this.beginRound();
    await this.commit();
  }

  async next() {
    const s = this.state;
    if (s.phase === 'reveal') {
      const alive = s.players.filter(p => !p.out);
      if (!alive.length || s.qi === LADDER.length - 1) {
        if (s.round === ROUNDS - 1) { s.phase = 'end'; await this.saveScores(); }
        else s.phase = 'roundEnd';
      } else { s.qi++; this.beginQ(); }
    } else if (s.phase === 'roundEnd') {
      s.round++; this.beginRound();
    } else return;
    await this.commit();
  }

  async kick(msg) {
    const s = this.state;
    if (s.phase !== 'lobby') return;
    const p = s.players.find(x => x.id === msg.id);
    if (!p) return;
    s.players = s.players.filter(x => x !== p);
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment() || {};
      if (a.kind === 'player' && a.id === p.id) { try { w.serializeAttachment({ kind: 'closed' }); } catch {} try { w.close(4401, 'kicked'); } catch {} }
    }
    await this.commit();
  }

  async reset() {
    const s = this.state;
    s.phase = 'lobby'; s.pool = null; s.round = 0; s.qi = 0; s.saved = false;
    for (const p of s.players) Object.assign(p, newPlayer(p.name), { id: p.id, token: p.token });
    await this.commit();
  }

  beginRound() {
    const s = this.state;
    for (const p of s.players) { p.out = false; p.outQ = null; p.life = { f: true, a: true, s: true }; p.rp[s.round] = 0; }
    s.qi = 0;
    this.beginQ();
  }

  beginQ() {
    const s = this.state;
    s.phase = 'q';
    s.deadline = this.now() + s.time * 1000 + GRACE;
    for (const p of s.players) { p.ans = null; p.at = 0; p.seq = 0; p.swap = false; p.fifty = null; p.aud = null; p.gain = 0; p.correct = null; }
  }

  cur(p) { const s = this.state; return s.pool[s.round][s.qi][p.swap ? 's' : 'm']; }

  reveal() {
    const s = this.state;
    s.phase = 'reveal';
    const alive = s.players.filter(p => !p.out);
    const good = alive.filter(p => p.ans != null && p.ans === this.cur(p).ok).sort((a, b) => a.at - b.at || a.seq - b.seq);
    for (const p of alive) {
      const k = good.indexOf(p);
      if (k < 0) { p.correct = false; p.out = true; p.outQ = s.qi; p.gain = 0; p.streak = 0; continue; }
      p.correct = true;
      const ms = Math.max(0, p.at - (s.deadline - s.time * 1000 - GRACE));
      if (p.fast == null || ms < p.fast) p.fast = ms;
      p.streak++; if (p.streak > p.best) p.best = p.streak;
      p.gain = Math.round(LADDER[s.qi] * (1 + (BONUS[k] || 0)));
      p.total += p.gain; p.rp[s.round] += p.gain;
    }
  }

  async saveScores() {
    const s = this.state;
    if (s.saved) return;
    s.saved = true;
    const ns = this.env.ML_SCORES;
    if (!ns) return;
    const top = Math.max(...s.players.map(p => p.total));
    // ranking tylko dla potwierdzonych nicków (nick + PIN); goście grają, ale się nie zapisują
    const entries = s.players.filter(p => p.n).map(p => ({ nick: p.name, n: p.n, pts: p.total, win: top > 0 && p.total === top }));
    if (!entries.length) return;
    try {
      await ns.get(ns.idFromName('scores')).fetch('https://scores/multi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
    } catch {}
  }

  // ---------- gracze ----------
  async answer(p, msg) {
    const s = this.state;
    const i = Number(msg.i);
    if (s.phase !== 'q' || p.out || p.ans != null || !Number.isInteger(i) || i < 0 || i > 3) return;
    if (p.fifty && p.fifty.includes(i)) return;
    if (this.now() > s.deadline) return;
    p.ans = i; p.at = this.now(); p.seq = ++s.seq;
    if (s.players.every(x => x.out || x.ans != null)) this.reveal();
    await this.commit();
  }

  async life(ws, p, msg) {
    const s = this.state;
    const k = msg.k;
    if (s.phase !== 'q' || p.out || p.ans != null || !LIFES.includes(k) || !p.life[k]) return;
    p.life[k] = false; p.used++;
    if (k === 's') { p.swap = true; p.fifty = null; p.aud = null; }
    else if (k === 'f') {
      const q = this.cur(p);
      const wrong = [0, 1, 2, 3].filter(i => i !== q.ok);
      wrong.splice(Math.floor(this.rnd() * 3), 1);   // jedna zła zostaje
      p.fifty = wrong;
    } else if (k === 'a') {
      const voters = this.connectedIds();
      const crowd = s.players.filter(x => x.out && voters.has(x.id));
      p.aud = crowd.length ? { votes: {}, sim: null } : { votes: {}, sim: audienceSim(this.cur(p).ok, s.qi, p.fifty || [], this.rnd) };
    }
    await this.commit();
  }

  // Emotka z telefonu: leci tylko do ekranu TV (nie zmienia stanu gry). Dozwolona w każdej fazie, także dla odpadniętych.
  emote(p, msg) {
    const e = Number(msg.e);
    if (!Number.isInteger(e) || e < 0 || e >= EMOTES) return;
    const t = this.now();
    if (t - (this.lastEmo.get(p.id) || 0) < EMO_GAP) return;
    this.lastEmo.set(p.id, t);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.kind === 'host') this.send(ws, { t: 'emo', id: p.id, name: p.name, e });
    }
  }

  async vote(v, msg) {
    const s = this.state;
    if (s.phase !== 'q' || !v.out) return;
    const p = s.players.find(x => x.id === msg.pid);
    const i = Number(msg.i);
    if (!p || p.out || !p.aud || p.aud.sim || !Number.isInteger(i) || i < 0 || i > 3) return;
    if (p.aud.votes[v.id] != null) return;
    p.aud.votes[v.id] = i;
    await this.commit();
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    if (s.phase === 'q' && this.now() >= s.deadline) {
      this.reveal();
      return this.commit();
    }
    if (s.phase !== 'q' && this.now() - s.touchedAt >= ttlFor(s.phase === 'end', ML_TTL)) {
      for (const ws of this.ctx.getWebSockets()) try { ws.close(4404, 'expired'); } catch {}
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    await this.save();
  }

  async commit() {
    this.state.touchedAt = this.now();
    await this.save();
    this.broadcast();
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

  connectedIds() {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.kind === 'player') ids.add(a.id); }
    return ids;
  }

  audResult(p) {
    if (!p.aud) return null;
    if (p.aud.sim) return { pct: p.aud.sim, n: 0, sim: true };
    const c = [0, 0, 0, 0]; const v = Object.values(p.aud.votes);
    v.forEach(i => c[i]++);
    return { pct: c.map(x => v.length ? Math.round(100 * x / v.length) : 0), n: v.length, sim: false };
  }

  common() {
    const s = this.state;
    const left = s.phase === 'q' ? Math.max(0, s.deadline - this.now() - GRACE) : 0;
    return { phase: s.phase, round: s.round, rounds: ROUNDS, qi: s.qi, time: s.time, left, code: s.code };
  }

  // Widok dla ekranu TV: pytanie główne (poprawna dopiero przy odsłonięciu), kto już odpowiedział, punkty.
  hostView(conn) {
    const s = this.state;
    const open = s.phase === 'reveal';
    const v = this.common();
    v.players = s.players.map(p => ({ id: p.id, name: p.name, total: p.total, rp: [...p.rp], out: p.out, outQ: p.outQ,
      answered: p.ans != null, conn: conn.has(p.id), swap: p.swap, fast: p.fast, best: p.best, used: p.used,
      gain: open ? p.gain : 0, correct: open ? p.correct : null, ans: open ? p.ans : null, rank: open ? this.rank(p) : 0 }));
    if (s.pool && (s.phase === 'q' || s.phase === 'reveal')) {
      const q = s.pool[s.round][s.qi].m;
      v.q = open ? { ...pub(q), ok: q.ok } : pub(q);
      if (open) { const c = [0, 0, 0, 0]; s.players.forEach(p => { if (p.ans != null && !p.swap && (p.outQ === s.qi || !p.out)) c[p.ans]++; }); v.counts = c; }
      // Gracze po „zamianie pytania” mają wspólne pytanie zapasowe: TV pokazuje je osobno (poprawna też dopiero przy odsłonięciu).
      const sw = s.players.filter(p => p.swap && (!p.out || p.outQ === s.qi));
      if (sw.length) {
        const sq = s.pool[s.round][s.qi].s;
        v.sq = { q: open ? { ...pub(sq), ok: sq.ok } : pub(sq), names: sw.map(p => p.name) };
        if (open) { const c = [0, 0, 0, 0]; sw.forEach(p => { if (p.ans != null) c[p.ans]++; }); v.sq.counts = c; }
      }
    }
    return v;
  }

  rank(p) {
    if (!p.correct) return 0;
    const s = this.state;
    return s.players.filter(x => x.correct && (x.at < p.at || (x.at === p.at && x.seq < p.seq))).length + 1;
  }

  // Widok dla telefonu gracza: tylko własne pytanie, poprawna odpowiedź dopiero przy odsłonięciu.
  playerView(p) {
    const s = this.state;
    const open = s.phase === 'reveal';
    const v = this.common();
    v.me = { id: p.id, name: p.name, total: p.total, rp: [...p.rp], out: p.out, outQ: p.outQ, ans: p.ans, life: { ...p.life },
      swap: p.swap, fifty: p.fifty ? [...p.fifty] : [], aud: this.audResult(p),
      gain: open ? p.gain : 0, correct: open ? p.correct : null, rank: open ? this.rank(p) : 0 };
    v.board = s.players.map(x => ({ id: x.id, name: x.name, total: x.total, out: x.out, answered: x.ans != null })).sort((a, b) => b.total - a.total);
    const playing = s.phase === 'q' || s.phase === 'reveal';
    if (s.pool && playing && (!p.out || p.outQ === s.qi)) {
      const q = this.cur(p);
      v.q = open ? { ...pub(q), ok: q.ok } : pub(q);
    }
    if (s.phase === 'q' && p.out) {
      v.audReq = s.players.filter(x => !x.out && x.aud && !x.aud.sim && x.aud.votes[p.id] == null)
        .map(x => ({ pid: x.id, name: x.name, q: { ...pub(this.cur(x)), removed: x.fifty ? [...x.fifty] : [] } }));
    }
    return v;
  }

  broadcast() {
    const s = this.state;
    if (!s) return;
    const sockets = this.ctx.getWebSockets();
    const conn = this.connectedIds();
    for (const ws of sockets) {
      const a = ws.deserializeAttachment() || {};
      if (a.kind === 'host') this.send(ws, { t: 'state', view: this.hostView(conn) });
      else if (a.kind === 'player') {
        const p = s.players.find(x => x.id === a.id);
        if (!p) { try { ws.close(4401, 'revoked'); } catch {} continue; }
        this.send(ws, { t: 'state', view: this.playerView(p) });
      }
    }
  }
}
