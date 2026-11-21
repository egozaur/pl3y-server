// Testy: gracze PL3Y (nick + PIN + awatar, blokada, reset przez admina) i Wordle PL (słowo dnia, próby, ranking),
// także przez cały Worker (index.js) z prawdziwymi klasami Durable Objects w pamięci.
import { Players, normNick, PIN_FAILS, PIN_LOCK_MS, playerToken, resetLink, resetFromLink, notifyAdmin } from '../../src/core/players.js';
import { WdDaily, warsaw, evaluate, wordFor, LAUNCH_DAY, byRank } from '../../src/games/wordle/daily.js';
import { ANSWERS } from '../../src/games/wordle/words-pl.js';
import { MlScores } from '../../src/games/milion/scores.js';
import { signToken } from '../../src/core/auth.js';
import worker from '../../src/index.js';

export const plTests = [];
const test = (name, fn) => plTests.push({ name: 'gracze/wordle: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

const SECRET = 'klucz-do-testow-graczy-123';

// Pamięć Durable Object: get/put (klucz albo obiekt)/list({prefix})/delete(tablica).
function mkStorage() {
  const m = new Map();
  return {
    m,
    get: async k => structuredClone(m.get(k)),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); else m.set(k, structuredClone(v)); },
    list: async ({ prefix = '' } = {}) => new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
    delete: async ks => { for (const k of [].concat(ks)) m.delete(k); },
  };
}
// Przestrzeń DO z jednym obiektem na nazwę (jak w Cloudflare).
function mkNs(make) {
  const objs = new Map();
  // stub.fetch(url, init) w Cloudflare dociera do obiektu jako Request
  return { idFromName: n => n, get: id => { if (!objs.has(id)) objs.set(id, make()); const o = objs.get(id); return { fetch: (u, i) => o.fetch(u instanceof Request ? u : new Request(u, i)) }; }, objs };
}
const call = (o, path, body) => o.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json() }));

// ---------- nick ----------

test('normNick: wielkość liter, ogonki i spacje dają ten sam klucz; złe nicki odrzucone', () => {
  const a = normNick('  Jonathan '), b = normNick('JONATHAN'), c = normNick('Jonáthan'), d = normNick('Łukasz  Ż');
  assert(a.nick === 'Jonathan' && a.n === 'jonathan' && b.n === 'jonathan' && c.n === 'jonathan', 'jonathan');
  assert(d.n === 'lukasz z' && d.nick === 'Łukasz Ż', 'ogonki i spacje: ' + d.n);
  for (const bad of ['', 'a', 'x'.repeat(17), '<b>', 'ab😀', null, 5]) assert(!normNick(bad) || bad === 5 && false, 'zły nick ' + bad);
});

// ---------- DO Players ----------

test('Players: zakładanie, zajęty nick, logowanie PIN-em, awatar', async () => {
  const p = new Players({ storage: mkStorage() }, {});
  assert((await call(p, '/check', { n: 'ala' })).j.exists === false, 'wolny');
  const c = await call(p, '/claim', { n: 'ala', nick: 'Ala', pin: '1234', avatar: 3 });
  assert(c.status === 200 && c.j.v === 1 && c.j.avatar === 3, 'założony');
  assert((await call(p, '/claim', { n: 'ala', nick: 'ALA', pin: '0000' })).status === 409, 'zajęty');
  assert((await call(p, '/claim', { n: 'ola', nick: 'Ola', pin: '12a4' })).status === 400, 'PIN tylko cyfry');
  assert((await call(p, '/login', { n: 'ala', pin: '1234' })).j.nick === 'Ala', 'dobry PIN');
  assert((await call(p, '/login', { n: 'ala', pin: '9999' })).status === 401, 'zły PIN');
  assert((await call(p, '/login', { n: 'nikt', pin: '1234' })).status === 404, 'brak gracza');
  assert((await call(p, '/avatar', { n: 'ala', v: 1, avatar: 7 })).j.avatar === 7, 'awatar');
  assert((await call(p, '/avatar', { n: 'ala', v: 1, avatar: 99 })).j.avatar === 0, 'awatar spoza zakresu = brak');
  assert((await call(p, '/avatar', { n: 'ala', v: 2, avatar: 1 })).status === 401, 'stara wersja PIN-u');
  const raw = await p.ctx.storage.get('p:ala');
  assert(!JSON.stringify(raw).includes('1234'), 'PIN nie jest zapisany jawnie');
});

