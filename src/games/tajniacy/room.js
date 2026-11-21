// Durable Object „TjRoom”: pokój Tajniaków. Prowadzący (ekran TV) jest źródłem prawdy o grze:
// wysyła cały stan (`set`), a serwer go przechowuje i rozsyła kapitanom (telefony z kluczem).
// Ten sam pokój służy kolejnym grom; przy nowej planszy prowadzący wysyła `rotate`, a serwer wydaje
// nowe kody kapitanów i rozłącza stare telefony (kapitanowie skanują nowy kod QR).
import { limitMessage } from '../../core/limits.js';

export const TJ_TTL = 7 * 24 * 60 * 60 * 1000;   // pokój bez aktywności znika po tygodniu
const MAX_MSG = 16384;
const TEAMS = ['r', 'b'];
const THEMES = ['classic', 'noir', 'retro', 'light'];

const token = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

// Sprawdza i przycina stan gry od prowadzącego. Zwraca czysty obiekt albo null.
export function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const { words, key, revealed } = g;
  if (!Array.isArray(words) || words.length !== 25 || !words.every(w => typeof w === 'string' && w.length <= 40)) return null;
  if (!Array.isArray(key) || key.length !== 25 || !key.every(k => 'rbna'.includes(k) && k.length === 1)) return null;
  if (!Array.isArray(revealed) || revealed.length !== 25) return null;
  return {
    id: Number(g.id) || 0,
    words: [...words],
    key: [...key],
    revealed: revealed.map(Boolean),
    turn: TEAMS.includes(g.turn) ? g.turn : 'r',
    winner: TEAMS.includes(g.winner) ? g.winner : null,
  };
}

export function cleanCfg(c) {
  c = c && typeof c === 'object' ? c : {};
  const nm = (t, d) => String((c.names && c.names[t]) || d).slice(0, 20);
  return { names: { r: nm('r', 'Czerwoni'), b: nm('b', 'Niebiescy') }, theme: THEMES.includes(c.theme) ? c.theme : 'noir' };
}

export class TjRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = undefined;
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    }
  }

  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get('state')) || null;
    return this.state;
  }

  async save() {
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.setAlarm(this.state.touchedAt + TJ_TTL);
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

  // Zakłada pokój. null = kod zajęty przez aktywny pokój.
  async init(code) {
    const cur = await this.load();
    if (cur && Date.now() - cur.touchedAt < TJ_TTL) return null;
    this.state = { code, hostToken: token(), cap: { r: token(12), b: token(12) }, game: null, cfg: cleanCfg(null), touchedAt: Date.now() };
    await this.save();
    return { code, hostToken: this.state.hostToken, cap: { ...this.state.cap } };
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
    if (msg.t === 'hello') return this.hello(ws, msg);
    if (msg.t === 'set') return this.set(ws, msg);
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
  }

  async webSocketClose(ws) {
    try { ws.serializeAttachment({ kind: 'closed' }); } catch {}
    if (await this.load()) this.broadcast();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  hello(ws, msg) {
    const s = this.state;
    if (typeof msg.host === 'string' && msg.host) {
      if (msg.host !== s.hostToken) return this.send(ws, { t: 'error', code: 'badhost', err: 'Nieprawidłowy klucz prowadzącego.' });
      ws.serializeAttachment({ kind: 'host' });
      this.send(ws, { t: 'welcome', as: 'host' });
      return this.broadcast();
    }
    const team = TEAMS.find(t => typeof msg.cap === 'string' && msg.cap === s.cap[t]);
    if (!team) return this.send(ws, { t: 'error', code: 'badcap', err: 'Ten kod kapitana jest nieaktualny. Zeskanuj nowy kod QR.' });
    ws.serializeAttachment({ kind: 'cap', team });
    this.send(ws, { t: 'welcome', as: 'cap', team });
    this.broadcast();
  }

  async set(ws, msg) {
    const att = ws.deserializeAttachment() || {};
    if (att.kind !== 'host') return this.send(ws, { t: 'error', code: 'nohost', err: 'Brak uprawnień prowadzącego.' });
    let game = null;
    if (msg.game != null) {
      game = cleanGame(msg.game);
      if (!game) return this.send(ws, { t: 'error', code: 'badgame', err: 'Nieprawidłowy stan gry.' });
    }
    // Nowa plansza: nowe kody kapitanów. Stare telefony są rozłączane PRZED rozesłaniem gry,
    // żeby poprzedni kapitan (albo ktoś, kto patrzy na jego telefon) nie zobaczył nowego klucza.
    const rotate = msg.rotate === true;
    const cap = rotate ? { r: token(12), b: token(12) } : this.state.cap;
    this.state = { ...this.state, game, cap, cfg: cleanCfg(msg.cfg), touchedAt: Date.now() };
    await this.save();
    if (rotate) {
      for (const s of this.ctx.getWebSockets()) {
        const a = s.deserializeAttachment() || {};
        if (a.kind !== 'cap') continue;
        try { s.serializeAttachment({ kind: 'closed' }); } catch {}
        try { s.close(4401, 'revoked'); } catch {}
      }
      this.send(ws, { t: 'caps', cap: { ...cap }, gameId: game ? game.id : null });
    }
    this.broadcast();
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    if (Date.now() - s.touchedAt >= TJ_TTL) {
      for (const ws of this.ctx.getWebSockets()) try { ws.close(4404, 'expired'); } catch {}
      await this.ctx.storage.deleteAll();
      this.state = null;
    } else await this.ctx.storage.setAlarm(s.touchedAt + TJ_TTL);
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

  // Widok dla kapitana: pełny klucz (kapitan go i tak zna), odkryte karty, tura.
  capView(team) {
    const { game, cfg } = this.state;
    return { team, names: cfg.names, theme: cfg.theme, game };
  }

  broadcast() {
    const s = this.state;
    if (!s) return;
    const sockets = this.ctx.getWebSockets();
    const caps = { r: 0, b: 0 };
    for (const ws of sockets) { const a = ws.deserializeAttachment(); if (a && a.kind === 'cap') caps[a.team]++; }
    for (const ws of sockets) {
      const a = ws.deserializeAttachment() || {};
      if (a.kind === 'host') this.send(ws, { t: 'state', caps, gameId: s.game ? s.game.id : null });
      else if (a.kind === 'cap') {
        if (s.cap[a.team] == null) { try { ws.close(4401, 'revoked'); } catch {} continue; }
        this.send(ws, { t: 'state', view: this.capView(a.team) });
      }
    }
  }
}
