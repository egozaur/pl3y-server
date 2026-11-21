// Durable Object „KiRoom”: pokój Kurczaczego Imperium dla 2 graczy w osobnych przeglądarkach. Serwer jest źródłem
// prawdy: trzyma pełny stan gry (engine.js), sprawdza każdy ruch i każdemu graczowi wysyła tylko jego widok
// (bez zakrytych kart i talii w pudełku). Limit czasu tury pilnuje alarm DO (po czasie: ruch domyślny).
// Tryb z botem: pokój założony z {bot: poziom} ma na miejscu 1 bota „Kogut Zenek” (seats[1] = {name, bot}).
// Gra startuje, gdy człowiek zajmie miejsce 0; ruch bota wykonuje ten sam alarm po BOT_DELAY (żeby animacje
// u gracza były czytelne). Bot dostaje tylko E.view(g, 1), czyli nie widzi zakrytych kart (bot.js).
//
// Protokół (JSON przez WebSocket):
//   → {t:'hello', join:nick} (wolne miejsce) | {t:'hello', player:token} (powrót)   ← {t:'welcome', seat, token}
//   → {t:'cfg', time} (gospodarz, w lobby) · {t:'start'} (gospodarz, 2 graczy) · {t:'move', act, id?} · {t:'rematch'}
//   ← {t:'state', view} po każdej zmianie · {t:'error', code, err}
// Zapis partii (s.record = {seed, names, moves: [[miejsce, ruch], …]}) trafia do widoku dopiero po końcu gry
// (seed zdradza zakryte karty): gracz może go skopiować, a E.setup(seed, names) + E.apply odtwarza całą partię.
import * as E from './engine.js';
import { botMove, LEVELS, BOT_NAME } from './bot.js';
import { limitMessage, ttlFor } from '../../core/limits.js';

export const KI_TTL = 3 * 24 * 60 * 60 * 1000;   // pokój bez aktywności znika po 3 dniach
export const GRACE = 1000;                        // zapas na opóźnienie sieci po upływie czasu tury (ms)
export const BOT_DELAY = [2500, 3500];            // bot rusza się po 2,5–3,5 s (animacje ruchu człowieka zdążą się odegrać)
const MAX_MSG = 4000;

const token = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
// Ruch do zapisu: tylko pola, które rozumie silnik.
const cleanAct = a => Object.fromEntries(['a', 'slot', 'wonder', 'token', 'card'].filter(k => a && a[k] != null).map(k => [k, a[k]]));

