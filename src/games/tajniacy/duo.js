// Durable Object „TjDuo”: pokój Tajniaków dla 2 osób w osobnych przeglądarkach (tryb Duet). Serwer jest źródłem
// prawdy: trzyma pełny stan (duo-engine.js), sprawdza ruchy i każdemu wysyła tylko jego klucz.
//
// Protokół (JSON przez WebSocket):
//   → {t:'hello', join:nick} (wolne miejsce) | {t:'hello', player:token} (powrót)   ← {t:'welcome', seat, token}
//   → {t:'cfg', turns} (gospodarz, w lobby) · {t:'start', words:[25]} (gospodarz; po końcu gry każdy) · {t:'move', act, id?}
//   ← {t:'state', view} po każdej zmianie · {t:'error', code, err}
// Ruchy: {a:'clue', word, n} · {a:'guess', i} · {a:'end'} · {a:'surrender'}
import * as E from './duo-engine.js';
import { limitMessage, ttlFor } from '../../core/limits.js';

export const DUO_TTL = 3 * 24 * 60 * 60 * 1000;
const MAX_MSG = 4000;

const token = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);

export class TjDuo {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.state = undefined;
    this.now = () => Date.now();
    this.seed = seed;
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    }
  }

  // Po zakończeniu partii pokój żyje krócej.
  ttl(s) { return ttlFor(!!(s.game && s.game.phase === 'end'), DUO_TTL); }

  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get('state')) || null;
    return this.state;
  }

  async save() {
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.setAlarm(this.state.touchedAt + this.ttl(this.state));
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
      this.attach(server, s);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  async init(code) {
    const cur = await this.load();
    if (cur && this.now() - cur.touchedAt < this.ttl(cur)) return null;
    this.state = { code, seats: [null, null], turns: 9, game: null, games: 0, touchedAt: this.now() };
    await this.save();
    return { code };
  }

  attach(ws, s) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ kind: 'guest' });
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
    if (att.kind !== 'player' || !s.seats[att.seat]) return this.send(ws, { t: 'error', code: 'nohello', err: 'Najpierw się przywitaj.' });
    const seat = att.seat;
    if (msg.t === 'cfg') return this.cfg(ws, seat, msg);
    if (msg.t === 'start') return this.start(ws, seat, msg);
    if (msg.t === 'move') return this.move(ws, seat, msg);
  }

  async webSocketClose(ws) {
    try { ws.serializeAttachment({ kind: 'closed' }); } catch {}
    if (await this.load()) this.broadcast();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  async hello(ws, msg) {
    const s = this.state;
    if (typeof msg.player === 'string' && msg.player) {
      const seat = s.seats.findIndex(x => x && x.token === msg.player);
      if (seat >= 0) {
        ws.serializeAttachment({ kind: 'player', seat });
        this.send(ws, { t: 'welcome', seat, token: s.seats[seat].token });
        return this.broadcast();
      }
      if (msg.join == null) return this.send(ws, { t: 'error', code: 'badplayer', err: 'Nie ma Cię w tym pokoju.' });
    }
    if (msg.join != null) {
      const seat = s.seats.findIndex(x => !x);
      if (seat < 0) return this.send(ws, { t: 'error', code: 'full', err: 'Pokój jest pełny: grają już dwie osoby.' });
      let name = cleanName(msg.join);
      if (!name) return this.send(ws, { t: 'error', code: 'noname', err: 'Wpisz swój nick.' });
      const other = s.seats[1 - seat];
      if (other && other.name.toLowerCase() === name.toLowerCase()) name = name.slice(0, 14) + ' 2';
      s.seats[seat] = { name, token: token(12) };
      ws.serializeAttachment({ kind: 'player', seat });
      this.send(ws, { t: 'welcome', seat, token: s.seats[seat].token });
      return this.commit();
    }
    this.send(ws, { t: 'error', code: 'badhello', err: 'Nieprawidłowe powitanie.' });
  }

  async cfg(ws, seat, msg) {
    const s = this.state;
    if (seat !== 0) return this.send(ws, { t: 'error', code: 'nothost', err: 'Ustawienia zmienia gospodarz pokoju.' });
    if (s.game && s.game.phase !== 'end') return this.send(ws, { t: 'error', code: 'phase', err: 'Gra już trwa.' });
    const turns = Number(msg.turns);
    if (!E.TURNS.includes(turns)) return this.send(ws, { t: 'error', code: 'badcfg', err: 'Nieprawidłowy limit tur.' });
    s.turns = turns;
    await this.commit();
  }

  // Start: pierwszą grę zaczyna gospodarz, kolejną (po końcu poprzedniej) każdy z graczy. Słowa losuje klient.
  async start(ws, seat, msg) {
    const s = this.state;
    if (s.game && s.game.phase !== 'end') return this.send(ws, { t: 'error', code: 'phase', err: 'Gra już trwa.' });
    if (!s.game && seat !== 0) return this.send(ws, { t: 'error', code: 'nothost', err: 'Grę zaczyna gospodarz pokoju.' });
    if (!s.seats[0] || !s.seats[1]) return this.send(ws, { t: 'error', code: 'alone', err: 'Poczekaj na drugiego gracza.' });
    const words = E.cleanWords(msg.words);
    if (!words) return this.send(ws, { t: 'error', code: 'badwords', err: 'Potrzeba 25 różnych słów.' });
    s.game = E.setup(this.seed(), words, s.turns, s.seats.map(x => x.name));
    s.games++;
    s.lastMove = null;
    await this.commit();
  }

  async move(ws, seat, msg) {
    const s = this.state;
    if (!s.game) return this.send(ws, { t: 'error', code: 'phase', err: 'Gra jeszcze się nie zaczęła.' });
    if (msg.id != null && s.lastMove && s.lastMove.seat === seat && s.lastMove.id === msg.id) return this.broadcast();
    const g = structuredClone(s.game);
    const res = E.apply(g, seat, msg.act);
    if (res.err) return this.send(ws, { t: 'error', code: 'move', err: res.err });
    s.game = g;
    s.lastMove = msg.id != null ? { seat, id: String(msg.id).slice(0, 40) } : null;
    await this.commit();
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    if (this.now() - s.touchedAt >= this.ttl(s)) {
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

  connected() {
    const on = [false, false];
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.kind === 'player') on[a.seat] = true; }
    return on;
  }

  viewFor(seat, on) {
    const s = this.state;
    return {
      code: s.code, seat, turns: s.turns, games: s.games,
      seats: s.seats.map((x, i) => (x ? { name: x.name, on: on[i] } : null)),
      game: s.game ? E.view(s.game, seat) : null,
    };
  }

  broadcast() {
    const s = this.state;
    if (!s) return;
    const on = this.connected();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.kind === 'player' && s.seats[a.seat]) this.send(ws, { t: 'state', view: this.viewFor(a.seat, on) });
    }
  }
}