test('Players: 5 błędnych PIN-ów blokuje nick na 15 min, potem dobry PIN działa', async () => {
  let t = 1_000_000; const p = new Players({ storage: mkStorage() }, {}, () => t);
  await call(p, '/claim', { n: 'ala', nick: 'Ala', pin: '1234' });
  for (let i = 1; i < PIN_FAILS; i++) assert((await call(p, '/login', { n: 'ala', pin: '0000' })).j.left === PIN_FAILS - i, 'zostało prób ' + i);
  assert((await call(p, '/login', { n: 'ala', pin: '0000' })).status === 429, 'blokada po 5');
  assert((await call(p, '/login', { n: 'ala', pin: '1234' })).status === 429, 'w blokadzie nawet dobry PIN nie wchodzi');
  t += PIN_LOCK_MS + 1;
  assert((await call(p, '/login', { n: 'ala', pin: '1234' })).status === 200, 'po blokadzie działa');
});

test('Players: prośba o reset raz na godzinę, reset podnosi wersję i wymaga nowego PIN-u', async () => {
  let t = 5_000_000; const p = new Players({ storage: mkStorage() }, {}, () => t);
  await call(p, '/claim', { n: 'ala', nick: 'Ala', pin: '1234', avatar: 2 });
  assert((await call(p, '/reqreset', { n: 'ala' })).j.send === true, 'pierwsza prośba wysyłana');
  assert((await call(p, '/reqreset', { n: 'ala' })).j.send === false, 'druga w ciągu godziny nie');
  assert((await call(p, '/reqreset', { n: 'nikt' })).status === 404, 'nieznany nick');
  await call(p, '/reset', { n: 'ala' });
  assert((await call(p, '/check', { n: 'ala' })).j.needPin, 'czeka na nowy PIN');
  assert((await call(p, '/login', { n: 'ala', pin: '1234' })).status === 409, 'stary PIN nie działa');
  const c = await call(p, '/claim', { n: 'ala', nick: 'ktokolwiek', pin: '4321' });
  assert(c.status === 200 && c.j.v === 3 && c.j.nick === 'Ala' && c.j.avatar === 2, 'nowy PIN, nick i awatar zostają');
  assert((await call(p, '/login', { n: 'ala', pin: '4321' })).status === 200, 'nowy PIN działa');
});

test('link resetu: podpisany, z terminem; webhook dostaje treść tylko z sekretem', async () => {
  const env = { PL3Y_TOKEN_SECRET: SECRET };
  const link = await resetLink(env, 'https://srv', 'ala', 1000);
  const t = new URL(link).searchParams.get('t');
  assert(await resetFromLink(env, t, 2000) === 'ala', 'ważny');
  assert(await resetFromLink(env, t, 1000 + 8 * 24 * 3600 * 1000) === null, 'wygasły');
  assert(await resetFromLink({ PL3Y_TOKEN_SECRET: 'inny' }, t, 2000) === null, 'zły klucz');
  assert(await resetFromLink(env, (await playerToken(SECRET, 'ala', 1)), 2000) === null, 'token gracza to nie link resetu');
  const sent = [];
  assert(await notifyAdmin({}, 'x', async () => sent.push(1)) === false && !sent.length, 'bez webhooka nic');
  assert(await notifyAdmin({ PL3Y_DISCORD_WEBHOOK: 'https://hook' }, 'hej', async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true }; }), 'wysłane');
  assert(sent[0].content === 'hej' && sent[0].allowed_mentions.parse.length === 0, 'treść i bez @everyone');
});

// ---------- Wordle: czas, ocena, słowo ----------

