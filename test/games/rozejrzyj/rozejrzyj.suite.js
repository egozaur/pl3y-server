// Testy serwera „Rozejrzyj się”: wspólna baza słów (RzWords), z atrapą storage.
import { RzWords, cleanRound, norm, MAX_ROUNDS } from '../../../src/games/rozejrzyj/words.js';

export const rzTests = [];
const test = (name, fn) => rzTests.push({ name: 'rozejrzyj: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }

function mkDO() {
  const store = new Map();
  const ctx = {
    store,
    storage: {
      get: async k => structuredClone(store.get(k)),
      put: async (k, v) => { store.set(k, structuredClone(v)); },
      list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
      delete: async k => { for (const x of [].concat(k)) store.delete(x); },
    },
  };
  const w = new RzWords(ctx, {});
  let t = 1_700_000_000_000; w.now = () => (t += 1000);
  const call = async (method, path, body) => {
    const res = await w.fetch(new Request('https://words' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  return { w, ctx, call };
}
const pct = (L, kind, word) => { const e = L[kind].find(x => x[0] === word); return e ? e[1] / L.rounds : 0; };

test('normalizacja i walidacja rundy', () => {
  assert(norm('  Szklanka   wody ') === 'szklanka wody', 'norm');
  assert(norm('ŚCIANA') === 'ściana', 'polskie wielkie litery');
  assert(cleanRound({ letter: 's', words: ['Szklanka', 'stół'] }).letter === 'S', 'mała litera rundy');
  assert(!cleanRound({ letter: 'S', words: ['ściana'] }), 'S ≠ Ś');
  assert(!cleanRound({ letter: 'Q', words: [] }), 'litera spoza puli');
  assert(!cleanRound({ letter: 'S', words: ['stół', 'Stół'] }), 'duplikat po normalizacji');
  assert(!cleanRound({ letter: 'S', words: ['s' + 'x'.repeat(40)] }), 'za długie');
  assert(!cleanRound({ letter: 'S', words: Array.from({ length: 61 }, (_, i) => 's' + i) }), 'za dużo słów');
  assert(!cleanRound({ letter: 'S', words: [5] }), 'nie-tekst');
  assert(cleanRound({ letter: 'Ż', words: ['żyrandol'] }), 'Ż');
});

test('zapis rund i procent pierwszego słowa', async () => {
  const { call } = mkDO();
  for (const words of [['portfel', 'pilot'], ['portfel', 'parasol'], ['pilot', 'portfel']]) {
    const r = await call('POST', '/rounds', { letter: 'P', words });
    assert(r.status === 200 && r.json.ok, 'zapis');
  }
  assert((await call('POST', '/rounds', { letter: 'P', words: ['stół'] })).status === 400, 'zła litera odrzucona');
  const s = (await call('GET', '/stats')).json;
  const P = s.letters.P;
  assert(P.rounds === 3, 'liczba rund');
  assert(P.first[0][0] === 'portfel' && P.first[0][1] === 2, 'portfel pierwszy 2×');
  assert(Math.abs(pct(P, 'all', 'portfel') - 1) < 1e-9, 'portfel w 100% rund');
  assert(Math.abs(pct(P, 'all', 'pilot') - 2 / 3) < 1e-9, 'pilot w 2/3 rund');
  assert(!s.letters.S, 'brak pustych liter');
});

test('pusta runda liczy się do rund, ale nie ma pierwszego słowa', async () => {
  const { call } = mkDO();
  await call('POST', '/rounds', { letter: 'K', words: [] });
  await call('POST', '/rounds', { letter: 'K', words: ['kubek'] });
  const K = (await call('GET', '/stats')).json.letters.K;
  assert(K.rounds === 2 && K.first.length === 1 && pct(K, 'first', 'kubek') === 0.5, 'K');
});

test('learned rośnie bez duplikatów', async () => {
  const { call } = mkDO();
  await call('POST', '/rounds', { letter: 'P', words: ['powerbank', 'pilot'] });
  await call('POST', '/rounds', { letter: 'P', words: ['powerbank'] });
  const l = (await call('GET', '/stats')).json.learned;
  assert(l.length === 2 && l.includes('powerbank'), 'learned');
});

test('scalanie wariantów i rozłączenie bez utraty surowych danych', async () => {
  const { call } = mkDO();
  await call('POST', '/rounds', { letter: 'S', words: ['szklanka'] });
  await call('POST', '/rounds', { letter: 'S', words: ['szklanki', 'stół'] });
  await call('POST', '/rounds', { letter: 'S', words: ['Szklanka', 'stoły'] });
  let r = await call('PUT', '/alias', { from: ['szklanki'], to: 'szklanka' });
  assert(r.status === 200 && r.json.alias.szklanki === 'szklanka', 'alias');
  let S = (await call('GET', '/stats')).json.letters.S;
  assert(S.first[0][0] === 'szklanka' && S.first[0][1] === 3, 'szklanka pierwsza 3×');
  assert(!S.all.some(x => x[0] === 'szklanki'), 'wariant zniknął');
  // Łańcuch: szklanka → szklanica, więc szklanki też wskazuje na szklanicę.
  r = await call('PUT', '/alias', { from: ['szklanka'], to: 'szklanica' });
  assert(r.json.alias.szklanki === 'szklanica' && r.json.alias.szklanka === 'szklanica', 'bez łańcuchów');
  // Scalenie do wariantu kieruje na cel ostateczny.
  r = await call('PUT', '/alias', { from: ['stoły'], to: 'stół' });
  r = await call('PUT', '/alias', { from: ['stolik'], to: 'stoły' });
  assert(r.json.alias.stolik === 'stół', 'cel ostateczny');
  assert((await call('PUT', '/alias', { from: ['pilot'], to: 'stół' })).status === 400, 'różne litery');
  r = await call('DELETE', '/alias/' + encodeURIComponent('szklanka'));
  S = (await call('GET', '/stats')).json.letters.S;
  assert(S.first.find(x => x[0] === 'szklanka')[1] === 2, 'po rozłączeniu szklanka znów osobno');
  const ex = (await call('GET', '/export')).json;
  assert(ex.rounds.length === 3 && ex.rounds[1].words[0] === 'szklanki', 'surowe dane nietknięte');
  assert(ex.rounds[0].ts < ex.rounds[2].ts, 'kolejność eksportu');
});

test('nieznana trasa i zły JSON', async () => {
  const { w, call } = mkDO();
  assert((await call('GET', '/nic')).status === 404, '404');
  const res = await w.fetch(new Request('https://words/rounds', { method: 'POST', body: '{zły' }));
  assert(res.status === 400, '400');
});

test('limit rund: nadmiar kasuje najstarsze surowe rundy, liczniki zostają', async () => {
  const { call, ctx } = mkDO();
  const N = MAX_ROUNDS + 3;
  for (let i = 0; i < N; i++) await call('POST', '/rounds', { letter: 'A', words: ['a' + i] });
  const raw = [...ctx.store.keys()].filter(k => k.startsWith('r:'));
  assert(raw.length === MAX_ROUNDS, 'surowych rund dokładnie MAX_ROUNDS, jest ' + raw.length);
  const A = (await call('GET', '/stats')).json.letters.A;
  assert(A.rounds === N, 'licznik agg nie cofa się po przycięciu');
  const words = (await call('GET', '/export')).json.rounds.map(r => r.words[0]);
  assert(!words.includes('a0') && words.includes('a' + (N - 1)), 'usunięte najstarsze, zostały najnowsze');
});
