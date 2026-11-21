// Wspólne limity tempa i czasu życia pokojów dla całego serwera PL3Y.
// Limity są "miękkie": licznik żyje w pamięci instancji Workera / Durable Object, więc po restarcie zaczyna od zera.
// Chronią przed zalewaniem serwera, a nie przed zdeterminowanym atakiem rozproszonym.

// Po zakończeniu gry pokój znika po tym czasie bezczynności (zamiast pełnego TTL pokoju).
export const ENDED_TTL = 30 * 60 * 1000;
export const ttlFor = (ended, base) => (ended ? Math.min(base, ENDED_TTL) : base);

// Kubełek tokenów: `burst` zdarzeń od ręki, potem `perSec` na sekundę.
export class Bucket {
  constructor(burst, perSec, now = Date.now()) { this.burst = burst; this.perSec = perSec; this.tokens = burst; this.at = now; }
  take(now = Date.now()) {
    this.tokens = Math.min(this.burst, this.tokens + (now - this.at) / 1000 * this.perSec);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// Wiadomości WebSocket: 40 naraz (start gry, odświeżenie), potem 20/s na gniazdo.
// Normalna gra to pojedyncze wiadomości na kilka sekund, więc limit jej nie dotyka.
export const WS_BURST = 40;
export const WS_PER_SEC = 20;
export const WS_MAX_STRIKES = 100;            // tyle odrzuconych z rzędu i gniazdo zostaje zamknięte
const sockets = new WeakMap();

// true = wiadomość trzeba odrzucić (odpowiedź już poszła do klienta przez room.send).
export function limitMessage(room, ws, now = Date.now()) {
  let st = sockets.get(ws);
  if (!st) { st = { b: new Bucket(WS_BURST, WS_PER_SEC, now), strikes: 0 }; sockets.set(ws, st); }
  if (st.b.take(now)) { st.strikes = 0; return false; }
  st.strikes++;
  if (st.strikes === 1) room.send(ws, { t: 'error', code: 'rate', err: 'Za szybko. Zwolnij na chwilę.' });
  if (st.strikes >= WS_MAX_STRIKES) { try { ws.close(4429, 'rate'); } catch {} }
  return true;
}

// Limity żądań HTTP / prób połączenia na adres IP (okno przesuwne w pamięci instancji).
export const HTTP_LIMITS = {
  login:   { max: 8,   windowMs: 60_000 },   // próby hasła
  create:  { max: 10,  windowMs: 60_000 },   // zakładanie pokojów
  ws:      { max: 30,  windowMs: 60_000 },   // dołączanie po kodzie pokoju (nowe połączenia WebSocket)
  write:   { max: 30,  windowMs: 60_000 },   // zapisy: rundy Rozejrzyj się, wyniki Milionerów, zapisy Tajniaków
  admin:   { max: 20,  windowMs: 60_000 },   // scalanie słów (PUT/DELETE alias), strona resetu PIN-u
  pin:     { max: 20,  windowMs: 60_000 },   // logowanie / zakładanie nicka PIN-em (dodatkowo blokada nicka po 5 błędach)
  guess:   { max: 60,  windowMs: 60_000 },   // próby w Wordle (słowo dnia)
  read:    { max: 120, windowMs: 60_000 },   // odczyty statystyk, rankingów, eksport
};

export class IpLimiter {
  constructor(limits = HTTP_LIMITS) { this.limits = limits; this.hits = new Map(); this.sweepAt = 0; }
  // Zwraca 0 gdy wolno, inaczej liczbę sekund do ponowienia.
  check(kind, ip, now = Date.now()) {
    const lim = this.limits[kind];
    if (!lim) return 0;
    if (now > this.sweepAt) { this.sweep(now); this.sweepAt = now + 60_000; }
    const key = kind + '|' + ip;
    const arr = (this.hits.get(key) || []).filter(t => now - t < lim.windowMs);
    if (arr.length >= lim.max) { this.hits.set(key, arr); return Math.max(1, Math.ceil((lim.windowMs - (now - arr[0])) / 1000)); }
    arr.push(now);
    this.hits.set(key, arr);
    return 0;
  }
  sweep(now) {
    for (const [k, arr] of this.hits) {
      const lim = this.limits[k.slice(0, k.indexOf('|'))];
      if (!lim || !arr.length || now - arr[arr.length - 1] >= lim.windowMs) this.hits.delete(k);
    }
  }
}