test('warsaw: dzień i północ wg czasu w Polsce (zima +1 h, lato +2 h)', () => {
  const w1 = warsaw(Date.UTC(2026, 0, 10, 22, 59));      // 23:59 w Polsce
  const w2 = warsaw(Date.UTC(2026, 0, 10, 23, 1));       // 00:01 następnego dnia
  assert(w2.day === w1.day + 1 && w1.day === Date.UTC(2026, 0, 10) / 864e5, 'zmiana dnia o północy zimą');
  assert(w1.nextAt === Date.UTC(2026, 0, 10, 23, 0), 'północ zimą = 23:00 UTC');
  const s = warsaw(Date.UTC(2026, 6, 10, 21, 59));
  assert(s.day === Date.UTC(2026, 6, 10) / 864e5 && s.nextAt === Date.UTC(2026, 6, 10, 22, 0), 'latem 22:00 UTC');
});

test('evaluate: powtórzone litery i polskie znaki', () => {
  assert(evaluate('ŁÓDKA', 'ŁÓDKA').every(x => x === 'correct'), 'trafione');
  assert(evaluate('KAJAK', 'KABEL').join() === 'correct,correct,absent,absent,absent', 'druga K i A nie liczą się podwójnie');
  assert(evaluate('LODKA', 'ŁÓDKA').join() === 'absent,absent,correct,correct,correct', 'L ≠ Ł, O ≠ Ó');
});

test('wordFor: stałe dla dnia i sekretu, bez powtórek w cyklu, zależne od sekretu', async () => {
  const N = ANSWERS.length, base = Math.floor(20000 / N) * N;
  const seen = new Set();
  for (let d = 0; d < N; d++) seen.add(await wordFor(SECRET, base + d));
  assert(seen.size === N, 'cały cykl bez powtórek: ' + seen.size + '/' + N);
  assert(await wordFor(SECRET, 20500) === await wordFor(SECRET, 20500), 'deterministyczne');
  let diff = 0; for (let d = 0; d < 20; d++) if (await wordFor(SECRET, 20500 + d) !== await wordFor('inny', 20500 + d)) diff++;
  assert(diff > 10, 'inny sekret = inne słowa');
});

// ---------- WdDaily ----------

function mkDaily(t0) {
  const clock = { t: t0 };
  const d = new WdDaily({ storage: mkStorage() }, { PL3Y_TOKEN_SECRET: SECRET }, () => clock.t);
  return { d, clock };
}
const PL = (n, extra = {}) => ({ n, nick: n[0].toUpperCase() + n.slice(1), avatar: 1, ...extra });

test('WdDaily: próby, kolory, koniec po wygranej, słowo dopiero po końcu, ranking dnia', async () => {
  const t0 = Date.UTC(2026, 10, 21, 10, 0);
  const { d, clock } = mkDaily(t0);
  const ans = await wordFor(SECRET, warsaw(t0).day);
  const other = ANSWERS.find(w => w !== ans);
  let s = await call(d, '/state', { pl: PL('ala') });
  assert(s.j.no === warsaw(t0).day - LAUNCH_DAY + 1 && !s.j.answer && s.j.status === 'playing', 'stan początkowy bez słowa');
  assert((await call(d, '/guess', { pl: PL('ala'), w: 'QQQQQ' })).status === 400, 'nie-słowo odrzucone');
  assert((await call(d, '/guess', { pl: PL('ala'), w: 'ABCD' })).status === 400, 'za krótkie');
  const g1 = await call(d, '/guess', { pl: PL('ala'), w: other.toLowerCase() });
  assert(g1.status === 200 && g1.j.guesses.length === 1 && !g1.j.answer, 'pierwsza próba (małe litery też)');
  clock.t += 65_000;
  const g2 = await call(d, '/guess', { pl: PL('ala'), w: ans });
  assert(g2.j.status === 'won' && g2.j.answer === ans && g2.j.rank === 1 && g2.j.ms === 65_000, 'wygrana: ' + JSON.stringify(g2.j).slice(0, 120));
  assert((await call(d, '/guess', { pl: PL('ala'), w: ans })).status === 409, 'po końcu nie da się grać');
  // Ola: 6 pudeł = przegrana; Ela: wygrana w 1 próbie
  for (let i = 0; i < 6; i++) await call(d, '/guess', { pl: PL('ola'), w: other });
  const o = await call(d, '/state', { pl: PL('ola') });
  assert(o.j.status === 'lost' && o.j.answer === ans, 'przegrana po 6');
  const e = await call(d, '/guess', { pl: PL('ela'), w: ans });
  assert(e.j.rank === 1, 'szybsza wygrana na pierwszym miejscu');
  const r = await d.fetch(new Request('https://x/rank')).then(x => x.json());
  assert(r.today.map(x => x.nick).join() === 'Ela,Ala,Ola', 'kolejność dnia: ' + r.today.map(x => x.nick));
  assert(!r.today.some(x => 'n' in x), 'bez kluczy graczy');
  assert(r.all.find(x => x.nick === 'Ala').wins === 1 && r.all.find(x => x.nick === 'Ola').wins === 0, 'statystyki');
  assert((await call(d, '/state', {})).status === 401, 'bez gracza 401');
});

