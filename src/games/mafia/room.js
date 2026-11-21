// Durable Object „Room”: jeden pokój = jeden obiekt. Jedyne źródło prawdy o stanie gry.
// Wiadomości są przetwarzane po kolei (bramki wejścia DO), więc jednoczesne akcje nie tworzą wyścigów.
import { createState } from './engine/lobby.js';
import { apply, GameError, joinRoom, rebindRoom, tick } from './engine/machine.js';
import { viewForPlayer, viewForScreen } from './engine/view.js';
import { limitMessage, ttlFor } from '../../core/limits.js';

const ROOM_TTL = 24 * 60 * 60 * 1000;       // pokój bez aktywności znika po dobie
const MAX_MSG = 4096;
const RECENT = 300;                          // pamięć identyfikatorów akcji (deduplikacja ponowień)

export const randomToken = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const ctxNow = () => ({ now: Date.now(), rng, token: () => randomToken() });

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = undefined;
    // ping/pong bez budzenia obiektu z hibernacji
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    }
  }

  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get('state')) || null;
    return this.state;
  }

  async commit(next) {
    this.state = next;
    await this.ctx.storage.put('state', next);
    await this.schedule();
    this.broadcast();
  }

  async schedule() {
    const s = this.state;
    if (!s) return;
    let at = s.touchedAt + ttlFor(s.phase === 'end', ROOM_TTL);
    if (!s.paused && s.endsAt) at = Math.min(at, s.endsAt);
    await this.ctx.storage.setAlarm(at);
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
    if (cur && Date.now() - cur.touchedAt < ttlFor(cur.phase === 'end', ROOM_TTL)) return null;
    const hostToken = randomToken();
    this.state = createState(code, hostToken, Date.now());
    await this.ctx.storage.put('state', this.state);
    await this.schedule();
    return { code, hostToken };
  }

  // ---------- WebSocket ----------

  // Przyjmuje gniazdo (prawdziwe albo lokalną atrapę z dev/server.js).
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

    switch (msg.t) {
      case 'hello': return this.hello(ws, msg);
      case 'join': return this.join(ws, msg);
      case 'rebind': return this.rebind(ws, msg);
      case 'act': return this.act(ws, msg);
      case 'ping': return this.send(ws, { t: 'pong' });
    }
  }

  async webSocketClose(ws) {
    // aktualizacja wskaźnika „online” u pozostałych
    try { ws.serializeAttachment({ kind: 'closed' }); } catch {}
    if (await this.load()) this.broadcast();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  hello(ws, msg) {
    const s = this.state;
    if (typeof msg.host === 'string' && msg.host) {
      if (msg.host !== s.hostToken) return this.send(ws, { t: 'error', code: 'badhost', err: 'Nieprawidłowy klucz gospodarza.' });
      ws.serializeAttachment({ kind: 'host' });
      this.send(ws, { t: 'welcome', as: 'host' });
      return this.broadcast();
    }
    if (typeof msg.token === 'string' && msg.token) {
      const pid = Object.hasOwn(s.tokens, msg.token) ? s.tokens[msg.token] : null;
      if (!pid) {
        this.send(ws, { t: 'error', code: 'badtoken', err: 'Twoja sesja wygasła albo została przeniesiona na inny telefon.' });
      } else {
        ws.serializeAttachment({ kind: 'player', pid, token: msg.token });
        this.send(ws, { t: 'welcome', as: 'player', pid });
        return this.broadcast();
      }
    }
    ws.serializeAttachment({ kind: 'guest' });
    this.send(ws, { t: 'welcome', as: 'guest', joinable: s.phase === 'lobby', code: s.code });
  }

  async join(ws, msg) {
    const att = ws.deserializeAttachment() || {};
    if (att.kind === 'player') return this.send(ws, { t: 'error', err: 'Już jesteś w tej grze.' });
    const next = structuredClone(this.state);
    try {
      const { token, player } = joinRoom(next, msg.name, ctxNow());
      ws.serializeAttachment({ kind: 'player', pid: player.id, token });
      this.send(ws, { t: 'token', token, pid: player.id });
      await this.commit(next);
    } catch (e) {
      this.send(ws, { t: 'error', err: e instanceof GameError ? e.message : 'Błąd serwera.' });
      if (!(e instanceof GameError)) console.error(e);
    }
  }

  async rebind(ws, msg) {
    const next = structuredClone(this.state);
    try {
      const { token, player } = rebindRoom(next, String(msg.code || ''), ctxNow());
      ws.serializeAttachment({ kind: 'player', pid: player.id, token });
      this.send(ws, { t: 'token', token, pid: player.id });
      await this.commit(next);
    } catch (e) {
      this.send(ws, { t: 'error', code: 'badrebind', err: e instanceof GameError ? e.message : 'Błąd serwera.' });
    }
  }

  async act(ws, msg) {
    const att = ws.deserializeAttachment() || {};
    const actor = att.kind === 'host' ? { host: true } : att.kind === 'player' ? { pid: att.pid } : null;
    const aid = typeof msg.id === 'string' ? msg.id.slice(0, 40) : null;
    if (!actor) return this.send(ws, { t: 'ack', id: aid, ok: false, err: 'Brak autoryzacji.' });
    if (actor.pid && !Object.hasOwn(this.state.tokens, att.token)) {
      this.send(ws, { t: 'error', code: 'badtoken', err: 'Twoja sesja została przeniesiona na inny telefon.' });
      return ws.close(4401, 'revoked');
    }
    const key = (actor.host ? 'h:' : att.pid + ':') + aid;
    if (aid && (this.state.recent || []).includes(key)) return this.send(ws, { t: 'ack', id: aid, ok: true, dup: true });

    const next = structuredClone(this.state);
    try {
      const out = apply(next, actor, msg.action, ctxNow());
      if (aid) next.recent = [...(next.recent || []).slice(-(RECENT - 1)), key];
      this.send(ws, { t: 'ack', id: aid, ok: true, data: out || null });
      await this.commit(next);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      this.send(ws, { t: 'ack', id: aid, ok: false, err: e instanceof GameError ? e.message : 'Błąd serwera.' });
    }
  }

  // ---------- czas ----------

  async alarm() {
    const s = await this.load();
    if (!s) return;
    const now = Date.now();
    if (now - s.touchedAt >= ttlFor(s.phase === 'end', ROOM_TTL)) {
      for (const ws of this.ctx.getWebSockets()) try { ws.close(4404, 'expired'); } catch {}
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    const next = structuredClone(s);
    let changed = false;
    try {
      // kilka przejść naraz, jeśli obiekt spał dłużej (np. werdykt → noc)
      for (let i = 0; i < 5 && tick(next, { now, rng, token: () => randomToken() }); i++) changed = true;
    } catch (e) { console.error(e); }
    if (changed) await this.commit(next);
    else await this.schedule();
  }

  // ---------- rozsyłanie ----------

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  broadcast() {
    const s = this.state;
    if (!s) return;
    const sockets = this.ctx.getWebSockets();
    const online = new Set();
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (a && a.kind === 'player' && Object.hasOwn(s.tokens, a.token)) online.add(a.pid);
    }
    const now = Date.now();
    let screen = null;
    for (const ws of sockets) {
      const a = ws.deserializeAttachment() || {};
      if (a.kind === 'host') {
        screen = screen || JSON.stringify({ t: 'state', now, view: viewForScreen(s, online, now) });
        try { ws.send(screen); } catch {}
      } else if (a.kind === 'player') {
        if (!Object.hasOwn(s.tokens, a.token)) {       // usunięty albo przeniesiony na inny telefon
          this.send(ws, { t: 'error', code: 'badtoken', err: 'Twoja sesja została zamknięta przez gospodarza albo przeniesiona na inny telefon.' });
          try { ws.close(4401, 'revoked'); } catch {}
          continue;
        }
        this.send(ws, { t: 'state', now, view: viewForPlayer(s, a.pid, online) });
      } else if (a.kind === 'guest') {
        this.send(ws, { t: 'lobby', joinable: s.phase === 'lobby', count: s.players.length });
      }
    }
  }
}