export class KiRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.state = undefined;
    this.now = () => Date.now();
    this.seed = seed;
    this.rand = Math.random;                      // losowość bota i jego opóźnienia (testy podmieniają)
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    }
  }

  // Po zakończeniu partii pokój żyje krócej (rewanż nadal możliwy w tym czasie).
  ttl(s) { return ttlFor(!!(s.game && s.game.phase === 'end'), KI_TTL); }

  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get('state')) || null;
    return this.state;
  }

  async save() {
    const s = this.state;
    await this.ctx.storage.put('state', s);
    await this.ctx.storage.setAlarm(s.deadline ? Math.min(s.deadline, s.touchedAt + this.ttl(s)) : s.touchedAt + this.ttl(s));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      const { code, bot } = await req.json();
      const out = await this.init(code, { bot });
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

  // opts.bot = poziom bota (easy/medium/hard): miejsce 1 od razu zajmuje Kogut Zenek.
  async init(code, opts = {}) {
    const cur = await this.load();
    if (cur && this.now() - cur.touchedAt < this.ttl(cur)) return null;
    const bot = LEVELS.includes(opts.bot) ? opts.bot : null;
    this.state = { code, seats: [null, bot ? { name: BOT_NAME, bot } : null], time: 0, game: null, deadline: 0, games: 0, touchedAt: this.now() };
    await this.save();
    return bot ? { code, bot } : { code };
  }

  isBot(seat) { const x = this.state.seats[seat]; return !!(x && x.bot); }

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
    if (msg.t === 'start') return this.start(ws, seat);
    if (msg.t === 'move') return this.move(ws, seat, msg);
    if (msg.t === 'rematch') return this.rematch(ws, seat);
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
      if (this.isBot(1 - seat) && !s.game) this.newGame();   // gra z botem: bez poczekalni
      return this.commit();
    }
    this.send(ws, { t: 'error', code: 'badhello', err: 'Nieprawidłowe powitanie.' });
  }

  // Gospodarz (miejsce 0) ustawia limit czasu tury w lobby albo po zakończonej grze.
  async cfg(ws, seat, msg) {
    const s = this.state;
    if (seat !== 0) return this.send(ws, { t: 'error', code: 'nothost', err: 'Ustawienia zmienia gospodarz pokoju.' });
    if (s.game && s.game.phase !== 'end') return this.send(ws, { t: 'error', code: 'phase', err: 'Gra już trwa.' });
    const time = Number(msg.time);
    if (!E.TIMES.includes(time)) return this.send(ws, { t: 'error', code: 'badcfg', err: 'Nieprawidłowy limit czasu.' });
    s.time = time;
    await this.commit();
  }

  async start(ws, seat) {
    const s = this.state;
    if (seat !== 0) return this.send(ws, { t: 'error', code: 'nothost', err: 'Grę zaczyna gospodarz pokoju.' });
    if (s.game && s.game.phase !== 'end') return this.send(ws, { t: 'error', code: 'phase', err: 'Gra już trwa.' });
    if (!s.seats[1]) return this.send(ws, { t: 'error', code: 'alone', err: 'Poczekaj na drugiego gracza.' });
    this.newGame();
    await this.commit();
  }

  newGame() {
    const s = this.state;
    const sd = this.seed(), names = s.seats.map(x => x.name);
    s.game = E.setup(sd, names);
    s.record = { seed: sd, names, moves: [] };
    s.games++;
    s.lastMove = null;
    s.deadline = 0; s.armedFor = null;
    this.arm();
  }

  // Rewanż: nowa gra z tymi samymi graczami (każdy z nich może kliknąć po końcu gry).
  async rematch(ws, seat) {
    const s = this.state;
    if (!s.game || s.game.phase !== 'end') return this.send(ws, { t: 'error', code: 'phase', err: 'Gra jeszcze trwa.' });
    return this.start(ws, 0);
  }

  async move(ws, seat, msg) {
    const s = this.state;
    if (!s.game) return this.send(ws, { t: 'error', code: 'phase', err: 'Gra jeszcze się nie zaczęła.' });
    // Ponowione wysłanie tego samego ruchu (po zerwaniu połączenia) jest ignorowane.
    if (msg.id != null && s.lastMove && s.lastMove.seat === seat && s.lastMove.id === msg.id) return this.broadcast();
    const g = structuredClone(s.game);
    const res = E.apply(g, seat, msg.act);
    if (res.err) return this.send(ws, { t: 'error', code: 'move', err: res.err });
    s.game = g;
    this.rec(seat, msg.act);
    s.lastMove = msg.id != null ? { seat, id: String(msg.id).slice(0, 40) } : null;
    this.arm();
    await this.commit();
  }

  // Ustawia termin ruchu, gdy zmienił się gracz, który ma działać (albo gra się skończyła): dla człowieka limit
  // czasu tury (jeśli ustawiony), dla bota chwila „namysłu”, po której alarm wykona jego ruch.
  arm() {
    const s = this.state, g = s.game;
    const who = g ? E.actor(g) : null;
    const bot = who != null && this.isBot(who);
    if (who == null || (!s.time && !bot)) { s.deadline = 0; s.armedFor = null; return; }
    const key = `${who}:${g.turnNo}:${g.pending.length}`;
    if (s.armedFor === key && s.deadline) return;
    s.armedFor = key;
    const [lo, hi] = BOT_DELAY;
    s.deadline = this.now() + (bot ? Math.round(lo + (hi - lo) * this.rand()) : s.time * 1000 + GRACE);
  }

  // Ruch bota: widzi tylko swój widok gry. Gdyby (wbrew testom) wybrał zły ruch, gra ruch domyślny.
  botTurn(g, seat) {
    let act = null;
    try { act = botMove(E.view(g, seat), this.state.seats[seat].bot, this.rand); } catch (e) { console.error('bot', e); }
    if (act && !E.apply(g, seat, act).err) return this.rec(seat, act);
    const t = E.timeoutMove(g);
    if (t) this.rec(t.p, t.act);
  }

  rec(seat, act) { const r = this.state.record; if (r) r.moves.push([seat, cleanAct(act)]); }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    if (s.deadline && this.now() >= s.deadline && s.game && s.game.phase !== 'end') {
      const g = structuredClone(s.game);
      const who = E.actor(g);
      if (this.isBot(who)) this.botTurn(g, who);
      else { const t = E.timeoutMove(g); if (t) this.rec(t.p, t.act); }
      s.game = g;
      s.deadline = 0; s.armedFor = null;
      this.arm();
      return this.commit();
    }
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
    this.state.seats.forEach((x, i) => { if (x && x.bot) on[i] = true; });
    return on;
  }

  viewFor(seat, on) {
    const s = this.state;
    const who = s.game ? E.actor(s.game) : null;
    const botTurn = who != null && this.isBot(who);   // zegar tury pokazujemy tylko dla człowieka
    return {
      code: s.code, seat, time: s.time, games: s.games,
      seats: s.seats.map((x, i) => (x ? { name: x.name, on: on[i], ...(x.bot ? { bot: x.bot } : {}) } : null)),
      left: s.deadline && !botTurn ? Math.max(0, s.deadline - this.now() - GRACE) : 0,
      game: s.game ? E.view(s.game, seat) : null,
      record: s.game && s.game.phase === 'end' && s.record ? s.record : null,
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