test('WdDaily: nowy dzień = nowa gra, seria rośnie dzień po dniu, stare gry sprzątane', async () => {
  const t0 = Date.UTC(2026, 10, 21, 10, 0);
  const { d, clock } = mkDaily(t0);
  for (let k = 0; k < 10; k++) {
    const day = warsaw(clock.t).day;
    await call(d, '/guess', { pl: PL('ala'), w: await wordFor(SECRET, day) });
    clock.t += 864e5;
  }
  const r = await d.fetch(new Request('https://x/rank')).then(x => x.json());
  const a = r.all.find(x => x.nick === 'Ala');
  assert(a.wins === 10 && a.streak === 10 && a.max === 10 && a.avg === 1, 'seria: ' + JSON.stringify(a));
  const games = [...d.ctx.storage.m.keys()].filter(k => k.startsWith('g:'));
  assert(games.length <= 9, 'stare gry usunięte: ' + games.length);
  assert(byRank({ won: 1, tries: 3, ms: 9 }, { won: 1, tries: 3, ms: 5 }) > 0 && byRank({ won: 0, tries: 1, ms: 1 }, { won: 1, tries: 6, ms: 9 }) > 0, 'sortowanie');
});

// ---------- cały Worker ----------

function mkEnv() {
  const env = { PL3Y_PASSWORD: 'haslo-testowe-bardzo-dlugie', PL3Y_TOKEN_SECRET: SECRET, AUTH_MODE: 'required', ALLOWED_ORIGINS: 'https://pl3y.pl', ALLOW_LOCALHOST: 'false' };
  env.PLAYERS = mkNs(() => new Players({ storage: mkStorage() }, env));
  env.WD_DAILY = mkNs(() => new WdDaily({ storage: mkStorage() }, env));
  env.ML_SCORES = mkNs(() => new MlScores({ storage: mkStorage() }, env));
  return env;
}
let ipN = 0;
async function api(env, path, body, { token, method = 'POST', origin = 'https://pl3y.pl' } = {}) {
  const res = await worker.fetch(new Request('https://srv' + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '10.9.' + (ipN++ % 250) + '.1', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }), env);
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, j };
}

test('Worker: nick + PIN, token gracza, Wordle i ranking Milionerów tylko z potwierdzonym nickiem', async () => {
  const env = mkEnv();
  const { token } = await signToken(SECRET, 'd');
  assert((await api(env, '/api/pl/check', { nick: 'Jonathan' })).status === 401, 'bez sesji PL3Y 401');
  const o = { token };
  assert((await api(env, '/api/pl/check', { nick: 'J' }, o)).status === 400, 'za krótki nick');
  assert((await api(env, '/api/pl/check', { nick: 'Jonathan' }, o)).j.exists === false, 'wolny');
  const c = await api(env, '/api/pl/claim', { nick: 'Jonathan', pin: '2468', avatar: 4 }, o);
  assert(c.status === 200 && c.j.pt && c.j.nick === 'Jonathan' && c.j.avatar === 4, 'założony');
  const chk = await api(env, '/api/pl/check', { nick: 'jonathan' }, o);
  assert(chk.j.exists && chk.j.nick === 'Jonathan', 'inna wielkość liter = ten sam gracz');
  assert((await api(env, '/api/pl/claim', { nick: 'JONATHAN', pin: '1111' }, o)).status === 409, 'nie da się przejąć');
  assert((await api(env, '/api/pl/login', { nick: 'jonathan', pin: '1111' }, o)).status === 401, 'zły PIN');
  const l = await api(env, '/api/pl/login', { nick: 'jonathan', pin: '2468' }, o);
  assert(l.status === 200 && l.j.pt, 'login');
  const me = await api(env, '/api/pl/me', { pt: l.j.pt }, o);
  assert(me.j.nick === 'Jonathan' && me.j.avatar === 4, 'kim jestem');
  assert((await api(env, '/api/pl/me', { pt: 'zly.token' }, o)).status === 401, 'zły token gracza');
  assert((await api(env, '/api/pl/avatar', { pt: l.j.pt, avatar: 9 }, o)).j.avatar === 9, 'zmiana awatara');

  // Wordle
  assert((await api(env, '/api/wd/state', {}, o)).status === 401, 'Wordle bez gracza');
  const st = await api(env, '/api/wd/state', { pt: l.j.pt }, o);
  assert(st.status === 200 && st.j.status === 'playing' && !st.j.answer, 'Wordle stan');
  const ans = await wordFor(SECRET, warsaw(Date.now()).day);
  const g = await api(env, '/api/wd/guess', { pt: l.j.pt, w: ans }, o);
  assert(g.j.status === 'won' && g.j.rank === 1, 'Wordle wygrana');
  const rk = await api(env, '/api/wd/rank', undefined, { ...o, method: 'GET' });
  assert(rk.j.today[0].nick === 'Jonathan' && rk.j.today[0].avatar === 9, 'ranking dnia z nickiem i awatarem z serwera');

  // Milionerzy solo: tylko z tokenem gracza, nick z serwera (podany w treści jest ignorowany)
  assert((await api(env, '/api/ml/scores', { nick: 'Ktoś', amount: 500, qs: 1 }, o)).status === 401, 'solo bez gracza');
  const sv = await api(env, '/api/ml/scores', { pt: l.j.pt, nick: 'Podszywacz', amount: 1000, qs: 2, lvl: 'n' }, o);
  assert(sv.status === 200 && sv.j.rank === 1, 'solo zapisane');
  const sc = await api(env, '/api/ml/scores', undefined, { ...o, method: 'GET' });
  assert(sc.j.solo[0].nick === 'Jonathan', 'nick z serwera, nie z treści');

  // reset PIN-u: prośba → link → GET (tylko przycisk) → POST (reset) → stary token nie działa → nowy PIN
  const sent = [];
  const realFetch = globalThis.fetch;
  env.PL3Y_DISCORD_WEBHOOK = 'https://discord.test/hook';
  globalThis.fetch = async (u, i) => { sent.push({ u, body: JSON.parse(i.body) }); return new Response('', { status: 204 }); };
  try { assert((await api(env, '/api/pl/reset-request', { nick: 'Jonathan' }, o)).j.ok, 'prośba'); } finally { globalThis.fetch = realFetch; }
  assert(sent.length === 1 && sent[0].u === 'https://discord.test/hook' && sent[0].body.content.includes('Jonathan'), 'powiadomienie na Discordzie');
  const link = sent[0].body.content.match(/https:\/\/srv\/api\/pl\/admin-reset\?t=\S+/)[0].replace('https://srv', '');
  const get = await api(env, link, undefined, { method: 'GET', origin: null });
  assert(get.status === 200 && String(get.j).includes('<form method="post">'), 'GET pokazuje przycisk, nie resetuje');
  assert((await api(env, '/api/pl/me', { pt: l.j.pt }, o)).status === 200, 'po GET token dalej działa');
  const post = await api(env, link, undefined, { method: 'POST', origin: null });
  assert(String(post.j).includes('zresetowany'), 'POST resetuje');
  assert((await api(env, '/api/pl/me', { pt: l.j.pt }, o)).status === 401, 'stary token gracza unieważniony');
  assert((await api(env, '/api/pl/check', { nick: 'Jonathan' }, o)).j.needPin, 'czeka na nowy PIN');
  assert((await api(env, '/api/pl/claim', { nick: 'Jonathan', pin: '1357' }, o)).status === 200, 'nowy PIN ustawiony');
  assert(String((await api(env, '/api/pl/admin-reset?t=zly', undefined, { method: 'GET', origin: null })).j).includes('nieważny'), 'zły link');
});
