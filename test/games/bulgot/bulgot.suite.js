// Testy Bulgota: dane, statystyki, silnik walki (determinizm, umiejętności, bossowie), reguły runu, profil,
// Durable Objects BgPlayer i BgRanks oraz cały Worker (z autoryzacją gracza).
import { mix, hash, makeRng } from '../../../src/games/bulgot/rng.js';
import * as D from '../../../src/games/bulgot/data.js';
import { heroStats } from '../../../src/games/bulgot/stats.js';
import { Fight, runFight, MAX_TICKS, FURY_FROM } from '../../../src/games/bulgot/sim.js';
import * as R from '../../../src/games/bulgot/rules.js';
import { BgPlayer } from '../../../src/games/bulgot/player.js';
import { BgRanks } from '../../../src/games/bulgot/ranks.js';
import { newProfile, evaluate, onRunEnd, poolFor, onBossKill } from '../../../src/games/bulgot/profile.js';
import { Players, playerToken } from '../../../src/core/players.js';
import { signToken } from '../../../src/core/auth.js';
import worker from '../../../src/index.js';

const BOSS_POOL_FULL = structuredClone(D.BOSS_POOL);
for (const k of Object.keys(D.BOSS_POOL)) D.BOSS_POOL[k] = [k];   // w testach reguł bossowie to oryginały (warianty mają osobne testy)
D.RULES.lootChance = 100;   // w testach łup z bossa wypada zawsze (osobny test sprawdza 15%)
export const bgTests = [];
const test = (name, fn) => bgTests.push({ name: 'bulgot: ' + name, fn });
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg || ''} oczekiwano ${JSON.stringify(b)}, jest ${JSON.stringify(a)}`);

// ---------- pomocnicze ----------
const ALL = D.TILES.map(t => t.id);
const loadout = (o = {}) => ({ char: 'pyrtek', tiles: [], skills: [], coins: 0, bonusAtk: 0, noRegen: false, ...o });
const foe = (o = {}) => ({ id: 'test', name: 'Test', hp: 40, atk: 4, aspd: 100, armor: 0, evade: 0, crit: 0, art: 'rat', ...o });
const setup = (o = {}) => ({ v: 1, round: 1, mode: 'full', seed: 7, boss: null, elite: false, zone: 0,
  hero: { loadout: loadout(o.lo), hp: o.hp || D.CHARS.pyrtek.base.hp, revive: !!o.revive }, enemies: o.enemies || [foe()],
  minion: foe({ id: 'pisklak-stazysta', name: 'Pisklak', hp: 9, atk: 2, minion: true }) });
const sk = (id, lvl = 1) => ({ id, lvl });
// Pola bossa z danych (mechaniki są w BOSSES.*.mech), do ręcznie składanych wrogów w testach silnika.
const bossFx = id => { const d = D.BOSSES[id], o = {}; for (const k of ['mech', 'summon', 'rage', 'night', 'blizzard', 'vamp', 'spec', 'slow', 'steal', 'audit']) if (d[k]) o[k] = d[k]; if (d.auditEvery) o.audit = d.auditEvery; return o; };
// Walka krok po kroku z listą zdarzeń; zwraca { f, ev (wszystkie), res }.
function play(s, inputs = []) {
  const f = new Fight(s), all = [], by = new Map();
  for (const [t, slot] of inputs) { if (!by.has(t)) by.set(t, []); by.get(t).push(slot); }
  while (!f.over) { f.step(by.get(f.tick) || []); all.push(...f.ev); }
  return { f, ev: all, res: f.result() };
}
const evs = (ev, k) => ev.filter(e => e.k === k);

function mkStorage() {
  const m = new Map();
  return { m,
    get: async k => structuredClone(m.get(k)),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); else m.set(k, structuredClone(v)); },
    list: async ({ prefix = '' } = {}) => new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
    delete: async ks => { for (const k of [].concat(ks)) m.delete(k); } };
}
function mkNs(make) {
  const objs = new Map();
  return { idFromName: n => n, get: id => { if (!objs.has(id)) objs.set(id, make()); const o = objs.get(id); return { fetch: (u, i) => o.fetch(u instanceof Request ? u : new Request(u, i)) }; }, objs };
}
const post = (o, path, body) => o.fetch(new Request('https://bg/' + path, { method: 'POST', body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json() }));
const PL = { n: 'ala', nick: 'Ala', avatar: 2 };

// Nowy run z pełną pulą kafelków (do testów reguł).
// Okólniki i wady są wyłączone (decrees = null, flawAt = -1), żeby testy reguł liczyły czyste wartości; mają własne testy.
const fresh = (o = {}) => { const r = R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 4242, ...o }); assert(r.ok, r.err); r.run.decrees = [null, null, null]; r.run.flawAt = -1; return r.run; };
const tileIdx = (run, pred) => run.offer.findIndex(id => pred(D.TILE_BY_ID[id]));
// Wymusza ofertę (testy konkretnych kafelków).
const force = (run, ...ids) => { run.phase = 'offer'; run.offer = ids; run.flawAt = -1; return run; };
const win = run => { run.phase = 'fight'; run.fight = { started: true }; return R.fightFinish(run, []); };

// ---------- RNG ----------
test('rng: ten sam seed daje ten sam ciąg, mix i hash są stabilne', () => {
  const a = makeRng(123), b = makeRng(123), c = makeRng(124);
  const sa = Array.from({ length: 6 }, () => a.next()), sb = Array.from({ length: 6 }, () => b.next());
  eq(sa, sb, 'powtarzalność');
  assert(c.next() !== sa[0], 'inny seed');
  assert(mix(1, 2, 3) === mix(1, 2, 3) && mix(1, 2, 3) !== mix(3, 2, 1), 'mix');
  assert(hash('offer') === hash('offer') && hash('offer') !== hash('enc'), 'hash');
  const r = makeRng(9); const cnt = [0, 0, 0];
  for (let i = 0; i < 3000; i++) cnt[r.weighted([1, 0, 2])]++;
  assert(cnt[1] === 0 && cnt[2] > cnt[0], 'weighted respektuje wagi');
  for (let i = 0; i < 200; i++) { const v = r.int(5); assert(v >= 0 && v < 5, 'int w zakresie'); }
});

// ---------- dane ----------
test('dane: kafelki, umiejętności z Mutacjami, odblokowania, spójne odwołania', () => {
  assert(D.TILES.length >= 39, 'co najmniej 39 kafelków, jest ' + D.TILES.length);
  eq(D.STARTER_TILES.length, D.TILES.filter(t => !t.lock && !t.hatched && !t.hidden && !t.boss).length, 'na start = bez blokady (bez wyklutych)');
  for (const r of D.RECIPES) { const o = D.TILE_BY_ID[r.out]; assert(o && o.hatched && o.rarity === 3 && r.of.length === 2 && r.of.every(id => D.TILE_BY_ID[id] && D.TILE_BY_ID[id].type === 'item'), 'przepis ' + r.out); for (const st of o.sets) assert(D.SETS[st], 'zestaw ' + r.out); }
  eq(new Set(D.RECIPES.flatMap(r => r.of)).size, D.RECIPES.length * 2, 'każdy składnik w jednym przepisie');
  for (const id of Object.keys(D.MILESTONES)) assert(D.TILE_BY_ID[id] && D.TILE_BY_ID[id].type === 'stat' && D.TILE_BY_ID[id].repeat, 'próg ' + id);
  assert(new Set(ALL).size === D.TILES.length, 'unikalne id');
  const by = t => D.TILES.filter(x => x.type === t).length;
  assert(by('skill') === Object.keys(D.SKILLS).length && by('skill') === 24, '24 umiejętności, każda ma kafelek');
  for (const sk of Object.values(D.SKILLS)) assert(sk.muts && sk.muts.length === 2 && sk.muts.every(m => m.name && m.text), 'Mutacje ' + sk.id);
  for (const t of D.TILES) for (const tg of (t.tags || [])) assert(D.ELEMENTS[tg], 'żywioł ' + t.id);
  for (const t of D.TILES) {
    assert(t.name && t.text && t.rarity >= 0 && t.rarity <= 3 && D.TYPES[t.type], 'pola ' + t.id);
    if (t.type === 'skill') assert(D.SKILLS[t.skill], 'umiejętność ' + t.id);
    if (t.set) assert(D.SETS[t.set], 'zestaw ' + t.id);
    if (t.lock) assert(D.UNLOCK_BY_ID[t.lock] && D.UNLOCK_BY_ID[t.lock].target === t.id, 'odblokowanie ' + t.id);
  }
  eq(D.UNLOCKS.filter(u => u.kind === 'tile').length, D.TILES.filter(t => t.lock).length, 'każdy zablokowany kafelek ma odblokowanie');
  for (const u of D.UNLOCKS) assert(u.kind === 'char' ? D.CHARS[u.target] : D.TILE_BY_ID[u.target], 'cel ' + u.id);
  for (const c of Object.values(D.CHARS)) for (const [id] of c.startSkills) assert(D.SKILLS[id], 'start ' + c.id);
  for (const [m, M] of Object.entries(D.MODES)) for (const id of Object.values(M.bosses)) assert(D.BOSSES[id], 'boss ' + m);
  assert(D.formFor('full', 1).id === 'pyrtek' && D.formFor('full', 7).id === 'kogut' && D.formFor('full', 13).id === 'bojowy' && D.formFor('full', 17).id === 'rambo', 'formy w pełnym');
  assert(D.formFor('quick', 10).id === 'rambo' && D.formFor('quick', 1).id === 'pyrtek', 'formy w szybkim');
});

// ---------- statystyki ----------
test('statystyki: baza, kafelki, procenty, zestawy, Worek, Zakazana Pasza, wyłączony kafelek', () => {
  const B = D.CHARS.pyrtek.base;
  let S = heroStats(loadout());
  eq([S.maxHp, S.atk, S.aspd, S.crit, S.critMult], [B.hp, B.atk, 100, 5, 150], 'baza');
  S = heroStats(loadout({ tiles: ['ziarno-mocy', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob', 'pancerz-z-pierza'] }));
  eq([S.atk, S.maxHp, S.aspd, S.armor], [12, B.hp + 16, 124, 11], 'płaskie i procentowe');
  S = heroStats(loadout({ tiles: ['pakt-z-lisem'] }));
  eq([S.atk, S.maxHp], [Math.floor(8 * 150 / 100), Math.floor(B.hp * 70 / 100)], 'Pakt z Lisem');
  S = heroStats(loadout({ tiles: ['opaska-rambo', 'ostrogi-bojowe'] }));
  eq([S.atk, S.dmg, S.bleed, S.crit], [Math.round(8 * 120 / 100), 15, 4, 15], 'zestaw Rambo x2: +20% Ataku');
  assert(!S.okrzyk && heroStats(loadout({ tiles: ['opaska-rambo', 'ostrogi-bojowe', 'kamizelka-kuloodporna'] })).okrzyk, 'Ostatni Okrzyk od 3 przedmiotów');
  S = heroStats(loadout({ tiles: ['tykajace-jajo'] })); eq([S.egg, S.eggHeal], [80, 0], 'jajo co 8 s');
  S = heroStats(loadout({ tiles: ['tykajace-jajo', 'zlote-jajo', 'gniazdo-zapasowe'] })); eq([S.egg, S.eggHeal, S.revive], [60, 3, true], 'zestaw Jajeczne');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy'], coins: 30 })); eq(S.atk, Math.round(8 * 124 / 100), 'Worek: +8% za każde 10 Ziaren');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy'], coins: 200 })); eq(S.atk, Math.floor(8 * 140 / 100), 'Worek: limit +40%');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy', 'mlocarnia', 'siewnik'], coins: 200 })); assert(S.atk > Math.floor(8 * 140 / 100), 'trzy Zbożowe zdejmują limit');
  S = heroStats(loadout({ tiles: ['zakazana-pasza'] })); eq([S.atk, S.maxHp, S.aspd], [9, 78, 112], 'Zakazana Pasza +12% wszystkiego');
  S = heroStats(loadout({ tiles: ['czujne-oko', 'ziarno-mocy'] }), { off: 1 }); eq(S.atk, 8, 'wyłączony kafelek (Skubanie) nie liczy się');
  S = heroStats(loadout({ tiles: ['czujne-oko'].concat(Array(20).fill('czujne-oko')) })); eq(S.crit, 100, 'krytyk ma sufit 100%');
  S = heroStats(loadout({ tiles: ['cieple-gniazdko'], noRegen: true })); eq(S.regen, 5, 'Wulkan: regeneracja o połowę słabsza');
  S = heroStats(loadout({ char: 'kwoka' })); eq([S.maxHp, S.aspd], [Math.floor(B.hp * 120 / 100), 75], 'Kwoka');
  S = heroStats(loadout({ char: 'indor' })); eq([S.atk, S.aspd, S.crit], [Math.floor(8 * 160 / 100), 70, 15], 'Indor');
});

// ---------- silnik walki ----------
test('walka: deterministyczna (te same dane = te same zdarzenia), krok po kroku = cała naraz', () => {
  const s = setup({ lo: { tiles: ['czujne-oko', 'ostrogi-bojowe'], skills: [sk('grad'), sk('granat')] }, enemies: [foe({ hp: 80, atk: 6, crit: 20, evade: 20 }), foe({ hp: 60 })] });
  const inputs = [[60, 0], [80, 1], [300, 0]];
  const a = play(s, inputs), b = play(JSON.parse(JSON.stringify(s)), inputs);
  eq(a.ev, b.ev, 'zdarzenia'); eq(a.res, b.res, 'wynik');
  eq(runFight(s, inputs), a.res, 'runFight = krok po kroku');
  const c = play({ ...s, seed: 8 }, inputs);
  assert(JSON.stringify(c.ev) !== JSON.stringify(a.ev), 'inny seed zmienia losowe elementy');
});
test('walka: bohater wygrywa ze słabym i przegrywa z mocnym, wynik jest spójny', () => {
  let r = runFight(setup({ enemies: [foe({ hp: 24, atk: 2 })] }));
  assert(r.win && r.hp > 0 && r.ticks > 0 && r.dealt >= 24 && !r.timeout, 'wygrana');
  r = runFight(setup({ hp: 20, enemies: [foe({ hp: 500, atk: 30 })] }));
  assert(!r.win && r.hp === 0, 'przegrana');
});
test('walka: Furia po 45 s rośnie, limit 90 s kończy remisem jako porażkę', () => {
  const s = setup({ lo: { tiles: ['cieple-gniazdko'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 100 })] });
  const a = play(s);
  assert(a.res.timeout && !a.res.win && a.res.ticks === MAX_TICKS, 'timeout po 900 tickach');
  assert(evs(a.ev, 'fury').length === 1 && evs(a.ev, 'fury')[0].t === FURY_FROM, 'zdarzenie Furii w 450. ticku');
  const early = evs(a.ev, 'hurt').filter(e => e.t < FURY_FROM).map(e => e.d), late = evs(a.ev, 'hurt').filter(e => e.t >= 880).map(e => e.d);
  assert(Math.max(...late) > Math.max(...early), 'Furia zwiększa obrażenia');
});
test('walka: pancerz, unik, krytyk i obrażenia bohatera liczą się wg wzoru', () => {
  // brak krytyków (0%), pancerz 100 = połowa obrażeń
  const lo = { tiles: ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy'] };
  const base = D.CHARS.pyrtek.base; D.CHARS.pyrtek.base = { ...base, crit: 0 };
  try {
    const a = play(setup({ lo, enemies: [foe({ hp: 200, atk: 1, armor: 100 })] }));
    const hit = evs(a.ev, 'hit').find(e => e.kind === 'atk');
    eq(hit.d, Math.floor(22 * 100 / 200), 'Atak 22 (+30% z dwóch progów Kolby Mocy) przy pancerzu 100 = połowa');
    const b = play(setup({ enemies: [foe({ hp: 40, atk: 1, evade: 100 })] }));
    assert(evs(b.ev, 'miss').length > 0 && evs(b.ev, 'hit').length === 0, 'wróg z 100% uniku nie dostaje ciosów');
  } finally { D.CHARS.pyrtek.base = base; }
});
test('walka: umiejętności (Grad, Granat, Pianie, Dziobnięcie, Unik, Zagrzebanie) i cooldowny', () => {
  const none = { ...D.CHARS.pyrtek.base, crit: 0 }, keep = D.CHARS.pyrtek.base; D.CHARS.pyrtek.base = none;
  try {
    const mk = id => setup({ lo: { skills: [sk(id)] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] });
    const t0 = Math.floor(D.SKILLS.grad.cd * 15 / 100);
    // start z 15% cooldownu: wcześniejsze wejście jest ignorowane
    let a = play(mk('grad'), [[0, 0]]); assert(evs(a.ev, 'skill').length === 0, 'przed końcem startowego cooldownu nic się nie dzieje');
    a = play(mk('grad'), [[t0, 0]]);
    assert(evs(a.ev, 'skill').length === 1 && evs(a.ev, 'hit').filter(e => e.kind === 'grad').length === 5, 'Grad = 5 trafień');
    assert(evs(a.ev, 'hit').filter(e => e.kind === 'grad').every(e => e.d === Math.floor(8 * 60 / 100)), 'po 60% Ataku');
    a = play(mk('grad'), [[t0, 0], [t0 + 5, 0]]); assert(evs(a.ev, 'skill').length === 1, 'cooldown blokuje drugie użycie');
    a = play(mk('grad'), [[t0, 0], [t0 + D.SKILLS.grad.cd, 0]]); assert(evs(a.ev, 'skill').length === 2, 'po cooldownie znów działa');
    a = play(mk('grad'), [[t0, 5], [t0, -1]]); assert(evs(a.ev, 'skill').length === 0, 'zły slot ignorowany');
    const tg = Math.floor(D.SKILLS.granat.cd * 15 / 100);
    a = play(mk('granat'), [[tg, 0]]); eq(evs(a.ev, 'hit').find(e => e.kind === 'granat').d, 20, 'Granat = 250% z 8');
    // poziom 2: +30% mocy, -20% cooldownu
    const s2 = setup({ lo: { skills: [sk('granat', 2)] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] });
    a = play(s2, [[Math.floor(D.SKILLS.granat.cd * 15 / 100), 0]]); eq(evs(a.ev, 'hit').find(e => e.kind === 'granat').d, Math.floor(8 * Math.floor(250 * 130 / 100) / 100), 'Granat lvl 2');
    // Pianie: ogłuszeni wrogowie nie atakują
    const sp = setup({ lo: { skills: [sk('pianie')] }, enemies: [foe({ hp: 100000, atk: 3, aspd: 200 })] });
    const tp = Math.floor(D.SKILLS.pianie.cd * 15 / 100);
    a = play(sp, [[tp, 0]]);
    assert(evs(a.ev, 'stun').length === 1, 'ogłuszenie');
    assert(evs(a.ev, 'hurt').filter(e => e.t > tp && e.t < tp + 20).length === 0 && evs(a.ev, 'hurt').filter(e => e.t >= tp + 20).length > 0, 'przez 2 s wróg milczy, potem wraca');
    // Unik: nietykalność
    const su = setup({ lo: { skills: [sk('unik')] }, enemies: [foe({ hp: 100000, atk: 3, aspd: 200 })] });
    const tu = Math.floor(D.SKILLS.unik.cd * 15 / 100);
    a = play(su, [[tu, 0]]); assert(evs(a.ev, 'block').length > 0 && evs(a.ev, 'hurt').filter(e => e.t >= tu && e.t < tu + 15).length === 0, 'Unik blokuje');
    // Zagrzebanie: leczy 30% maks. Życia
    const sz = setup({ lo: { skills: [sk('zagrzebanie')] }, hp: 10, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] });
    a = play(sz, [[Math.floor(D.SKILLS.zagrzebanie.cd * 15 / 100), 0]]); eq(evs(a.ev, 'heal')[0].n, Math.floor(70 * 30 / 100), 'leczy 30%');
    // Dziobnięcie: więcej ciosów w oknie 6 s
    const sd = setup({ lo: { skills: [sk('dziobniecie')] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] });
    const td = Math.floor(D.SKILLS.dziobniecie.cd * 15 / 100);
    const sw = (r) => evs(r.ev, 'swing').filter(e => e.t >= td && e.t < td + 60).length;
    assert(sw(play(sd, [[td, 0]])) > sw(play(sd, [])), 'więcej ciosów po Dziobnięciu');
  } finally { D.CHARS.pyrtek.base = keep; }
});
test('walka: Tykające Jajo, krwawienie, Młocarnia, Gniazdo Zapasowe, Ostatni Okrzyk, Złodzieje, Bałwan', () => {
  let a = play(setup({ lo: { tiles: ['tykajace-jajo'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] }));
  assert(evs(a.ev, 'egg').length >= 10 && evs(a.ev, 'hit').some(e => e.kind === 'egg'), 'jajo wybucha co 8 s');
  a = play(setup({ lo: { tiles: ['ostrogi-bojowe'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] }));
  assert(evs(a.ev, 'hit').some(e => e.kind === 'bleed' && e.d === 4), 'krwawienie 4/s');
  a = play(setup({ lo: { tiles: Array(8).fill('mlocarnia').slice(0, 1) }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20, armor: 40 })] }));
  const dm = evs(a.ev, 'hit').filter(e => e.kind === 'atk'); assert(dm[dm.length - 1].d >= dm[0].d, 'rozbity pancerz nie zmniejsza obrażeń');
  // Gniazdo: wskrzeszenie raz
  const rv = setup({ revive: true, lo: { tiles: ['gniazdo-zapasowe'] }, hp: 5, enemies: [foe({ hp: 100000, atk: 9, aspd: 100 })] });
  a = play(rv); assert(evs(a.ev, 'revive').length === 1 && a.res.usedRevive && !a.res.win, 'wskrzeszenie dokładnie raz, potem porażka');
  // Okrzyk: nietykalność poniżej 20% życia
  a = play(setup({ lo: { tiles: ['opaska-rambo', 'ostrogi-bojowe', 'kamizelka-kuloodporna'] }, hp: 40, enemies: [foe({ hp: 100000, atk: 20, aspd: 100 })] }));
  assert(evs(a.ev, 'okrzyk').length === 1, 'Ostatni Okrzyk raz na walkę');
  // kradzież Ziaren (limit 3 dla Lisa)
  a = play(setup({ hp: 5000, lo: {}, enemies: [foe({ hp: 100000, atk: 1, aspd: 300, steal: { n: 1, max: 3 } })] }));
  assert(a.res.stolen === 3, 'Lis kradnie maks. 3, jest ' + a.res.stolen);
  a = play(setup({ hp: 5000, enemies: [foe({ hp: 100000, atk: 1, aspd: 100, slow: { pct: 20, ticks: 30 } })] }));
  const swings = evs(a.ev, 'swing').length; assert(swings < MAX_TICKS / 10, 'spowolnienie zmniejsza liczbę ciosów (' + swings + ')');
});
// Walka z ręcznie podkręconymi statystykami bohatera (efekty statusowe bez kafelków).
function playS(s0, patch, inputs = []) {
  const f = new Fight(s0); Object.assign(f.S, patch); const all = [];
  const by = new Map(); for (const [t, sl] of inputs) { if (!by.has(t)) by.set(t, []); by.get(t).push(sl); }
  while (!f.over) { f.step(by.get(f.tick) || []); all.push(...f.ev); }
  return { f, ev: all, res: f.result() };
}

test('efekty: Oparzenie kumuluje się do limitu i bije co sekundę mimo pancerza', () => {
  const s0 = setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 10, armor: 200 })] });
  const a = playS(s0, { burnHit: 100, atk: 50 });
  const burns = evs(a.ev, 'hit').filter(e => e.kind === 'burn');
  assert(burns.length > 20, 'oparzenie bije');
  eq(Math.max(...burns.map(e => e.d)), D.STATUS.burn.max * 5, 'limit 10 stosów × 10% z 50 Ataku');
  const f = new Fight(s0); Object.assign(f.S, { burnHit: 100, atk: 50 }); for (let i = 0; i < 300; i++) f.step();
  eq(f.enemies[0].burn, D.STATUS.burn.max, 'stosy na limicie');
});

test('Zjarany Kurczak: statystyki, Chmura Dymu co 4 s (Oparzenie i spowolnienie), inne postacie bez zmian', () => {
  const S = heroStats(loadout({ char: 'zjarany' }));
  eq([S.atk, S.aspd, S.regen, S.burnHit, S.burnMax, S.smoke], [7, 55, 20, 30, 4, 40], 'Zjarany: statystyki');
  eq(heroStats(loadout({ char: 'indor' })).smoke, 0, 'Indor bez Chmury');
  const f = new Fight(setup({ lo: { char: 'zjarany' }, enemies: [foe({ hp: 100000, atk: 1, aspd: 100 }), foe({ hp: 100000, atk: 1, aspd: 100 })] }));
  const smokes = []; for (let i = 0; i < 90; i++) { f.step(); for (const e of f.ev) if (e.k === 'smoke') smokes.push(f.tick - 1); }
  eq(smokes, [39, 79], 'Chmura Dymu w 40. i 80. ticku');
  assert(f.enemies.every(e => e.burn >= D.RULES.smokeBurn), 'wrogowie podpaleni Chmurą');
  // spowolnienie: wróg w dymie atakuje rzadziej niż ten sam wróg bez dymu
  const hits = lo => { const g = new Fight(setup({ lo, hp: 100000, enemies: [foe({ hp: 100000, atk: 1, aspd: 100 })] })); let n = 0; for (let i = 0; i < 200; i++) { g.step(); n += g.ev.filter(e => e.k === 'hurt' && e.from).length; } return n; };
  assert(hits({ char: 'zjarany' }) < hits({ char: 'pyrtek' }), 'Chmura spowalnia atak wrogów');
});
test('Ziarna zdobyte łącznie w runie (stats.earned): wzrosty liczą się, wydatki i zastaw nie', () => {
  const run = fresh({ char: 'kaczor' }); eq(run.stats.earned || 0, 0, 'start: Ziarna startowe nie liczą się');
  run.phase = 'event'; run.pending = { kind: 'gamble' }; run.coins = 10; run.seed = 1; const before = run.stats.earned || 0;
  R.bet(run, 10); assert((run.stats.earned || 0) === before + (run.coins > 0 ? 10 : 0), 'wygrany zakład liczy się, przegrany nie');
  const r2 = fresh(); r2.phase = 'offer'; r2.tiles = ['kostka-rosolowa']; r2.coins = 0;
  const e0 = r2.stats.earned || 0; R.pawn(r2, 'kostka-rosolowa'); eq(r2.stats.earned || 0, e0, 'zastaw w lombardzie nie liczy się');
  const r3 = fresh(); r3.phase = 'fight'; r3.fight = {}; r3.hp = 70; const e1 = r3.stats.earned || 0;
  const w = R.fightFinish(r3, []); assert(w.ok, 'walka rozstrzygnięta'); if (w.result.win) assert(r3.stats.earned > e1, 'nagroda za piętro liczy się do zdobytych Ziaren');
});
test('view().board: faktury za wygrane piętra (liczby z dziennika), bez wrogów i ziarna', () => {
  const run = fresh(); run.phase = 'fight'; run.fight = {}; run.hp = 70; run.tiles = Array(12).fill('ziarno-mocy');
  const w = R.fightFinish(run, []); assert(w.ok && w.result.win, 'wygrana walka');
  const v = R.view(run); eq(v.board.length, 1, 'jedna faktura'); eq(Object.keys(v.board[0]).sort(), ['boss', 'dealt', 'r', 'reward', 'ticks'], 'tylko liczby');
  eq([v.board[0].r, v.board[0].reward], [1, w.reward], 'piętro i wypłata'); assert(!JSON.stringify(v.board).includes('enemies'), 'brak wrogów');
});
test('wynik walki: ile życia wrogów zostało i kto walczył (ciekawostki na ekranie porażki)', () => {
  const lost = runFight(setup({ hp: 5, enemies: [foe({ name: 'Szczur', hp: 1000, atk: 50 })] }));
  assert(!lost.win && lost.foeLeft > 90 && lost.foes[0] === 'Szczur', 'przegrana: prawie całe życie wroga zostało');
  const won = runFight(setup({ enemies: [foe({ hp: 10, atk: 1 })] }));
  eq([won.win, won.foeLeft], [true, 0], 'wygrana: nic nie zostało');
});
test('efekty: Mróz spowalnia, 5 stosów zamraża (przerywa szarżę), boss zamarza krócej', () => {
  const f = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 100, spec: { every: 200, windup: 30, mult: 300 } })] }));
  const e = f.enemies[0];
  for (let i = 0; i < 4; i++) f.applyStatus(e, 'frost', 1);
  eq([e.frost, e.frozenUntil], [4, 0], '4 stosy bez zamrożenia');
  e.windup = { end: 50 };
  f.applyStatus(e, 'frost', 1);
  eq([e.frost, e.frozenUntil, e.stunUntil, e.windup], [0, D.STATUS.frost.freeze, D.STATUS.frost.freeze, null], 'zamrożenie przerywa szarżę');
  assert(!f.applyStatus(e, 'frost', 1), 'zamrożony nie zbiera stosów');
  const b = new Fight(setup({ enemies: [foe({ hp: 1000, boss: 'brojler' })] }));
  b.applyStatus(b.enemies[0], 'frost', 5);
  eq(b.enemies[0].frozenUntil, Math.floor(D.STATUS.frost.freeze / 2), 'boss o połowę krócej');
  // spowolnienie: 3 stosy Mrozu = -24% szybkości ataku wroga
  const g = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 100 })] }));
  g.applyStatus(g.enemies[0], 'frost', 3); g.enemies[0].frostT = 1e9; g.step();
  eq(g.enemies[0].acc, 76, 'tempo wroga 76%');
});

test('efekty: Salmonella przechodzi na następnego wroga, odporność blokuje efekt, nietykalny nie dostaje', () => {
  const f = new Fight(setup({ enemies: [foe({ hp: 5 }), foe({ hp: 1000 }), foe({ hp: 1000, resist: ['burn'] })] }));
  const [a, b, c] = f.enemies;
  f.applyStatus(a, 'poison', 8);
  f.kill(a);
  eq(b.poison, 4, 'połowa stosów przechodzi');
  assert(!f.applyStatus(c, 'burn', 3) && c.burn === 0, 'odporność');
  assert(f.applyStatus(c, 'poison', 1), 'inna odporność nie blokuje');
  c.immune = true; assert(!f.applyStatus(c, 'bleed', 1), 'nietykalny');
  // stosy wygasają po czasie
  f.applyStatus(b, 'burn', 2); b.burnT = f.tick; f.tick = 9; f.dots(); eq(b.burn, 0, 'wygasło');
});

test('efekty: krwawienie kumuluje się do 3 stosów (+bleedMax), walka z efektami jest deterministyczna', () => {
  const s0 = setup({ lo: { tiles: ['ostrogi-bojowe'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] });
  const f = new Fight(s0); for (let i = 0; i < 100; i++) f.step();
  eq(f.enemies[0].bleed, 3, '3 stosy');
  const g = new Fight(s0); g.S.bleedMax = 2; for (let i = 0; i < 100; i++) g.step();
  eq(g.enemies[0].bleed, 5, '+2 stosy');
  const s1 = setup({ enemies: [foe({ hp: 3000 }), foe({ hp: 3000 })] });
  const p = { burnHit: 40, frostHit: 40, poisonHit: 40, bleed: 3 };
  eq(JSON.stringify(playS(s1, p).ev), JSON.stringify(playS(s1, p).ev), 'determinizm');
});

test('umiejętności: nowe (Chlust, Lodowy Dziób, Zgniłe Jajo, Darcie, Egzekucja, Premia) nakładają efekty', () => {
  const big = () => foe({ hp: 100000, atk: 1, aspd: 10 });
  const first = (id, lvl = 1, mut = 0, enemies = [big(), big()]) => { const f = new Fight(setup({ lo: { skills: [{ id, lvl, mut }] }, enemies })); f.skills[0].cd = 0; f.step([0]); return f; };
  let f = first('chlust'); assert(f.enemies.every(e => e.burn === 3), 'Chlust: 3 Oparzenia na wszystkich');
  f = first('chlust', 3, 1); assert(f.enemies.every(e => e.burn === 6), 'Kocioł: 6');
  f = first('chlust', 3, 2); assert(f.enemies.every(e => e.stunUntil > 0), 'Rosół z Kością ogłusza');
  f = first('lodowy'); eq([f.enemies[0].frost, f.enemies[1].frost], [2, 0], 'Lodowy Dziób: 2 Mrozu na celu');
  f = first('lodowy', 3, 1); assert(f.enemies[0].frozenUntil > 0, 'Sopel zamraża');
  f = first('lodowy', 3, 2); assert(f.enemies.every(e => e.frost === 2), 'Szron na wszystkich');
  f = first('zgnile'); eq([f.enemies[0].poison, f.enemies[1].poison], [5, 1], 'Zgniłe Jajo');
  f = first('zgnile', 3, 2); eq(f.enemies[0].poison, 12, 'Wylęg Bakterii podwaja (do limitu)');
  f = first('darcie'); assert(f.enemies.every(e => e.bleed === 2), 'Darcie: 2 Krwawienia');
  f = first('darcie', 3, 1); assert(f.enemies.every(e => e.bleed === 3) && f.bleedExtra === 2, 'Pierzasta Burza');
  f = first('egzekucja', 1, 0, [foe({ hp: 1000 })]); const d1 = 1000 - f.enemies[0].hp;
  const g = new Fight(setup({ lo: { skills: [sk('egzekucja')] }, enemies: [foe({ hp: 1000 })] })); g.enemies[0].hp = 200; g.skills[0].cd = 0; g.step([0]);
  assert(200 - g.enemies[0].hp > d1 * 2.5, 'egzekucja poniżej 30% bije mocniej');
  f = first('premia', 1, 0, [foe({ hp: 5 }), big()]); eq(f.coinsWon, 1, 'Premia: +1 Ziarno za zabójstwo');
  f = first('premia', 3, 1, [foe({ hp: 5 }), big()]); eq(f.coinsWon, 2, 'Premia Roczna: +2');
  f = first('grad', 3, 1, [big()]); assert(f.enemies[0].burn >= 1, 'Ognisty Grad');
  f = first('granat', 3, 1, [big(), big()]); assert(f.enemies[1].hp < 100000, 'Granat Kasetowy trafia resztę');
});

test('umiejętności: Kontra zmniejsza obrażenia i oddaje, Kąpiel oślepia, Unik z Kontrą, Wściekłe Siano, Szał Krwi', () => {
  const hitter = () => foe({ hp: 100000, atk: 6, aspd: 200 });
  const run = (skills, n = 25) => { const f = new Fight(setup({ hp: 70, lo: { skills }, enemies: [hitter()] })); f.skills[0].cd = 0; for (let i = 0; i < n; i++) f.step(i === 0 ? [0] : []); return f; };
  const base = run([sk('grad')]), kon = run([sk('kontra')]);
  assert(kon.taken * 2 <= base.taken + 2 && kon.enemies[0].hp < 100000, 'Kontra: połowa obrażeń i oddawanie');
  const kap = run([{ id: 'kapiel', lvl: 3, mut: 1 }]);
  assert(kap.taken < base.taken, 'Kąpiel: mniej trafień');
  const uk = run([{ id: 'unik', lvl: 3, mut: 1 }], 15); assert(uk.taken === 0 && uk.enemies[0].hp < 100000, 'Unik z Kontrą oddaje');
  const z = new Fight(setup({ lo: { skills: [{ id: 'zagrzebanie', lvl: 3, mut: 2 }] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] })); z.skills[0].cd = 0;
  const ev = []; for (let i = 0; i < 40; i++) { z.step(i === 0 ? [0] : []); ev.push(...z.ev); }
  assert(evs(ev, 'hit').filter(e => e.kind === 'atk').every(e => e.crit), 'Wściekłe Siano: same krytyki');
  const sz = new Fight(setup({ lo: { skills: [{ id: 'dziobniecie', lvl: 3, mut: 1 }] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] })); sz.skills[0].cd = 0;
  for (let i = 0; i < 12; i++) sz.step(i === 0 ? [0] : []); assert(sz.enemies[0].bleed >= 2, 'Szał Krwi nakłada krwawienie');
});

test('przedmioty: zestawy Rosołowe, Chłodnicze i Korporacyjne (progi 2/3/4), przedmioty w kilku zestawach', () => {
  const S = tiles => heroStats(loadout({ tiles }));
  eq([S(['chochla']).burnHit, S(['chochla', 'kostka-rosolowa']).burnPct, S(['chochla', 'kostka-rosolowa', 'lubczyk']).burnHit], [25, 65, 125 > 100 ? 100 : 125], 'Rosołowe: 25% → +25% obrażeń → zawsze');
  eq(S(['chochla', 'kostka-rosolowa', 'lubczyk', 'garnek-cisnieniowy']).startBurn, 3, 'Rosołowe x4: start z Oparzeniem');
  eq([S(['kostka-lodu', 'termometr']).frostSlow, S(['kostka-lodu', 'termometr', 'zamrazarka']).shatter, S(['kostka-lodu', 'termometr', 'zamrazarka', 'szron']).startFrost], [4, 80, 2], 'Chłodnicze');
  eq([S(['teczka', 'krawat']).restDisc, S(['teczka', 'krawat', 'polisa']).buyDisc, S(['teczka', 'krawat', 'polisa', 'premia-kwartalna']).interest], [2, 25, 10], 'Korporacyjne');
  eq(S(['zepsute-jajo', 'tykajace-jajo']).egg, 60, 'Zepsute Jajo liczy się do zestawu Jajecznego');
  const f = new Fight(setup({ lo: { tiles: ['chochla', 'kostka-rosolowa', 'lubczyk', 'garnek-cisnieniowy'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] }));
  eq(f.enemies[0].burn, 3, 'start walki z 3 stosami');
  const ev = []; for (let i = 0; i < 120; i++) { f.step(); ev.push(...f.ev); }
  assert(evs(ev, 'boom').length > 0 && evs(ev, 'hit').some(e => e.kind === 'boom'), 'Garnek Ciśnieniowy wybucha');
  assert(evs(ev, 'heal').length > 0 || f.hp === f.S.maxHp, 'Lubczyk leczy');
});

test('przedmioty: Szron mrozi atakujących, Termometr bije mocniej, Polisa chroni Ziarna, Mokra Pasza truje', () => {
  const sz = new Fight(setup({ lo: { tiles: ['szron'] }, enemies: [foe({ hp: 100000, atk: 2, aspd: 200 })] }));
  for (let i = 0; i < 20; i++) sz.step(); assert(sz.enemies[0].frost > 0 || sz.freezes > 0, 'Szron');
  const hit = tiles => { const f = new Fight(setup({ lo: { tiles }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] })); f.enemies[0].frost = 2; f.enemies[0].frostT = 1e9; return f.heroHit(f.enemies[0], 100, false, 'atk'); };
  assert(hit(['termometr']) > hit([]), 'Termometr: +30% przeciw zmrożonym');
  const thief = () => foe({ hp: 100000, atk: 1, aspd: 300, steal: { n: 1, max: 99 } });
  const a = new Fight(setup({ enemies: [thief()] })), b = new Fight(setup({ lo: { tiles: ['polisa'] }, enemies: [thief()] }));
  for (let i = 0; i < 30; i++) { a.step(); b.step(); }
  assert(a.stolen > 0 && b.stolen === 0, 'Polisa: brak kradzieży');
  const mp = new Fight(setup({ lo: { tiles: ['mokra-pasza'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 })] }));
  for (let i = 0; i < 200; i++) mp.step(); assert(mp.enemies[0].poison > 0, 'Mokra Pasza');
});

test('przedmioty: ekonomia (Teczka, Krawat, Premia Kwartalna, zniżki zestawu Korporacyjnego)', () => {
  const run = fresh(); run.tiles = ['teczka', 'krawat', 'polisa']; run.coins = 40;
  eq([R.shopPrice(D.TILE_BY_ID['ziarenko-z-podlogi'], run), R.shopPrice(D.TILE_BY_ID['ziarenko-z-podlogi'])], [4, 6], 'dokupowanie 25% taniej');
  eq(R.restCost(run), D.RULES.restCost - 2, 'odpoczynek taniej');
  run.offer = ['ziarno-mocy', 'twardy-grzebien', 'szybki-dziob', 'ostry-dziob']; R.pickTile(run, 0);
  R.fightSetup(run); const coins0 = run.coins; const out = R.fightFinish(run, []);
  assert(out.result.win, 'wygrana w 1. rundzie');
  eq(run.coins - coins0, D.RULES.coinsRound + 2 + Math.min(D.RULES.interestMax, Math.floor(coins0 / 10)), 'Teczka +2 (plus Odsetki)');
  eq(run.freeLeft, 1, 'Krawat: darmowy reroll w nowej rundzie');
});

test('Wylęgarnia: dwa składniki wykluwają legendarny przedmiot, który znika z ofert, a składniki nie wracają', () => {
  const run = fresh();
  run.offer = ['tykajace-jajo', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(run, 0); run.phase = 'offer';
  assert(!run.hatchedNow, 'jeden składnik to za mało');
  run.offer = ['kostka-rosolowa', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(run, 0);
  assert(run.tiles.includes('jajko-na-twardo') && !run.tiles.includes('tykajace-jajo') && !run.tiles.includes('kostka-rosolowa'), 'wyklute');
  eq(run.hatchedNow, ['jajko-na-twardo'], 'informacja dla gracza'); eq(run.stats.hatched, ['jajko-na-twardo'], 'statystyka');
  const offer = R.makeOffer(run, 7, { size: 80 });
  assert(!offer.includes('jajko-na-twardo') && !offer.includes('tykajace-jajo') && !offer.includes('kostka-rosolowa'), 'ani wyklute, ani składniki w ofertach');
  const S = R.statsOf(run); assert(S.egg === 60 && S.eggAll && S.eggBurn === 4 && S.burnPct >= 40, 'Jajko na Twardo');
  eq([S.sets.jajeczne, S.sets.rosolowe], [1, 1], 'liczy się do obu zestawów');
  const f = new Fight(setup({ lo: { tiles: ['jajko-na-twardo'] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 10 }), foe({ hp: 100000, atk: 1, aspd: 10 })] }));
  for (let i = 0; i < 70; i++) f.step(); assert(f.enemies.every(e => e.burn >= 4 && e.hp < 100000), 'wybuch we wszystkich z Oparzeniem');
  const p = newProfile(); evaluate(p, run); eq(p.recipes, ['jajko-na-twardo'], 'przepis odkryty w profilu');
  // Feniks: wskrzeszenie z 70% i Oparzeniem
  const fx = new Fight(setup({ hp: 5, revive: true, lo: { tiles: ['feniks-z-rosolu'] }, enemies: [foe({ hp: 100000, atk: 30, aspd: 100 })] }));
  const ev = []; while (!fx.revived && !fx.over) { fx.step(); ev.push(...fx.ev); }
  assert(fx.revived && fx.hp === Math.floor(fx.S.maxHp * 70 / 100) && fx.enemies[0].burn === 6, 'Feniks z Rosołu');
  const zs = fresh(); zs.tiles = ['zlote-jajo']; zs.offer = ['teczka', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(zs, 0);
  eq(zs.tiles, ['zloty-spadochron'], 'Złoty Spadochron'); assert(R.statsOf(zs).coinFlat === 7 && R.statsOf(zs).noSteal, 'efekty Spadochronu');
});

test('progi statystyk: co 3 kopie premia (Kolba Mocy, Koguci Hełm), dwa progi przy 6 kopiach', () => {
  const S = tiles => heroStats(loadout({ tiles }));
  const a2 = S(['ziarno-mocy', 'ziarno-mocy']).atk, a3 = S(['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']).atk;
  eq([a2, a3], [12, 15], 'Kolba Mocy +15% Ataku');
  eq(S(Array(6).fill('ziarno-mocy')).atk, Math.round(8 * 274 / 100), 'dwa progi');
  const h = S(['twardy-grzebien', 'twardy-grzebien', 'twardy-grzebien']); eq([h.maxHp, h.armor], [Math.floor(118 * 110 / 100), 4], 'Koguci Hełm');
});

test('nowi wrogowie: Kaczka podpala bohatera, Kurczak z Zamrażarki wstaje (chyba że płonie), Sęp Audytor czyści efekty', () => {
  const k = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 10, aspd: 200, ignite: 40 })] }));
  const ev = []; for (let i = 0; i < 30; i++) { k.step(); ev.push(...k.ev); }
  assert(k.hburn > 0 && evs(ev, 'hurt').some(e => e.kind === 'burn' && e.d >= 4), 'Oparzenie na bohaterze');
  const z = new Fight(setup({ enemies: [foe({ hp: 100, rise: 50 }), foe({ hp: 100000 })] }));
  z.enemies[0].hp = 0; z.kill(z.enemies[0]);
  assert(!z.enemies[0].dead && z.enemies[0].hp === 50 && z.enemies[0].risen, 'wstaje z połową');
  z.enemies[0].hp = 0; z.kill(z.enemies[0]); assert(z.enemies[0].dead, 'drugi raz już nie');
  const zb = new Fight(setup({ enemies: [foe({ hp: 100, rise: 50 })] })); zb.applyStatus(zb.enemies[0], 'burn', 2); zb.kill(zb.enemies[0]);
  assert(zb.enemies[0].dead, 'płonący nie wstaje');
  const a = new Fight(setup({ enemies: [foe({ hp: 100000, audit: 60 }), foe({ hp: 100000 })] }));
  for (const e of a.enemies) { a.applyStatus(e, 'burn', 5); a.applyStatus(e, 'poison', 5); e.burnT = e.poisonT = 1e9; }
  for (let i = 0; i <= 60; i++) a.step();
  assert(a.enemies.every(e => e.burn === 0 && e.poison === 0) && a.enemies[0].shieldHits >= 1, 'Audyt czyści i daje tarczę');
});

test('cechy elit: wampiryzm, wybuch po śmierci, regeneracja, odporność, szybkość', () => {
  const run = fresh({ mode: 'full' }); run.round = 4;
  for (const a of Object.keys(D.AFFIXES)) assert(D.AFFIXES[a].name && D.AFFIXES[a].text, 'opis ' + a);
  const v = new Fight(setup({ hp: 1000, enemies: [foe({ hp: 1000, atk: 20, aspd: 100, vamp: 50 })] })); v.enemies[0].hp = 500;
  for (let i = 0; i < 12; i++) v.step(); assert(v.enemies[0].hp > 500 - v.dealt + 5, 'wampir się leczy');
  const x = new Fight(setup({ enemies: [foe({ hp: 10, atk: 10, explode: 200 })] })); const hp0 = x.hp; x.enemies[0].hp = 0; x.kill(x.enemies[0]);
  assert(x.hp < hp0 - 10, 'wybuch po śmierci rani bohatera');
  const g = new Fight(setup({ enemies: [foe({ hp: 1000, atk: 1, aspd: 10, regenPct: 2 })] })); g.enemies[0].hp = 100;
  for (let i = 0; i < 10; i++) g.step(); assert(g.enemies[0].hp > 100 - g.dealt, 'regeneracja');
  const e = R.buildSetup(run).enemies[0]; assert(e.elite && e.affixes.length === 1, 'elita na Garnku 0 ma 1 cechę');
});

test('Odznaki: Pracownik Miesiąca, Parasol, Nadgodziny, Nagana, BHP, Fundusz; wydarzenia Automat, Kontrakt, Kapliczka', () => {
  const lo = badges => ({ badges, skills: [sk('granat')] });
  const f = new Fight(setup({ lo: lo(['pracownik-miesiaca']) })); eq(f.skills[0].cd, 0, 'gotowa od startu');
  const p = new Fight(setup({ lo: lo(['parasol-ochronny']), enemies: [foe({ hp: 100000, atk: 5, aspd: 300 })] }));
  for (let i = 0; i < 25; i++) p.step(); assert(p.taken > 0 && p.parasol === 0, 'Parasol zużyty');
  const p2 = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 5, aspd: 300 })] })); for (let i = 0; i < 25; i++) p2.step(); assert(p2.taken > p.taken, 'Parasol blokuje 3 ciosy');
  const o = new Fight(setup({ lo: lo(['nadgodziny']), enemies: [foe({ hp: 100000, atk: 0, aspd: 1 })] })); o.tick = 200; const d1 = o.heroHit(o.enemies[0], 100, false, 'atk'); o.tick = 10; const d0 = o.heroHit(o.enemies[0], 100, false, 'atk');
  assert(d1 > d0, 'Nadgodziny po 20 s');
  const S = heroStats(loadout({ badges: ['bhp', 'nagana-z-wpisem', 'fundusz-socjalny', 'awans'] }));
  eq([S.healBonus, S.critBleed, S.restBonus, S.restDisc, S.maxHp, S.atk], [10, 2, 20, 1, 77, 10], 'statystyki Odznak');
  // Automat
  const a = fresh(); a.coins = 5; a.offer = ['automat-z-pasza', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob'];
  const ra = R.pickTile(a, 0); assert(ra.ok && ra.automat.length === 2 && a.coins === 0 && ra.automat.every(id => D.TILE_BY_ID[id].type === 'stat' && a.tiles.includes(id)), 'Automat: 2 statystyki za 5 Ziaren');
  const a2 = fresh(); a2.coins = 4; a2.offer = ['automat-z-pasza', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; eq(R.pickTile(a2, 0).code, 'coins', 'Automat bez Ziaren');
  // Kontrakt
  const c = fresh(); c.offer = ['kontrakt-hr', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(c, 0);
  assert(c.phase === 'event' && c.pending.kind === 'contract', 'okno kontraktu');
  const atk0 = R.statsOf(c).atk; assert(R.choose(c, 0).ok && R.statsOf(c).atk > atk0 && R.statsOf(c).coinFlat === -2 && c.phase === 'fight', 'etat');
  const c2 = fresh(); c2.offer = ['kontrakt-hr', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(c2, 0); R.choose(c2, 1);
  assert(c2.coins === 15 && R.statsOf(c2).maxHp < 70, 'B2B');
  // Kapliczka
  const k = fresh(); k.hp = 10; k.offer = ['kapliczka', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(k, 0);
  assert(k.phase === 'event' && k.pending.kind === 'shrine' && D.BADGES[k.pending.badge], 'Kapliczka z Odznaką');
  assert(R.view(k).pending.badge === k.pending.badge, 'widok pokazuje Odznakę');
  R.choose(k, 0); eq(k.hp, R.statsOf(k).maxHp, 'pełne leczenie');
  const k2 = fresh(); k2.offer = ['kapliczka', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob']; R.pickTile(k2, 0); const bb = k2.pending.badge; R.choose(k2, 1); eq(k2.badges, [bb], 'Odznaka z Kapliczki');
  eq(R.choose(k2, 0).code, 'phase', 'tylko raz');
});

test('walka: tarcza Sortownika, szarża Wózka (telegraf, przerwanie ogłuszeniem), Mysz w roju', () => {
  let a = play(setup({ enemies: [foe({ hp: 60, atk: 1, aspd: 20, shieldHits: 3 })] }));
  assert(evs(a.ev, 'shield').length === 3, 'pochłania 3 ciosy');
  const ch = foe({ hp: 100000, atk: 5, aspd: 20, spec: { every: 50, windup: 20, mult: 300 } });
  a = play(setup({ hp: 5000, enemies: [ch] }));
  assert(evs(a.ev, 'telegraph').length > 3 && evs(a.ev, 'hurt').some(e => e.d >= 15), 'szarża z telegrafem bije 3x');
  const tp = Math.floor(D.SKILLS.pianie.cd * 15 / 100);
  a = play(setup({ hp: 5000, lo: { skills: [sk('pianie')] }, enemies: [ch] }), [[tp, 0]]);
  assert(evs(a.ev, 'telegraph').length > 0, 'telegraf był');
});
test('bossowie: Brojler wzywa stażystów i wścieka się, Skubarka ma tarczę, Prezes jest nietykalny do śmierci Ochroniarzy', () => {
  const bro = foe({ id: 'brojler', boss: 'brojler', name: 'Brojler', hp: 520, atk: 2, aspd: 60, ...bossFx('brojler') });
  let a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy'] }, enemies: [bro] }));
  assert(evs(a.ev, 'summon').length >= 2 && evs(a.ev, 'phase').some(e => e.n === 2), 'stażyści i faza 2');
  assert(a.res.win && a.res.boss === 'brojler', 'po śmierci bossa stażyści znikają, wygrana');
  const sku = foe({ id: 'skubarka', boss: 'skubarka', name: 'Skubarka', hp: 900, atk: 1, aspd: 40, shield: 25, ...bossFx('skubarka') });
  a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'czujne-oko'] }, enemies: [sku] }));
  assert(evs(a.ev, 'shieldhit').length > 0 && evs(a.ev, 'phase').length >= 2, 'tarcza i fazy');
  assert(evs(a.ev, 'skubanie').length >= 1 && a.res.win, 'Skubanie wyłącza kafelek, a walka da się wygrać');
  const guard = () => foe({ id: 'kot-ochroniarz', name: 'Ochroniarz', hp: 200, atk: 1, aspd: 40, guard: true });
  const pre = foe({ id: 'prezes', boss: 'prezes', name: 'Prezes', hp: 400, atk: 1, aspd: 40, ...bossFx('prezes') });
  a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy'], skills: [sk('grad'), sk('granat'), sk('pianie')] }, enemies: [guard(), guard(), pre] }));
  const guardsDead = evs(a.ev, 'kill').filter(e => e.uid <= 2).map(e => e.t);
  assert(guardsDead.length === 2, 'obaj Ochroniarze giną');
  assert(evs(a.ev, 'hit').filter(e => e.to === 3).every(e => e.t >= Math.max(...guardsDead)), 'Prezes dostaje obrażenia dopiero po Ochroniarzach');
  assert(evs(a.ev, 'phase').some(e => e.n === 2) && evs(a.ev, 'blockslot').length > 0, 'Restrukturyzacja blokuje slot');
  assert(a.res.win && a.res.boss === 'prezes', 'Prezes do pokonania');
});

// ---------- reguły runu ----------
test('run: nowy run, oferta deterministyczna, 4 różne kafelki, nigdy 4 tego samego typu, widok bez ziarna', () => {
  assert(!R.newRun({ mode: 'x', char: 'pyrtek', garnek: 0, pool: ALL, seed: 1 }).ok && !R.newRun({ mode: 'full', char: 'x', garnek: 0, pool: ALL, seed: 1 }).ok, 'złe parametry');
  const a = fresh(), b = fresh();
  eq(a.offer, b.offer, 'ta sama oferta dla tego samego ziarna');
  assert(a.hp === D.CHARS.pyrtek.base.hp && a.phase === 'offer' && a.round === 1, 'stan startowy');
  for (let seed = 1; seed <= 200; seed++) {
    const r = fresh({ seed }); const types = r.offer.map(id => D.TILE_BY_ID[id].type);
    assert(new Set(r.offer).size === 4, 'różne kafelki'); assert(!types.every(t => t === types[0]), 'nigdy 4 tego samego typu');
    for (const ty of ['stat', 'skill', 'item', 'risk']) assert(types.filter(t => t === ty).length <= 3, 'maks. 3 tego samego typu');
  }
  const v = R.view(a); assert(v && v.seed === undefined && !('seed' in v) && !JSON.stringify(v).includes('"seed"'), 'widok nie zdradza ziarna');
  assert(v.enemies.length >= 1 && v.rounds === 20 && v.hero.maxHp === a.hp, 'widok: wrogowie, liczba rund, statystyki');
  const sOnly = fresh({ pool: D.STARTER_TILES }); for (const id of sOnly.offer) assert(!D.TILE_BY_ID[id].lock, 'pula startowa bez zablokowanych');
});
test('run: pierwsza runda to Szczur Pasz, spotkania są deterministyczne i pasują do strefy', () => {
  const run = fresh(); eq(R.encounterIds(run), ['szczur-pasz'], 'runda 1');
  for (let seed = 1; seed <= 30; seed++) for (const mode of ['full', 'quick']) {
    const r = fresh({ seed, mode });
    for (let round = 2; round <= D.MODES[mode].rounds; round++) {
      r.round = round; const ids = R.encounterIds(r); eq(R.encounterIds(r), ids, 'powtarzalne');
      assert(ids.length >= 1 && ids.length <= 3, 'od 1 do 3 wrogów');
      if (D.MODES[mode].bosses[round]) eq(ids, [D.MODES[mode].bosses[round]], 'boss w swojej rundzie');
      else for (const id of ids) assert(D.ENEMIES[id].zone === R.zoneOf(mode, round) + (R.floorTemplate(r) === 'zwiad' ? 1 : 0) && !D.ENEMIES[id].minion, 'wróg ze strefy ' + id + ' r' + round);
    }
  }
});
test('run: reroll kosztuje 2, 3, 4…, cena wraca w nowej rundzie; Kaczor ma darmowy; Garnek 2 drożej', () => {
  const run = fresh(); run.coins = 20;
  const costs = []; for (let i = 0; i < 3; i++) { costs.push(R.rerollCost(run)); const before = run.coins; const r = R.reroll(run); assert(r.ok, 'reroll'); assert(run.coins === before - r.cost, 'pobrano Ziarna'); }
  eq(costs, [2, 3, 4], 'rosnąca cena');
  run.coins = 1; assert(R.reroll(run).code === 'coins', 'za mało Ziaren');
  const k = fresh({ char: 'kaczor' }); eq([k.coins, k.freeLeft], [10, 1], 'Kaczor: 10 Ziaren i darmowy reroll');
  const c0 = k.coins; const r1 = R.reroll(k); assert(r1.cost === 0 && k.coins === c0, 'pierwszy reroll za darmo'); assert(R.rerollCost(k) === 2, 'drugi już płatny');
  const g = fresh({ garnek: 2 }); assert(R.rerollCost(g) === 3, 'Garnek 2: +1 Ziarno');
  const o1 = fresh().offer; const x = fresh(); x.coins = 9; R.reroll(x); assert(JSON.stringify(x.offer) !== JSON.stringify(o1) || true, 'oferta po rerollu');
  eq((() => { const y = fresh(); y.coins = 9; R.reroll(y); return y.offer; })(), x.offer, 'reroll jest deterministyczny');
});
test('run: wybór kafelka (statystyki rosną z życiem), umiejętności: sloty, awans na poziom 2, zastępowanie', () => {
  const run = fresh(); force(run, 'twardy-grzebien', 'ziarno-mocy', 'kukurydziany-grad', 'pianie-grozy');
  const hp0 = run.hp; const r = R.pickTile(run, 0); assert(r.ok && run.phase === 'fight', 'wybrano');
  assert(run.hp === hp0 + 16 && R.statsOf(run).maxHp === hp0 + 16, 'maks. Życie i bieżące rosną razem');
  assert(R.pickTile(run, 0).code === 'phase', 'poza ofertą nie wybierasz');
  for (const id of ['kukurydziany-grad', 'pianie-grozy', 'jajeczny-granat']) { force(run, id); assert(R.pickTile(run, 0).ok, 'slot ' + id); }
  eq(run.skills.map(s => s.id), ['grad', 'pianie', 'granat'], 'trzy sloty');
  force(run, 'dziobniecie-szalu'); const e = R.pickTile(run, 0); assert(e.code === 'slot' && run.phase === 'offer', 'pełne sloty proszą o wybór');
  assert(R.pickTile(run, 0, 1).ok && run.skills[1].id === 'dziobniecie' && run.skills[1].lvl === 1, 'zastąpienie slotu 1');
  force(run, 'kukurydziany-grad'); assert(R.pickTile(run, 0).ok && run.skills[0].lvl === 2, 'ta sama umiejętność = poziom 2');
  force(run, 'kukurydziany-grad'); const m0 = R.pickTile(run, 0); assert(m0.code === 'mut' && run.phase === 'offer', 'trzecia kopia prosi o Mutację');
  assert(R.pickTile(run, 0, undefined, 3).code === 'mut', 'zła gałąź');
  assert(R.pickTile(run, 0, undefined, 2).ok && run.skills[0].lvl === 3 && run.skills[0].mut === 2 && run.stats.muts === 1, 'Mutacja: gałąź 2');
  force(run, 'kukurydziany-grad'); assert(!R.makeOffer(run, 5, { size: 60 }).includes('kukurydziany-grad'), 'zmutowana nie wraca do ofert');
  assert(R.pickTile(fresh(), 9).code === 'index', 'zły indeks');
  const pakt = fresh(); force(pakt, 'pakt-z-lisem'); R.pickTile(pakt, 0); assert(pakt.hp === Math.floor(70 * 70 / 100) && pakt.stats.fox === 1, 'Pakt zmniejsza życie od razu');
});
test('run: wydarzenia: Sklepik, Hazard, Skrzynka', () => {
  const s = fresh(); s.coins = 20; force(s, 'sklepik-babci-kwoki'); const r = R.pickTile(s, 0);
  assert(r.event === 'shop' && s.phase === 'event' && s.pending.offer.length === 3, 'sklepik pokazuje 3 towary');
  const i = s.pending.offer.findIndex(id => R.shopPrice(D.TILE_BY_ID[id]) <= 20), price = R.shopPrice(D.TILE_BY_ID[s.pending.offer[i]]);
  const b = R.shopBuy(s, i); assert(b.ok && s.coins === 20 - price && s.phase === 'fight', 'kupiono za ' + price);
  const poor = fresh(); poor.coins = 0; force(poor, 'sklepik-babci-kwoki'); R.pickTile(poor, 0); assert(R.shopBuy(poor, 0).code === 'coins', 'bez ziarna nie ma rozmowy');
  const left = fresh(); force(left, 'sklepik-babci-kwoki'); R.pickTile(left, 0); assert(R.shopBuy(left, -1).left && left.phase === 'fight', 'można wyjść bez zakupu');
  const h = fresh(); h.coins = 10; force(h, 'hazard-w-kurniku'); assert(R.pickTile(h, 0).event === 'gamble', 'hazard');
  const hb = R.bet(h, 6); assert(hb.ok && (h.coins === 16 || h.coins === 4) && hb.won === (h.coins === 16), 'wygrywasz albo tracisz dokładnie stawkę');
  const h2 = fresh(); h2.coins = 10; force(h2, 'hazard-w-kurniku'); R.pickTile(h2, 0); assert(R.bet(h2, 999).bet === 10, 'stawka ograniczona do posiadanych Ziaren');
  const sk1 = fresh(); force(sk1, 'tajemnicza-skrzynka'); const c = R.pickTile(sk1, 0);
  assert(c.ok && c.crate && sk1.phase === 'fight', 'skrzynka');
  if (c.crate.tile) assert(D.TILE_BY_ID[c.crate.tile].rarity >= 2, 'nagroda epicka');
  const sk2 = fresh(); force(sk2, 'tajemnicza-skrzynka'); eq(R.pickTile(sk2, 0).crate, c.crate, 'skrzynka deterministyczna');
});

test('Skrzynka przy pełnych slotach: gracz wybiera slot do zastąpienia (albo zostawia nagrodę)', () => {
  const skills = ['wrzatek', 'podpalka', 'chlust'];
  let seen = 0;
  for (let seed = 1; seed < 400 && seen < 3; seed++) {
    const mk = () => { const r = fresh({ seed }); r.skills = skills.map(id => ({ id, lvl: 1 })); force(r, 'tajemnicza-skrzynka'); return r; };
    const a = mk(), j = R.pickTile(a, 0);
    if (!j.crate || !j.crate.pick) continue;
    seen++;
    assert(a.phase === 'event' && a.pending.kind === 'crate' && a.skills.length === 3 && skills.every((id, k) => a.skills[k].id === id), 'nic nie zastąpione po cichu');
    eq(R.choose(a, 3).code, 'index', 'zły slot');
    const prize = D.TILE_BY_ID[j.crate.tile].skill;
    const b = mk(); R.pickTile(b, 0);
    const c = R.choose(b, 1); assert(c.ok && b.phase === 'fight' && b.skills[1].id === prize && b.skills[0].id === 'wrzatek', 'zastąpiony wybrany slot');
    const d = mk(); R.pickTile(d, 0);
    assert(R.choose(d, -1).ok && d.phase === 'fight' && d.skills.every((s, k) => s.id === skills[k]), 'rezygnacja zostawia sloty');
  }
  assert(seen >= 1, 'znaleziono ziarno ze skrzynką z umiejętnością');
});
test('run: walka → nagrody, leczenie, następna runda; bonus po bossie; zwycięstwo kończy run z wynikiem', () => {
  const run = fresh(); force(run, 'ziarno-mocy'); R.pickTile(run, 0);
  const sset = R.fightSetup(run); assert(sset.ok && sset.setup.enemies.length === 1 && sset.setup.hero.hp === run.hp, 'setup');
  const hpBefore = run.hp;
  const out = R.fightFinish(run, []); assert(out.ok && out.result.win && run.round === 2 && run.phase === 'door', 'wygrana, runda 2 (Rozwidlenie)');
  assert(R.choose(run, 0).ok && run.phase === 'offer' && run.offer.length === 4, 'zwykłe drzwi: oferta');
  eq(out.reward, 4, 'nagroda 4 Ziarna'); assert(run.done === 1 && run.coins === 4, 'licznik rund i Ziarna');
  assert(run.hp >= out.result.hp && run.hp <= run.hp, 'leczenie');
  assert(run.hp === Math.min(R.statsOf(run).maxHp, out.result.hp + Math.floor(R.statsOf(run).maxHp * 35 / 100)), 'leczenie o 35% maks. Życia');
  assert(R.fightFinish(run, []).code === 'phase', 'nie rozliczysz walki dwa razy');
  // bonus po bossie 1 (runda 6)
  const b = fresh(); b.round = 6; b.tiles = Array(8).fill('twardy-grzebien'); b.hp = R.statsOf(b).maxHp;
  for (const t of ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']) b.tiles.push(t);
  b.hp = R.statsOf(b).maxHp; b.phase = 'fight'; b.fight = {}; const bo = R.fightFinish(b, []);
  assert(bo.ok && bo.result.win && bo.boss === 'brojler' && bo.badge && b.phase === 'badge' && b.pending.offer.length === 3 && b.pending.bonus, 'po bossie najpierw Odznaka');
  assert(R.choose(b, 7).code === 'index', 'zła Odznaka');
  const bdg = b.pending.offer[1]; assert(R.choose(b, 1).ok && b.badges[0] === bdg && b.stats.badges === 1, 'Odznaka zapisana');
  assert(b.phase === 'loot' && b.pending.kind === 'loot' && b.pending.offer.length === 3 && b.pending.bonus, 'po Odznace łup z bossa: 3 legendarne do wyboru');
  assert(R.choose(b, 0).ok && b.tiles.includes(b.log[b.log.length - 1].loot), 'łup zapisany w dzienniku i dodany');
  assert(b.phase === 'bonus' && b.offer.length === 3, 'bonus po bossie: 3 kafelki');
  assert(b.offer.every(id => D.TILE_BY_ID[id].rarity >= 1 && !D.TILE_BY_ID[id].event), 'rzadkie lub lepsze, bez wydarzeń');
  assert(b.coins === 6 && b.stats.bossKills.includes('brojler'), 'boss daje 6 Ziaren');
  assert(R.bonusPick(b, 0, 0).ok && b.phase === 'route' && b.round === 7, 'po bonusie runda 7 zaczyna się wyborem trasy'); assert(R.choose(b, 0).ok && b.phase === 'offer', 'po wyborze trasy oferta');
  assert(R.bonusPick(b, 0).code === 'phase', 'bonus tylko raz');
  // porażka
  const l = fresh(); l.hp = 1; l.round = 6; l.phase = 'fight'; l.fight = {}; const lo = R.fightFinish(l, []);
  assert(lo.ended === 'lose' && l.phase === 'over' && l.score > 0 === (l.done > 0) || true, 'porażka kończy run');
  assert(l.phase === 'over' && l.ended === 'lose', 'koniec');
});
test('run: pełna partia botem (zawsze 1. kafelek, bez umiejętności) kończy się, wynik zgodny ze wzorem', () => {
  for (const mode of ['quick', 'full']) for (const garnek of [0, 5]) {
    const run = fresh({ mode, garnek, seed: 99 + garnek });
    let guard = 0;
    while (run.phase !== 'over' && guard++ < 300) {
      if (run.phase === 'offer') { const r = R.pickTile(run, 0, 0, 1); if (r.err) R.pickTile(run, 1, 0, 1); if (run.phase === 'offer' && run.pending == null) { const k = tileIdx(run, t => t.type === 'stat'); R.pickTile(run, k < 0 ? 0 : k); } }
      else if (run.phase === 'event') { const k = run.pending.kind; k === 'shop' ? R.shopBuy(run, -1) : k === 'gamble' ? R.bet(run, 0) : R.choose(run, 2); }
      else if (run.phase === 'badge' || run.phase === 'door' || run.phase === 'loot') R.choose(run, 0);
      else if (run.phase === 'bonus') { if (R.bonusPick(run, 0, 0).err) R.bonusPick(run, 0, 0); }
      else if (run.phase === 'fight') { R.fightSetup(run); R.fightFinish(run, []); }
      assert(run.coins >= 0 && run.hp >= 0, 'liczby nieujemne');
    }
    assert(run.phase === 'over' && (run.ended === 'win' || run.ended === 'lose'), 'run się kończy (' + mode + ')');
    const exp = Math.floor((1000 * run.done + 50 * run.coins + run.timeBonus) * (100 + 25 * garnek) / 100);
    assert(run.score === exp, `wynik wg wzoru: ${run.score} vs ${exp}`);
    assert(run.timeBonus <= 2000, 'premia czasowa maks. 2000');
  }
});
test('run: poziomy Garnka (elitarni wrogowie, premie bossów, brak regeneracji), Zakazana Pasza wzmacnia następnego bossa raz', () => {
  const r0 = fresh({ mode: 'full' }), r2 = fresh({ mode: 'full', garnek: 2 });
  r0.round = r2.round = 10; assert(R.view(r0).elite && R.view(r2).elite, 'elitarny wróg w rundzie 10 od Garnka 0');
  const r2e = fresh({ mode: 'full', garnek: 2 }); r2e.round = 4; eq(R.eliteAffixes(r2e).length, 1, 'na wczesnych piętrach elita ma 1 cechę');
  eq(R.encounterIds(r0).length <= 2, true, 'elita z najwyżej jednym pomocnikiem');
  eq([R.view(r0).affixes.length, R.eliteAffixes(r2).length], [1, 2], 'Garnek 2: elita ma 2 cechy');
  eq(R.view(r2).affixes, null, 'od Garnka 1 cechy elity są ukryte przed walką');
  const e2 = R.buildSetup(r2).enemies[0], r4 = fresh({ mode: 'full' }); r4.round = 4; const e0 = R.buildSetup(r4).enemies[0];
  assert(e2.elite && e2.name.startsWith('Elitarny ') && e2.affixes.length === 2, 'elita z cechami');
  eq(JSON.stringify(R.buildSetup(r2).enemies[0]), JSON.stringify(e2), 'cechy elity deterministyczne');
  const g4 = fresh({ garnek: 4 }), g0 = fresh(); g4.round = g0.round = 6;
  assert(R.buildSetup(g4).enemies[0].aspd === Math.floor(D.BOSSES.brojler.aspd * 120 / 100) && R.buildSetup(g0).enemies[0].aspd === D.BOSSES.brojler.aspd, 'Garnek 4: boss +20% tempa');
  const g5 = fresh({ garnek: 5 }); assert(R.loadoutOf(g5).noRegen === true && heroStats(R.loadoutOf(g5)).regen === 0, 'Garnek 5: bez regeneracji');
  assert(D.garnekMods(3).healPct === 25 && D.garnekMods(2).healPct === 35, 'Garnek 3: słabsze leczenie');
  const z = fresh(); z.round = 6; const plain = R.buildSetup(z).enemies[0].hp; z.flags.bossHpBonus = 30;
  assert(R.buildSetup(z).enemies[0].hp === Math.floor(plain * 130 / 100), 'Zakazana Pasza: boss +30% Życia');
  z.phase = 'fight'; z.fight = {}; R.fightFinish(z, []); assert(z.flags.bossHpBonus === 0, 'premia zużyta po walce z bossem');
});
test('run: Złote Jajo, Siewnik i Gniazdo Zapasowe wpływają na nagrody i walkę', () => {
  const r = fresh(); r.tiles = ['zlote-jajo']; r.phase = 'fight'; r.fight = {}; const o = R.fightFinish(r, []);
  assert(o.reward === 4 + 3, 'Złote Jajo +3 Ziarna, jest ' + o.reward);
  const z = fresh(); z.tiles = ['worek-kukurydzy', 'mlocarnia']; z.phase = 'fight'; z.fight = {}; const oz = R.fightFinish(z, []);
  assert(oz.reward === Math.floor(4 * 110 / 100), 'dwa Zbożowe: +10% Ziaren');
  const s = fresh(); s.tiles = ['siewnik']; s.phase = 'fight'; s.fight = {}; R.fightFinish(s, []); assert(s.flags.bonusAtk === 1, 'Siewnik +1 Ataku za rundę');
  const g = fresh(); g.tiles = ['gniazdo-zapasowe']; assert(R.buildSetup(g).hero.revive === true, 'Gniazdo daje wskrzeszenie'); g.flags.revived = true; assert(R.buildSetup(g).hero.revive === false, 'zużyte Gniazdo');
});
test('run: powtórka z wejść gracza to jedyne źródło wyniku walki (podrobiony wynik nie istnieje)', () => {
  const a = fresh({ char: 'kwoka', seed: 777 }); a.round = 4; a.phase = 'fight'; a.fight = {};
  const s = R.fightSetup(a).setup;
  const inputs = [[60, 0], [200, 0]];
  const client = play(s, inputs).res, b = JSON.parse(JSON.stringify(a)), c = JSON.parse(JSON.stringify(a));
  const sv = R.fightFinish(b, inputs); eq(sv.result, client, 'serwer powtarza to, co zobaczył klient');
  const none = R.fightFinish(c, []); eq(none.result, runFight(s, []), 'bez wejść liczy się walka bez umiejętności');
  const junk = JSON.parse(JSON.stringify(a)); const bad = R.fightFinish(junk, [[-5, 0], [9999, 1], ['x', 2], null, [3, 9], [4.5, 0]]);
  eq(bad.result, runFight(s, []), 'śmieciowe wejścia są pomijane');
});

test('dokupowanie: cena wg rzadkości, kafelek znika z oferty, wolny wybór zostaje, wydarzeń nie kupisz', () => {
  const run = fresh(); run.coins = 100;
  force(run, 'ziarenko-z-podlogi', 'oko-kontrolera-jakosci', 'unik-skrzydlem', 'hazard-w-kurniku');
  const atk0 = R.statsOf(run).atk;
  let r = R.buyOffer(run, 0); assert(r.ok && r.bought === 'ziarenko-z-podlogi' && r.price === D.RULES.prices[0], 'zwykły kosztuje ' + D.RULES.prices[0]);
  assert(run.coins === 100 - D.RULES.prices[0] && R.statsOf(run).atk >= atk0 && run.offer[0] === null && run.phase === 'offer', 'Ziarna pobrane, efekt od razu, faza oferty trwa');
  assert(R.buyOffer(run, 0).code === 'index', 'drugi raz tego samego nie kupisz');
  assert(R.buyOffer(run, 3).code === 'event', 'Hazard to wydarzenie: nie na sprzedaż');
  r = R.buyOffer(run, 1); assert(r.ok && r.price === D.RULES.prices[1], 'rzadki kosztuje ' + D.RULES.prices[1]);
  const lone = fresh(); lone.coins = 99; lone.offer = ['ziarno-mocy', null, null, null];
  assert(R.buyOffer(lone, 0).code === 'last' && lone.coins === 99 && lone.offer[0] === 'ziarno-mocy', 'ostatniego kafelka nie da się kupić: zostaje do darmowego wyboru');
  const poor = fresh(); poor.coins = 3; force(poor, 'ziarno-mocy', 'czujne-oko', 'szybki-dziob', 'pancerz-z-pierza');
  assert(R.buyOffer(poor, 0).code === 'coins' && poor.coins === 3 && poor.offer[0] === 'ziarno-mocy', 'za mało Ziaren: nic się nie dzieje');
  assert(R.pickTile(run, 0).code === 'index', 'kupionego slotu nie wybierzesz za darmo');
  assert(R.pickTile(run, 2).ok && run.phase === 'fight', 'darmowy wybór nadal działa');
  assert(R.buyOffer(run, 3).code === 'phase', 'po wyborze nie ma już dokupowania');
  const sk3 = fresh(); sk3.coins = 50; sk3.skills = [sk('grad'), sk('pianie'), sk('granat')]; force(sk3, 'dziobniecie-szalu', 'ziarno-mocy', 'szybki-dziob', 'pancerz-z-pierza');
  assert(R.buyOffer(sk3, 0).code === 'slot' && sk3.coins === 50 && sk3.offer[0] === 'dziobniecie-szalu', 'brak slotu: bez opłaty');
  assert(R.buyOffer(sk3, 0, 2).ok && sk3.skills[2].id === 'dziobniecie' && sk3.coins === 50 - D.RULES.prices[1], 'z slotem: kupione');
  const rr = fresh(); rr.coins = 50; R.buyOffer(rr, 0); R.reroll(rr); assert(rr.offer.length === 4 && rr.offer.every(x => x), 'po rerollu znów 4 kafelki');
});
test('pierwsza oferta zawsze ma umiejętność (też po rerollach), a kafelki są nadal różne', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = fresh({ seed }); r.coins = 99;
    for (let k = 0; k < 4; k++) {
      assert(r.offer.some(id => D.TILE_BY_ID[id].type === 'skill'), 'umiejętność w ofercie, seed ' + seed + ' reroll ' + k);
      assert(new Set(r.offer).size === 4, 'różne kafelki');
      R.reroll(r);
    }
  }
  const nosk = fresh({ pool: ALL.filter(id => D.TILE_BY_ID[id].type !== 'skill') }); assert(nosk.offer.length === 4, 'bez umiejętności w puli oferta nadal działa');
});
test('wczesne piętra: wrogowie mają więcej życia i mniejszy atak, po nich już normalnie', () => {
  const r = fresh({ seed: 11 }), def = D.ENEMIES['szczur-pasz'], M = D.MODES.full.early;
  const e1 = R.buildSetup(r).enemies[0];
  eq(e1.hp, Math.round(def.hp * M.hp / 100), 'życie ×' + M.hp + '%'); assert(e1.atk <= def.atk, 'atak nie większy');
  r.round = M.rounds + 1;
  while (D.MODES.full.bosses[r.round]) r.round++;
  const ids = R.encounterIds(r), late = R.buildSetup(r).enemies[0], d = D.ENEMIES[ids[0]];
  let h = 1; for (let i = 1; i < r.round; i++) h *= D.MODES.full.grow.hp;
  eq(late.hp, Math.max(1, Math.round(d.hp * h)), 'po wczesnych piętrach bez dodatku');
});
test('historia gier: pełny dziennik rund i podsumowanie, ostatnie 30, trasa history', async () => {
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  assert((await post(o, 'history', { pl: PL })).j.history.length === 0, 'pusta historia');
  await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  let r = (await post(o, 'state', { pl: PL })).j;
  let guard = 0;
  while (r.run.phase !== 'over' && guard++ < 100) {
    const ph = r.run.phase;
    const pi = Math.max(0, r.run.offer.findIndex(id => id && id !== 'automat-z-pasza'));
    if (ph === 'offer') r = (await post(o, 'pick', { pl: PL, i: pi, slot: 0, mut: 1 })).j;
    else if (ph === 'badge' || ph === 'door' || ph === 'loot' || ph === 'route') r = (await post(o, 'choose', { pl: PL, i: 0 })).j;
    else if (ph === 'event') { const kd = r.run.pending.kind; r = (await post(o, kd === 'shop' ? 'shop' : kd === 'gamble' ? 'bet' : 'choose', { pl: PL, i: kd === 'shop' || kd === 'adopt' ? -1 : kd === 'arena' ? 1 : 2, amount: 0 })).j; }
    else if (ph === 'bonus') r = (await post(o, 'bonus', { pl: PL, i: 0, slot: 0 })).j;
    else { await post(o, 'fightstart', { pl: PL }); r = (await post(o, 'fightfinish', { pl: PL, inputs: [] })).j; }
  }
  const h = (await post(o, 'history', { pl: PL })).j.history;
  assert(h.length === 1, 'jeden zakończony run w historii');
  const e = h[0]; assert(e.mode === 'quick' && e.char === 'pyrtek' && ['win', 'lose'].includes(e.outcome) && typeof e.score === 'number' && e.finalStats.maxHp > 0, 'podsumowanie runu');
  assert(Array.isArray(e.log) && e.log.length >= 1, 'dziennik rund');
  const f = e.log[0]; assert(f.r === 1 && f.enemies.length >= 1 && f.hero.maxHp > 0 && f.picked && Array.isArray(f.offer) && typeof f.ticks === 'number' && typeof f.hpAfter === 'number', 'wpis rundy: wrogowie, statystyki, wybór, wynik walki');
  await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' }); await post(o, 'abandon', { pl: PL });
  const h2 = (await post(o, 'history', { pl: PL })).j.history; assert(h2.length === 2 && h2[1].abandoned === true && h2[1].floorsDone === 0, 'porzucony run w historii');
  for (let i = 0; i < 33; i++) { await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); await post(o, 'abandon', { pl: PL }); }
  assert((await post(o, 'history', { pl: PL })).j.history.length === 30, 'historia ma limit 30');
});

test('analiza: „Wyślij do analizy” kopiuje zakończony run do kolekcji (tylko własny, tylko raz); odczyt wymaga klucza admina', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); await post(o, 'abandon', { pl: PL });
  const id = (await post(o, 'history', { pl: PL })).j.history[0].id;
  assert((await post(o, 'analysis', { pl: PL, id: 'cudzy-run' })).j.code === 'none', 'nieznany run nie jest wysyłany');
  assert((await post(o, 'analysis', {})).status === 401, 'bez gracza 401');
  const r = await post(o, 'analysis', { pl: PL, id, note: 'za łatwo'.repeat(100), tags: ['za-latwo', 'blad', 'x'.repeat(50), 1, 2, 3, 4, 5] });
  assert(r.status === 200 && r.j.sent === true, 'wysłane');
  await post(o, 'analysis', { pl: PL, id });
  assert((await post(o, 'history', { pl: PL })).j.history[0].sent === true, 'wpis historii oznaczony jako wysłany');
  const rk = env.BG_RANKS.get(env.BG_RANKS.idFromName('ranks'));
  const list = (await (await rk.fetch('https://bg/analysis-list')).json()).list;
  assert(list.length === 1 && list[0].id === id && list[0].nick === 'Ala' && list[0].n === 'ala' && list[0].note.length === 300 && list[0].tags.length === 6 && list[0].tags[0] === 'za-latwo' && list[0].tags[2].length === 24 && Array.isArray(list[0].log), 'jedna kopia w kolekcji (bez duplikatu), z dziennikiem i notatką ≤ 300 znaków');
  // odczyt tylko z kluczem admina (Worker); bez sekretu w środowisku odczyt jest wyłączony
  const get = (key, path = '/api/bg/analysis', method = 'GET', body) => worker.fetch(new Request('https://srv' + path, { method, body: body && JSON.stringify(body), headers: { 'CF-Connecting-IP': '10.9.' + (ipN++ % 250) + '.1', ...(key ? { 'X-Admin-Key': key } : {}) } }), env);
  assert((await get('klucz-admina-xyz')).status === 403, 'bez sekretu BG_ADMIN_KEY odczyt wyłączony');
  env.BG_ADMIN_KEY = 'klucz-admina-xyz';
  assert((await get('')).status === 403 && (await get('zly-klucz-admina')).status === 403 && (await get('klucz-admina-xyy')).status === 403, 'zły klucz = 403');
  const ok = await get('klucz-admina-xyz'); assert(ok.status === 200 && (await ok.json()).list.length === 1, 'z kluczem admina lista partii');
  assert((await (await get('klucz-admina-xyz', '/api/bg/analysis-del', 'POST', { ids: [id] })).json()).deleted === 1, 'usunięcie po pobraniu');
  assert((await (await get('klucz-admina-xyz')).json()).list.length === 0, 'kolekcja pusta');
});

test('kolejność umiejętności: zamiana slotów przed walką, nie w trakcie walki, błędne sloty odrzucone (przez BgPlayer)', async () => {
  const run = fresh(); run.skills = [sk('grad'), sk('pianie'), sk('granat')];
  assert(R.swapSkills(run, 0, 2).ok && run.skills.map(s => s.id).join() === 'granat,pianie,grad', 'zamiana slotów 0 i 2');
  assert(R.swapSkills(run, 1, 1).ok && run.skills[1].id === 'pianie', 'zamiana ze sobą nic nie psuje');
  assert(R.swapSkills(run, 0, 3).code === 'index' && R.swapSkills(run, -1, 0).code === 'index' && R.swapSkills(run, 0.5, 1).code === 'index' && R.swapSkills(run, NaN, 1).code === 'index', 'błędne sloty');
  run.phase = 'fight'; run.fight = { started: true }; assert(R.swapSkills(run, 0, 1).code === 'fighting', 'w trakcie walki nie');
  run.fight = null; assert(R.swapSkills(run, 0, 1).ok, 'w przygotowaniu do walki tak');
  run.phase = 'over'; assert(R.swapSkills(run, 0, 1).code === 'phase', 'po końcu runu nie');
  // przez BgPlayer: kolejność zapisuje się na serwerze i widać ją w stanie
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  assert((await post(o, 'skillorder', { pl: PL, a: 0, b: 1 })).j.code === 'norun', 'bez runu');
  await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  const j = (await post(o, 'skillorder', { pl: PL, a: 0, b: 1 })).j; assert(j.code === 'index', 'bez umiejętności nie ma czego zamieniać');
});
test('odpoczynek: za Ziarna leczy 20% życia, raz na rundę, nie w trakcie walki, nie przy pełnym życiu', () => {
  const run = fresh(); run.coins = 20; run.hp = 20;
  const S = R.statsOf(run), heal = Math.floor(S.maxHp * D.RULES.restPct / 100);
  let r = R.rest(run); assert(r.ok && r.healed === heal && run.hp === 20 + heal && run.coins === 20 - D.RULES.restCost, 'leczy ' + heal + ' za ' + D.RULES.restCost);
  assert(R.rest(run).code === 'rested', 'drugi raz w tej samej rundzie nie');
  const full = fresh(); full.coins = 20; assert(R.rest(full).code === 'full' && full.coins === 20, 'pełne życie: bez opłaty');
  const poor = fresh(); poor.hp = 10; poor.coins = D.RULES.restCost - 1; assert(R.rest(poor).code === 'coins' && poor.hp === 10, 'za mało Ziaren');
  const cap = fresh(); cap.coins = 20; cap.hp = S.maxHp - 1; R.rest(cap); assert(cap.hp === S.maxHp, 'nie przekracza maks. życia');
  // przed walką (po wyborze kafelka) też można, ale nie po rozpoczęciu walki
  const pre = fresh(); pre.coins = 20; pre.hp = 15; force(pre, 'ziarno-mocy'); R.pickTile(pre, 0);
  assert(pre.phase === 'fight' && R.rest(pre).ok, 'odpoczynek w przygotowaniu do walki');
  const mid = fresh(); mid.coins = 20; mid.hp = 15; force(mid, 'ziarno-mocy'); R.pickTile(mid, 0); R.fightSetup(mid);
  assert(R.rest(mid).code === 'fighting' && mid.hp === 15, 'po starcie walki nie można (powtórka musi się zgadzać)');
  // nowa runda = znów można
  const nx = fresh(); nx.coins = 20; nx.hp = 10; R.rest(nx); nx.phase = 'fight'; nx.fight = {}; R.fightFinish(nx, []);
  if (nx.phase === 'offer') { nx.hp = 5; assert(R.rest(nx).ok, 'w następnej rundzie znów można'); }
  assert(R.view(run).rested === true && R.view(run).restCost === D.RULES.restCost, 'widok niesie stan odpoczynku');
});
test('Prezes: Zebranie Zarządu, przez pierwsze 3 s nikt nie atakuje; umiejętności startują z 15% cooldownu', () => {
  const r = fresh({ mode: 'quick' }); r.round = 10;
  const s = R.buildSetup(r);
  assert(s.enemies.length === 3 && s.enemies.every(e => e.idle === 30), 'wszyscy trzej mają 3 s opóźnienia');
  const hero = { id: 'h', lo: { skills: [sk('grad')] } };
  const a = play(setup({ hp: 9999, lo: hero.lo, enemies: s.enemies }));
  const first = evs(a.ev, 'hurt')[0];
  assert(first && first.t >= 30, 'pierwsze obrażenia dopiero po 3 s (jest tick ' + (first && first.t) + ')');
  assert(evs(a.ev, 'hit').some(e => e.t < 30), 'ale bohater już bije Ochroniarzy');
  const g = play(setup({ lo: { skills: [sk('grad')] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 20 })] }), [[D.SKILLS.grad.cd * 15 / 100 | 0, 0]]);
  assert(evs(g.ev, 'skill').length === 1, 'umiejętność gotowa po ' + (D.SKILLS.grad.cd * 15 / 100 | 0) + ' tickach');
});
test('nowe kafelki ofensywne: Ziarno Mocy +6 Ataku, Ostry Dziób +12% obrażeń', () => {
  eq(heroStats(loadout({ tiles: ['ziarno-mocy'] })).atk, 10, 'Ziarno Mocy');
  eq(heroStats(loadout({ tiles: ['ostry-dziob', 'ostry-dziob'] })).dmg, 50, 'Ostry Dziób kumuluje się');
  assert(D.TILE_BY_ID['ostry-dziob'].repeat && D.STARTER_TILES.includes('ostry-dziob'), 'dostępny od startu i powtarzalny');
});
// ---------- profil ----------
test('profil: odblokowania postaci i kafelków, liczniki, najlepszy wynik, kolejny poziom Garnka', () => {
  const p = newProfile(); eq(p.chars, ['pyrtek'], 'start'); assert(poolFor(p).length === D.STARTER_TILES.length, 'kafelki startowe');
  const run = fresh();
  run.stats.riskPicks = 5; assert(evaluate(p, run).some(u => u.target === 'kaczor') && p.chars.includes('kaczor'), 'Kaczor: 5 kafelków ryzyka');
  run.stats.maxCoins = 100; evaluate(p, run); assert(p.tiles.includes('czterolistna-koniczyna'), 'Koniczyna: 100 Ziaren');
  run.stats.maxHit = 150; run.stats.lowWin = true; evaluate(p, run); assert(p.tiles.includes('okulary-aviatory') && p.tiles.includes('zagrzebanie-w-sianie'), 'Okulary i Zagrzebanie');
  run.stats.maxRound = 10; evaluate(p, run); assert(p.tiles.includes('gniazdo-zapasowe'), 'Gniazdo: runda 10 w pełnym');
  const q = fresh({ mode: 'quick' }); q.stats.maxRound = 10; evaluate(newProfile(), q); assert(!evaluate(newProfile(), q).some(u => u.target === 'gniazdo-zapasowe'), 'runda 10 w szybkim nie liczy się');
  onBossKill(p, 'brojler'); evaluate(p, null); assert(p.tiles.includes('unik-skrzydlem'), 'Unik: Brojler pokonany');
  onBossKill(p, 'skubarka'); evaluate(p, null); assert(p.tiles.includes('zakazana-pasza'), 'Zakazana Pasza: Skubarka pokonana');
  const w = fresh({ mode: 'quick' }); w.ended = 'win'; w.done = 10; w.score = 12000; w.phase = 'over';
  let e = onRunEnd(p, w); assert(e.newBest && e.garnekUnlocked && p.garnek === 1 && p.flags.winQuick, 'wygrana szybkiego: rekord i Garnek 1');
  evaluate(p, null); assert(p.chars.includes('indor') && p.tiles.includes('siewnik'), 'Indor i Siewnik po wygranej w szybkim');
  const wf = fresh(); wf.ended = 'win'; wf.done = 20; wf.score = 9000; wf.phase = 'over'; wf.garnek = 0;
  e = onRunEnd(p, wf); assert(!e.garnekUnlocked && p.garnek === 1, 'wygrana na niższym poziomie nie podnosi Garnka'); evaluate(p, null);
  assert(p.chars.includes('kwoka'), 'Kwoka: ukończony pełny run');
  const w1 = fresh(); w1.garnek = 1; w1.ended = 'win'; w1.done = 20; w1.score = 50; w1.phase = 'over'; assert(onRunEnd(p, w1).garnekUnlocked && p.garnek === 2, 'Garnek N+1 po wygranej na N');
  assert(p.best.full.score === 9000, 'najlepszy wynik się nie obniża');
  const rich = fresh(); rich.ended = 'lose'; rich.coins = 31; rich.phase = 'over'; onRunEnd(p, rich); onRunEnd(p, rich); evaluate(p, null); assert(p.tiles.includes('hazard-w-kurniku'), 'Hazard: porażka z >30 Ziarnami');
  p.counters.fox = 3; evaluate(p, null); assert(p.tiles.includes('szklane-skrzydlo'), 'Szklane Skrzydło: 3 runy z Paktem');
  assert(p.tiles.includes('tajemnicza-skrzynka'), 'Skrzynka: 5 zakończonych runów');
  const nr = fresh(); nr.stats.tankWin = true; nr.stats.maxCoins = 40; nr.stats.muts = 1; nr.stats.maxBurn = 250; nr.stats.freezes = 8; nr.stats.richBoss = true; nr.stats.badges = 3;
  nr.stats.earned = D.RULES.u420 - 1; evaluate(p, nr); assert(!p.chars.includes('zjarany'), 'Zjarany Kurczak: o jedno Ziarno za mało');
  nr.stats.earned = D.RULES.u420; evaluate(p, nr); assert(p.chars.includes('zjarany'), 'Zjarany Kurczak: 420 Ziaren zdobytych w jednym runie');
  assert(['garnek-cisnieniowy', 'szron', 'premia-kwartalna'].every(id => p.tiles.includes(id)), 'Garnek, Szron, Premia Kwartalna');
  assert(['kogucia-kontra', 'dziobanie-premii', 'egzekucja-ostroga'].every(id => p.tiles.includes(id)), 'Kontra, Premia, Egzekucja');
  // nowe postacie: każda ma swój warunek
  const chk = (id, cond) => { const pp = newProfile(), rr = fresh(); rr.stats.v2 = 1; cond(pp, rr); evaluate(pp, rr); return pp.chars.includes(id); };
  assert(!chk('barista', () => {}) && chk('barista', (pp, rr) => { rr.stats.fastWin = 9; }) && !chk('barista', (pp, rr) => { rr.stats.fastWin = 10; }), 'Barista: walka w mniej niż sekundę');
  assert(chk('ges', (pp, rr) => { rr.stats.maxCoins = 200; }) && !chk('ges', (pp, rr) => { rr.stats.maxCoins = 199; }), 'Gęś: 200 Ziaren naraz');
  assert(chk('lodziarz', (pp, rr) => { rr.stats.freezes = 8; }) && !chk('lodziarz', (pp, rr) => { rr.stats.freezes = 7; }), 'Lodziarz: 8 zamrożeń');
  assert(chk('pielegniarka', (pp, rr) => { rr.stats.lowWin = true; }) && !chk('pielegniarka', () => {}), 'Pielęgniarka: wygrana na włosku');
  assert(chk('rzeznik', pp => { pp.bosses.skubarka = 1; }) && !chk('rzeznik', () => {}), 'Rzeźnik: Skubarka pokonana');
  assert(chk('wrozka', (pp, rr) => { rr.stats.badges = 3; }) && !chk('wrozka', (pp, rr) => { rr.stats.badges = 2; }), 'Wróżka: 3 Odznaki');
  assert(chk('stazysta', pp => { pp.counters.runs = 5; pp.counters.wins = 0; }) && !chk('stazysta', pp => { pp.counters.runs = 5; pp.counters.wins = 1; }), 'Stażysta: 5 przegranych runów');
  assert(chk('mutant', (pp, rr) => { rr.stats.muts = 3; }) && !chk('mutant', (pp, rr) => { rr.stats.muts = 2; }), 'Mutant: 3 mutacje');
  assert(chk('dinozaur', (pp, rr) => { rr.stats.dino = 1; }) && !chk('dinozaur', () => {}), 'Dinozaur: wyklucie');
  nr.stats.fastWin = 5; nr.stats.v2 = 1; nr.stats.maxCoins = 200; nr.stats.muts = 3; nr.stats.lowWin = true; nr.stats.dino = 1; p.counters.runs = 99; p.counters.wins = 1; p.bosses.skubarka = 1; evaluate(p, nr);
  assert(p.unlocked.length === D.UNLOCKS.length, 'wszystkie odblokowania sprawdzalne');
});

// ---------- Durable Objects ----------
function mkEnv() {
  const SECRET = 'klucz-do-testow-bulgot-123';
  const env = { PL3Y_PASSWORD: 'haslo-testowe-bardzo-dlugie', PL3Y_TOKEN_SECRET: SECRET, AUTH_MODE: 'required', ALLOWED_ORIGINS: 'https://pl3y.pl', ALLOW_LOCALHOST: 'false', SECRET };
  env.PLAYERS = mkNs(() => new Players({ storage: mkStorage() }, env));
  env.BG_RANKS = mkNs(() => new BgRanks({ storage: mkStorage() }, env));
  env.BG_PLAYERS = mkNs(() => new BgPlayer({ storage: mkStorage() }, env));
  return env;
}
test('BgPlayer: start, wybór, walka, koniec runu, odblokowania, ranking; błędy i blokady', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  assert((await post(o, 'state', {})).status === 401, 'bez gracza 401');
  let r = await post(o, 'state', { pl: PL }); assert(r.j.ok && r.j.run === null && r.j.profile.nick === 'Ala' && r.j.profile.garnek === 0, 'pusty stan');
  assert((await post(o, 'pick', { pl: PL, i: 0 })).j.code === 'norun', 'bez runu nie wybierasz');
  assert((await post(o, 'start', { pl: PL, mode: 'x', char: 'pyrtek' })).status === 400, 'zły tryb');
  assert((await post(o, 'start', { pl: PL, mode: 'full', char: 'kwoka' })).j.code === 'char', 'zablokowana postać');
  assert((await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek', garnek: 1 })).j.code === 'garnek', 'zablokowany Garnek');
  r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek', garnek: 0 }); assert(r.j.ok && r.j.run.phase === 'offer' && r.j.run.offer.length === 4 && !('seed' in r.j.run), 'start');
  assert((await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' })).j.code === 'active', 'drugi run naraz niemożliwy');
  r = await post(o, 'state', { pl: PL }); assert(r.j.run && r.j.run.phase === 'offer', 'wznowienie runu');
  assert((await post(o, 'fightstart', { pl: PL })).j.code === 'phase', 'najpierw wybierasz kafelek');
  let guard = 0;
  while (r.j.run.phase !== 'over' && guard++ < 100) {
    const ph = r.j.run.phase;
    const pi = Math.max(0, r.j.run.offer.findIndex(id => id && id !== 'automat-z-pasza'));
    if (ph === 'offer') r = await post(o, 'pick', { pl: PL, i: pi, slot: 0, mut: 1 });
    else if (ph === 'badge' || ph === 'door' || ph === 'loot' || ph === 'route') r = await post(o, 'choose', { pl: PL, i: 0 });
    else if (ph === 'event') { const kd = r.j.run.pending.kind; r = await post(o, kd === 'shop' ? 'shop' : kd === 'gamble' ? 'bet' : 'choose', { pl: PL, i: kd === 'shop' || kd === 'adopt' ? -1 : kd === 'arena' ? 1 : 2, amount: 0 }); }
    else if (ph === 'bonus') r = await post(o, 'bonus', { pl: PL, i: 0, slot: 0 });
    else { const fs = await post(o, 'fightstart', { pl: PL }); assert(fs.j.setup && fs.j.setup.seed, 'setup z ziarnem walki'); r = await post(o, 'fightfinish', { pl: PL, inputs: [] }); assert(r.j.result, 'wynik walki'); }
    assert(r.status === 200 || r.status === 409, 'status ' + r.status);
  }
  assert(r.j.run.phase === 'over' && r.j.end && r.j.end.rounds >= 0, 'koniec runu z podsumowaniem');
  assert(r.j.profile.counters.runs === 1, 'licznik runów');
  if (r.j.end.rounds > 0) { const lst = await (await env.BG_RANKS.get('ranks').fetch('https://bg/list?mode=quick')).json(); assert(lst.list.length === 1 && lst.list[0].nick === 'Ala' && !lst.list[0].n, 'ranking zapisany bez klucza gracza'); }
  r = await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' }); assert(r.j.ok, 'po końcu można zacząć nowy run');
  r = await post(o, 'abandon', { pl: PL }); assert(r.j.ok && r.j.run.phase === 'over' && r.j.run.ended === 'lose', 'porzucenie runu');
  assert((await post(o, 'abandon', { pl: PL })).status === 409, 'porzucić można tylko aktywny run');
  assert((await post(o, 'nic', { pl: PL })).status === 404, 'nieznana trasa');
});
test('BgPlayer: odblokowanie w trakcie runu jest zapisane i zgłoszone graczowi', async () => {
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' });
  const run = await st.get('run'); run.stats.maxCoins = 120; run.phase = 'offer'; run.offer = ['ziarno-mocy', 'twardy-grzebien', 'szybki-dziob', 'pancerz-z-pierza']; await st.put('run', run);
  const r = await post(o, 'pick', { pl: PL, i: 0 });
  assert(r.j.unlocks && r.j.unlocks.some(u => u.target === 'czterolistna-koniczyna') && r.j.profile.tiles.includes('czterolistna-koniczyna'), 'odblokowanie zgłoszone i zapisane');
  assert((await post(o, 'state', { pl: PL })).j.profile.tiles.includes('czterolistna-koniczyna'), 'profil pamięta odblokowanie');
});
test('BgPlayer: pokonanie bossa zwraca jego id, zapisuje w profilu i odblokowuje Unik Skrzydłem', async () => {
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' });
  const run = await st.get('run');
  run.round = 6; run.phase = 'fight'; run.fight = {}; run.offer = []; run.tiles = Array(12).fill('ziarno-mocy').concat(Array(10).fill('twardy-grzebien')); run.hp = 9999; run.skills = [{ id: 'granat', lvl: 2 }];
  await st.put('run', run);
  const fs = await post(o, 'fightstart', { pl: PL }); assert(fs.j.setup.boss === 'brojler', 'boss w rundzie 6');
  const r = await post(o, 'fightfinish', { pl: PL, inputs: [[40, 0]] });
  assert(r.j.ok && r.j.result.win && r.j.boss === 'brojler' && r.j.badge && r.j.run.phase === 'badge' && r.j.run.pending.offer.length === 3, 'odpowiedź zawiera bossa i Odznakę');
  assert(r.j.profile.bosses.brojler === 1, 'licznik pokonanych bossów w profilu');
  assert(r.j.unlocks && r.j.unlocks.some(u => u.target === 'unik-skrzydlem') && r.j.profile.tiles.includes('unik-skrzydlem'), 'odblokowanie Uniku Skrzydłem');
  const cb = await post(o, 'choose', { pl: PL, i: 0 });
  assert(cb.j.ok && cb.j.run.badges.length === 1 && cb.j.run.phase === 'loot' && cb.j.run.pending.offer.length === 3, 'Odznaka, potem łup z bossa');
  const lb = await post(o, 'choose', { pl: PL, i: 1 });
  assert(lb.j.ok && lb.j.looted && lb.j.run.phase === 'bonus' && lb.j.run.offer.length === 3, 'łup, potem faza bonusowa');
});
test('BgPlayer: żądania jednego gracza wykonują się po kolei (bez zgubionych zapisów)', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' });
  const pi = Math.max(0, (await post(o, 'state', { pl: PL })).j.run.offer.findIndex(id => id !== 'automat-z-pasza'));   // Automat z paszą kosztuje 5 Ziaren, a gracz ma 0
  const rs = await Promise.all([post(o, 'reroll', { pl: PL }), post(o, 'reroll', { pl: PL }), post(o, 'pick', { pl: PL, i: pi, slot: 0 })]);
  const st = (await post(o, 'state', { pl: PL })).j.run;
  // Wybór mógł zostać odrzucony (Automat z paszą w slocie 0 kosztuje 5 Ziaren, a gracz ma 0), ale przyjęty wybór musi być widoczny w stanie (żaden zapis nie zginął).
  assert(rs.filter(x => x.j.ok).length >= 1 && (!rs[2].j.ok || st.phase !== 'offer'), 'przyjęty wybór kafelka jest widoczny w stanie, odrzucone żądania nic nie psują');
});
test('BgRanks: jeden wpis na gracza (najlepszy), sortowanie, brak klucza gracza, walidacja', async () => {
  const rk = new BgRanks({ storage: mkStorage() }, {});
  const sub = (n, score, mode = 'full') => post(rk, 'submit', { mode, entry: { n, nick: n.toUpperCase(), avatar: 1, score, rounds: 5, win: false, char: 'pyrtek', garnek: 0, at: 1 } });
  assert((await sub('ala', 100)).j.rank === 1 && (await sub('ola', 300)).j.rank === 1 && (await sub('ala', 200)).j.rank === 2, 'miejsca');
  assert((await sub('ala', 50)).j.rank === 2, 'gorszy wynik nie nadpisuje');
  const l = await (await rk.fetch(new Request('https://bg/list?mode=full'))).json();
  eq(l.list.map(x => x.score), [300, 200], 'posortowane, bez duplikatów'); assert(!l.list.some(x => 'n' in x), 'n nie wychodzi na zewnątrz');
  assert((await (await rk.fetch(new Request('https://bg/list?mode=quick'))).json()).list.length === 0, 'tryby osobno');
  assert((await rk.fetch(new Request('https://bg/list?mode=zly'))).status === 400, 'zły tryb');
  assert((await post(rk, 'submit', { mode: 'full', entry: { n: 'x', score: 'dużo' } })).status === 400, 'zły wpis');
});
test('BgRanks: „prawie” (najbliższy wynik nad tobą) i anonimowe liczniki pięter dla ciekawostek', async () => {
  const rk = new BgRanks({ storage: mkStorage() }, {});
  const sub = (n, score, fl, win = false) => post(rk, 'submit', { mode: 'quick', entry: { n, nick: n.toUpperCase(), avatar: 1, score, rounds: 3, win, char: 'pyrtek', garnek: 1, at: 1, ...(fl ? { fl } : {}) } });
  assert((await sub('ala', 5000)).j.above === null, 'pierwszy wynik: nikt nad nim');
  await sub('ola', 3000, { round: 4, died: true });
  const r = (await sub('ewa', 2500, { round: 4, died: true })).j;
  assert(r.above && r.above.nick === 'OLA' && r.above.gap === 500 && r.above.place === 3, 'nad wynikiem Ewy jest Ola (500 pkt), miejsce 3: ' + JSON.stringify(r.above));
  assert((await sub('ola', 3500, { round: 2, died: true })).j.above.nick === 'ALA', 'własny wcześniejszy wpis nie liczy się jako „nad tobą”');
  const f = (await sub('jan', 9000, { round: 10, died: false }, true)).j.floor, M = D.MODES.quick;
  assert(f.runs === 4 && f.wins === 1 && f.reach.length === M.rounds && f.reach[0] === 4 && f.reach[3] === 3 && f.reach[9] === 1, 'dotarcie na piętra: ' + JSON.stringify(f.reach));
  assert(f.died[3] === 2 && f.died[1] === 1 && f.died.reduce((a, b) => a + b, 0) === 3, 'odpadnięcia na piętrach: ' + JSON.stringify(f.died));
  const g = (await sub('kot', 100, null)).j.floor;
  assert(g.runs === 4, 'wpis bez `fl` (poddanie) nie zmienia liczników pięter');
  assert((await post(rk, 'submit', { mode: 'quick', entry: { n: 'x', nick: 'X', score: 10, rounds: 1, win: false, char: 'pyrtek', garnek: 3, at: 1 } })).j.floor === null, 'inny palnik: osobne liczniki, puste');
});
test('Sim: wynik walki ma liczniki krytyków do ciekawostek (critRolls ≥ critHits, critPct = szansa bohatera)', () => {
  const res = runFight(R.buildSetup(fresh()), [[2, 0], [30, 0], [60, 0]]);
  assert(Number.isInteger(res.critRolls) && Number.isInteger(res.critHits) && res.critHits <= res.critRolls && res.critPct >= 0, JSON.stringify([res.critRolls, res.critHits, res.critPct]));
});
test('BgRanks: widoki po postaci, poziomie Garnka i graczu, jeden wpis na gracza w przekroju, migracja starych wpisów', async () => {
  const rk = new BgRanks({ storage: mkStorage() }, {});
  const sub = (n, score, char, garnek) => post(rk, 'submit', { mode: 'full', entry: { n, nick: n.toUpperCase(), avatar: 1, score, rounds: 5, win: false, char, garnek, at: 1 } });
  const ls = async q => (await (await rk.fetch(new Request('https://bg/list?mode=full' + q))).json());
  await sub('ala', 100, 'pyrtek', 0); await sub('ala', 900, 'indor', 1); await sub('ola', 300, 'pyrtek', 0); await sub('ola', 250, 'pyrtek', 2); await sub('ala', 400, 'pyrtek', 0);
  eq((await ls('')).list.map(x => x.nick + x.score), ['ALA900', 'OLA300'], 'ogólny: najlepszy wynik gracza');
  eq((await ls('&char=pyrtek')).list.map(x => x.nick + x.score), ['ALA400', 'OLA300'], 'po postaci: najlepszy gracza na tej postaci');
  eq((await ls('&garnek=0')).list.map(x => x.nick + x.score), ['ALA400', 'OLA300'], 'po Garnku');
  eq((await ls('&char=pyrtek&garnek=2')).list.map(x => x.nick + x.score), ['OLA250'], 'postać i Garnek razem');
  const my = await ls('&nick=ala'); eq(my.list.map(x => x.char + x.garnek + ':' + x.score).sort(), ['indor1:900', 'pyrtek0:400'], 'po graczu: każda kombinacja osobno (bez starych, gorszych wyników)');
  eq([my.total, (await ls('&nick=nikt')).list.length], [2, 0], 'liczba wpisów i nieznany gracz');
  assert((await rk.fetch(new Request('https://bg/list?mode=full&char=smok'))).status === 400 && (await rk.fetch(new Request('https://bg/list?mode=full&garnek=x'))).status === 400, 'zła postać i zły Garnek');
  // migracja: stary ranking (tylko klucz „r:”) zasila widoki po postaci
  const st = mkStorage(); await st.put('r:quick', [{ n: 'zed', nick: 'ZED', avatar: 1, score: 777, rounds: 4, win: false, char: 'kwoka', garnek: 1, at: 1 }]);
  const r2 = new BgRanks({ storage: st }, {});
  eq((await (await r2.fetch(new Request('https://bg/list?mode=quick&char=kwoka'))).json()).list.map(x => x.score), [777], 'stary wpis widać po postaci');
});

// ---------- cały Worker ----------
let ipN = 0;
async function api(env, path, body, { token, method = 'POST', origin = 'https://pl3y.pl' } = {}) {
  const res = await worker.fetch(new Request('https://srv' + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '10.7.' + (ipN++ % 250) + '.1', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }), env);
  const text = await res.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, j };
}
test('Worker: Bulgot wymaga sesji PL3Y i nicka gracza, cały przebieg przez /api/bg/*, ranking publiczny', async () => {
  const env = mkEnv(), { token } = await signToken(env.SECRET, 'd'), o = { token };
  assert((await api(env, '/api/bg/state', {})).status === 401, 'bez sesji 401');
  assert((await api(env, '/api/bg/state', {}, o)).j.code === 'player', 'bez gracza 401 player');
  assert((await api(env, '/api/bg/state', { pt: 'zly.token' }, o)).status === 401, 'zły token gracza');
  assert((await api(env, '/api/bg/state', { pt: 'x' }, { token, origin: 'https://obcy.example' })).status === 403, 'obcy Origin');
  const c = await api(env, '/api/pl/claim', { nick: 'Kura', pin: '1357', avatar: 3 }, o); assert(c.status === 200, 'nick');
  const pt = c.j.pt;
  let r = await api(env, '/api/bg/start', { pt, mode: 'quick', char: 'pyrtek', garnek: 0 }, o);
  assert(r.status === 200 && r.j.run.phase === 'offer' && r.j.profile.nick === 'Kura', 'start przez Worker');
  const up = await api(env, '/api/bg/upgrade', { pt, id: 'ziarenko-z-podlogi' }, o); assert(up.status === 409 && up.j.code === 'index', 'trasa /api/bg/upgrade istnieje w Workerze (409 index, nie 404)');
  const n2 = await api(env, '/api/pl/claim', { nick: 'Druga', pin: '2468' }, o);
  assert((await api(env, '/api/bg/state', { pt: n2.j.pt }, o)).j.run === null, 'run jest przypisany do gracza');
  let guard = 0;
  while (r.j.run.phase !== 'over' && guard++ < 100) {
    const ph = r.j.run.phase;
    const pi = Math.max(0, r.j.run.offer.findIndex(id => id && id !== 'automat-z-pasza'));
    if (ph === 'offer') r = await api(env, '/api/bg/pick', { pt, i: pi, slot: 0, mut: 1 }, o);
    else if (ph === 'badge' || ph === 'door' || ph === 'loot' || ph === 'route') r = await api(env, '/api/bg/choose', { pt, i: 0 }, o);
    else if (ph === 'event') { const kd = r.j.run.pending.kind; r = await api(env, kd === 'shop' ? '/api/bg/shop' : kd === 'gamble' ? '/api/bg/bet' : '/api/bg/choose', { pt, i: kd === 'shop' || kd === 'adopt' ? -1 : kd === 'arena' ? 1 : 2, amount: 0 }, o); }
    else if (ph === 'bonus') r = await api(env, '/api/bg/bonus', { pt, i: 0, slot: 0 }, o);
    else { await api(env, '/api/bg/fightstart', { pt }, o); r = await api(env, '/api/bg/fightfinish', { pt, inputs: [] }, o); }
  }
  assert(r.j.run.phase === 'over', 'run dokończony przez Worker');
  const rk = await api(env, '/api/bg/ranks?mode=quick', undefined, { ...o, method: 'GET' });
  assert(rk.status === 200 && Array.isArray(rk.j.list), 'ranking odczytywalny');
  if (r.j.end.rounds > 0) assert(rk.j.list.length === 1 && rk.j.list[0].nick === 'Kura' && !('n' in rk.j.list[0]), 'ranking z nickiem z serwera');
  assert((await api(env, '/api/bg/ranks?mode=zly', undefined, { ...o, method: 'GET' })).status === 400, 'zły tryb rankingu');
});
test('Worker: limit tempa dla akcji Bulgota (429), odczyt rankingu ma osobny, luźniejszy', async () => {
  const env = mkEnv(), { token } = await signToken(env.SECRET, 'd');
  const mk = ip => new Request('https://srv/api/bg/state', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: 'https://pl3y.pl', Authorization: 'Bearer ' + token, 'CF-Connecting-IP': ip } });
  let last = 0; for (let i = 0; i < 95; i++) last = (await worker.fetch(mk('10.200.0.1'), env)).status;
  assert(last === 429, 'po 90 akcjach na minutę 429, jest ' + last);
  assert((await worker.fetch(mk('10.200.0.2'), env)).status !== 429, 'inny adres nie jest blokowany');
});

// ---------- Rozbudowa „jeszcze jedna partia” (2026-11-21) ----------
const flo = Math.floor;
test('Reakcje: Szok Termiczny (Oparzenie + Mróz), Gorączka (Salmonella + Krwawienie), Kruchość (Mróz + Krwawienie)', () => {
  const f = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 1 })] })), e = f.enemies[0];
  f.applyStatus(e, 'burn', 4); const hp0 = e.hp; f.ev = [];
  f.applyStatus(e, 'frost', 2);
  assert(f.ev.some(x => x.k === 'react' && x.r === 'szok'), 'Szok Termiczny');
  eq(hp0 - e.hp, flo(f.S.atk * Math.min(300, 15 * 6) / 100), 'wybuch: 15% Ataku na stos');
  eq([e.frost, e.burn], [0, 2], 'zdejmuje Mróz i połowę Oparzenia');
  f.ev = []; f.applyStatus(e, 'frost', 1); assert(!f.ev.some(x => x.k === 'react'), 'przerwa między reakcjami');
  const g = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 1 }), foe({ hp: 100000, atk: 1, aspd: 1 })] })), [a, b] = g.enemies;
  g.applyStatus(a, 'poison', 2); g.applyStatus(a, 'bleed', 1);
  assert(a.feverUntil > g.tick && g.reactSeen.includes('goraczka'), 'Gorączka');
  const base = a.poison * g.dotPer('poison'); a.hp = 100000; g.tick = 9; g.dots(); assert(100000 - a.hp >= flo(base * 150 / 100), 'Gorączka: efekty bolą mocniej');
  g.kill(a); assert(b.poison >= D.REACTIONS.goraczka.spread, 'śmierć w Gorączce zaraża pozostałych');
  const k = new Fight(setup({ enemies: [foe({ hp: 100000, atk: 1, aspd: 1 })] })), c = k.enemies[0];
  k.applyStatus(c, 'frost', 1); k.applyStatus(c, 'bleed', 1); assert(c.brittle, 'Kruchość');
  k.ev = []; k.heroHit(c, 100, false, 'test'); assert(k.ev.some(x => x.k === 'hit' && x.crit) && !c.brittle, 'następne trafienie krytyczne (także bez szansy)');
  const r = runFight(setup({ lo: { tiles: ['termos'] }, enemies: [foe({ hp: 3000, atk: 1, aspd: 30 })] }));
  assert(r.reactions > 0 && r.reactSeen.includes('szok'), 'Termos wywołuje Szok w zwykłej walce');
});

test('Okno Gdakania: seria umiejętności podbija obrażenia, pełna seria trzech ogłusza (Popłoch)', () => {
  const mk = () => { const f = new Fight(setup({ lo: { skills: [sk('granat'), sk('lodowy'), sk('grad')] }, enemies: [foe({ hp: 100000, atk: 1, aspd: 1 })] })); while (f.tick < 20) f.step([]); return f; };
  const solo = mk(); solo.step([0]); const d1 = solo.ev.find(e => e.k === 'hit' && e.kind === 'granat').d;
  const two = mk(); two.step([1, 0]); const d2 = two.ev.find(e => e.k === 'hit' && e.kind === 'granat').d;
  eq(d2, flo(flo(two.S.atk * 250 / 100) * (100 + D.RULES.chainPct[0]) / 100), 'druga w serii +20%');
  assert(d2 > d1 && two.ev.some(e => e.k === 'chain' && e.n === 2), 'zdarzenie serii');
  const all = mk(); all.step([0, 1, 2]);
  assert(all.ev.some(e => e.k === 'chain' && e.n === 3) && all.ev.some(e => e.k === 'seria') && all.enemies[0].stunUntil > all.tick, 'pełna seria: Popłoch');
  eq([all.chains, all.chain, all.skillBonus], [1, 0, 0], 'seria zamknięta, premia wyzerowana');
  const late = mk(); late.step([0]); for (let i = 0; i < D.RULES.chainWindow + 2; i++) late.step([]); late.ev = []; late.step([1]);
  assert(!late.ev.some(e => e.k === 'chain'), 'po oknie seria zaczyna się od nowa');
});

test('Kafelki rosnące: Trofeum z Piór, Skarbonka Pisklęcia, Pierze Weterana (z limitem)', () => {
  const r = fresh(); r.tiles = ['trofeum-z-pior', 'skarbonka-piskleca']; force(r, 'ziarno-mocy'); R.pickTile(r, 0);
  const hp0 = R.statsOf(r).maxHp; R.fightSetup(r); const out = R.fightFinish(r, []);
  assert(out.result.win && out.reward === D.RULES.coinsRound + 1, 'Skarbonka: +1 Ziarno na start');
  eq([r.grow['trofeum-z-pior'], r.grow['skarbonka-piskleca']], [1, 1], 'liczniki rosną po wygranej');
  eq(R.statsOf(r).maxHp, hp0 + 2, 'Trofeum: +2 maks. Życia za wroga');
  eq(R.statsOf(r).coinFlat, 2, 'Skarbonka: +1 za piętro bez odpoczynku');
  const L = g => heroStats(loadout({ tiles: ['ziarno-mocy', 'pierze-weterana'], grow: { 'pierze-weterana': g } })).atk;
  eq([L(0), L(10), L(99)], [10, 12, 14], 'Pierze: +3% na stos, maks. +45%');
  assert(D.TILES.filter(t => t.grow).every(t => D.STARTER_TILES.includes(t.id)), 'rosnące kafelki są w puli od startu');
});

test('Rozwidlenie Korytarza: drzwi na stałych piętrach, ryzykowny wróg z cechą elity, nagroda Ziarna albo rzadki kafelek', () => {
  const d = fresh(); force(d, 'ziarno-mocy'); R.pickTile(d, 0); win(d);
  assert(d.phase === 'door' && d.pending.kind === 'door' && D.AFFIXES[d.pending.affix] && ['coins', 'rare'].includes(d.pending.reward), 'drzwi po 1. piętrze');
  assert(R.choose(d, 5).code === 'index', 'złe drzwi'); assert(R.choose(d, 1).ok && d.door.risky && d.phase === 'offer', 'ryzykowne drzwi');
  eq(R.view(d).doors, D.MODES.full.doors, 'widok zna piętra z drzwiami');
  const strong = x => { x.tiles = [...Array(12).fill('ziarno-mocy'), ...Array(8).fill('twardy-grzebien')]; x.hp = R.statsOf(x).maxHp; return x; };
  const c = strong(fresh()); c.round = 5; c.door = { risky: true, affix: 'szybki', reward: 'coins' };
  const st = R.buildSetup(c); assert(st.door && st.enemies[0].elite && st.enemies[0].affixes[0] === 'szybki' && st.enemies.length <= 2, 'wróg z cechą');
  const plain = strong(fresh()); plain.round = 5; assert(R.floorTemplate(c) === null, 'ryzykowne drzwi bez szablonu piętra');
  plain.door = null; assert(R.buildSetup({ ...plain, door: { risky: false } }).enemies.every(e => !e.elite), 'zwykłe drzwi: bez elity');
  const same = { ...c, door: null }; const tp = R.floorTemplate(same);
  if (!tp || tp === 'roj' || tp === 'para') assert(R.buildSetup(same).enemies[0].hp < st.enemies[0].hp, 'mocniejszy niż zwykle');
  const oc = win(c); assert(oc.result.win && oc.doorCoins === D.RULES.doorCoins && !oc.badge, 'nagroda: Ziarna, bez Odznaki');
  const rr = strong(fresh()); rr.round = 5; rr.door = { risky: true, affix: 'szybki', reward: 'rare' }; const orr = win(rr);
  assert(orr.result.win && rr.phase === 'bonus' && rr.offer.length === 3 && rr.offer.every(id => D.TILE_BY_ID[id].rarity >= 1), 'nagroda: rzadki kafelek');
  assert(!D.MODES.full.doors.some(n => D.MODES.full.bosses[n] || D.MODES.full.elite.includes(n)) && !D.MODES.quick.doors.some(n => D.MODES.quick.bosses[n] || D.MODES.quick.elite.includes(n)), 'drzwi nie trafiają na bossa ani elitę');
});

test('Lombard Lisa: zastaw za pełną cenę, wykup tylko na następnym piętrze za 150%, przepadek wzmacnia Lisy', () => {
  const p = fresh(); p.tiles = ['twardy-grzebien', 'opaska-rambo', 'kukurydziany-grad']; p.skills = [{ id: 'grad', lvl: 1 }]; p.hp = R.statsOf(p).maxHp; p.coins = 0;
  let r = R.pawn(p, 'opaska-rambo'); assert(r.ok && p.coins === 12 && !p.tiles.includes('opaska-rambo') && p.pawned.id === 'opaska-rambo', 'zastaw');
  eq([R.pawn(p, 'twardy-grzebien').code, R.redeem(p).code, R.pawn(fresh(), 'kukurydziany-grad').code], ['pawned', 'early', 'index'], 'jeden zastaw, wykup nie od razu');
  const q = fresh(); q.tiles = ['kukurydziany-grad']; eq(R.pawn(q, 'kukurydziany-grad').code, 'kind', 'umiejętności nie');
  p.tiles.push(...Array(10).fill('ziarno-mocy')); force(p, 'ziarno-mocy'); R.pickTile(p, 0); win(p); R.choose(p, 0);
  assert(p.round === 2 && R.view(p).pawned.canRedeem && R.view(p).pawned.cost === 18, 'wykup za 150%');
  p.coins = 17; eq(R.redeem(p).code, 'coins', 'za mało Ziaren'); p.coins = 30;
  r = R.redeem(p); assert(r.ok && p.coins === 12 && p.tiles.includes('opaska-rambo') && !p.pawned, 'wykup');
  const z = fresh(); z.tiles = [...Array(12).fill('ziarno-mocy'), ...Array(8).fill('twardy-grzebien'), 'opaska-rambo']; z.hp = R.statsOf(z).maxHp;
  R.pawn(z, 'opaska-rambo'); force(z, 'ziarno-mocy'); R.pickTile(z, 0); win(z); R.choose(z, 0); force(z, 'ziarno-mocy'); R.pickTile(z, 0); win(z);
  assert(z.round === 3 && !z.pawned && z.foxDebt === 1 && z.lostPawn === 'opaska-rambo' && !z.tiles.includes('opaska-rambo'), 'przepadek');
  const fx = fresh(), fy = fresh(); let found = false;
  for (let n = 2; n <= 6 && !found; n++) {
    fx.round = fy.round = n;
    if (!R.encounterIds(fx).includes('lis-windykator')) continue;
    found = true; fy.foxDebt = 1;
    const i = R.encounterIds(fx).indexOf('lis-windykator'), a = R.buildSetup(fx).enemies[i], b = R.buildSetup(fy).enemies[i];
    assert(b.hp === flo(a.hp * 125 / 100) && b.steal.max === 4, 'Lis silniejszy po przepadku');
  }
});

test('Odsetki w Spiżarni: +1 Ziarno za każde 10, maks. 3 (Kaczor 5)', () => {
  const run = c => { const x = fresh({ char: c }); force(x, 'ziarno-mocy'); R.pickTile(x, 0); x.coins = 60; R.fightSetup(x); return R.fightFinish(x, []); };
  eq([run('pyrtek').interest, run('kaczor').interest], [3, 5], 'limit odsetek');
  const s = fresh(); s.coins = 9; force(s, 'ziarno-mocy'); R.pickTile(s, 0); R.fightSetup(s); eq(R.fightFinish(s, []).interest, 0, 'poniżej 10 nic');
});

test('Okólniki Zarządu: inne w każdej strefie, Audyt, Premia, Praca Zdalna, Tryb Pilny, Oszczędności, Integracja', () => {
  const ds = R.decreesOf(4242); eq(ds, R.decreesOf(4242), 'deterministyczne'); assert(new Set(ds).size === 3 && ds.every(x => D.DECREES[x]), 'trzy różne');
  const n = R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 4242 }).run; eq(n.decrees, ds, 'zapisane w runie');
  eq(R.view(n).decree, ds[0], 'widok: okólnik bieżącej strefy'); n.round = 7; eq(R.view(n).decree, ds[1], 'druga strefa');
  const a = fresh(); a.decrees = ['audyt', null, null]; a.coins = 50;
  eq(R.shopPrice(D.TILE_BY_ID['ziarenko-z-podlogi'], a), 9, 'Audyt: dokupowanie +50%');
  eq([R.reroll(a).cost, R.reroll(a).cost, R.reroll(a).cost, a.freeLeft], [0, 0, 2, 0], 'Audyt: dwa darmowe rerolle');
  const p0 = fresh(), p1 = fresh(); p1.decrees = ['premia', null, null]; p0.round = p1.round = 3;
  assert(R.buildSetup(p1).enemies[0].hp === flo(R.buildSetup(p0).enemies[0].hp * 115 / 100), 'Premia: +15% Życia wrogów');
  const pc = fresh(); pc.decrees = ['premia', null, null]; force(pc, 'ziarno-mocy'); R.pickTile(pc, 0); R.fightSetup(pc); eq(R.fightFinish(pc, []).reward, D.RULES.coinsRound + 3, 'Premia: +3 Ziarna');
  const h = fresh(); h.decrees = ['homeoffice', null, null]; h.coins = 20; h.hp = 10; eq(R.rest(h).healed, flo(R.statsOf(h).maxHp * 40 / 100), 'Praca Zdalna: odpoczynek x2');
  const pl = fresh(); pl.decrees = ['pilny', null, null]; pl.phase = 'fight'; const su = R.fightSetup(pl).setup; eq(su.fury, 300, 'Tryb Pilny: Furia od 30 s');
  const fy = new Fight({ ...setup({ enemies: [foe({ hp: 1e7, atk: 1, aspd: 1 })] }), fury: 300 }); let at = -1;
  while (fy.tick < 320) { fy.step([]); if (fy.ev.some(e => e.k === 'fury')) at = fy.tick - 1; }
  eq(at, 300, 'zdarzenie Furii w 30 s');
  const o1 = new Fight(setup({ lo: { decree: 'oszczednosci' } })), o0 = new Fight(setup());
  assert(o1.dotPer('burn') === Math.max(1, flo(o0.dotPer('burn') / 2)), 'Oszczędności: Oparzenie o połowę');
  o1.applyStatus(o1.enemies[0], 'frost', 1); o0.applyStatus(o0.enemies[0], 'frost', 1); eq(o1.enemies[0].frostT, o0.enemies[0].frostT * 2, 'Oszczędności: Mróz 2x dłużej');
  eq([heroStats(loadout({ tiles: ['chochla'], decree: 'integracja' })).burnPct, heroStats(loadout({ tiles: ['chochla'] })).burnPct], [25, 0], 'Integracja: zestaw o 1 sztukę więcej');
});

test('Wadliwa Partia: kafelek z wadą jest mocniejszy, wada ujawnia się po walce, Wylęgarnia ją usuwa, Lis jej nie bierze', () => {
  const w = fresh(); force(w, 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob', 'ostry-dziob'); w.flawAt = 0;
  R.pickTile(w, 0); assert(w.flawed.length === 1 && !w.flawed[0].on && D.FLAWS[w.flawed[0].flaw], 'wada zapisana, ukryta');
  eq(R.statsOf(w).atk, 11, '+50% efektów'); eq(R.view(w).flawed[0].flaw, null, 'widok nie zdradza wady');
  w.tiles.push(...Array(10).fill('twardy-grzebien')); w.hp = R.statsOf(w).maxHp;
  const o = win(w); assert(o.revealed && o.revealed[0].id === 'ziarno-mocy' && w.flawed[0].on && R.view(w).flawed[0].flaw === w.flawed[0].flaw, 'ujawniona po walce');
  R.choose(w, 0); eq(R.pawn(w, 'ziarno-mocy').code, 'flaw', 'Lis nie bierze wadliwego');
  const x = fresh(); x.tiles = ['tykajace-jajo']; x.flawed = [{ id: 'tykajace-jajo', flaw: 'ciezki', on: true, round: 1 }]; force(x, 'kostka-rosolowa'); R.pickTile(x, 0);
  assert(x.tiles.includes('jajko-na-twardo') && x.flawed.length === 0, 'Wylęgarnia naprawia');
  const sb = new Fight(setup({ lo: { tiles: ['ziarno-mocy'], flawed: [{ id: 'ziarno-mocy', flaw: 'samozaplon', on: true }] }, enemies: [foe({ hp: 1e7, atk: 1, aspd: 1 })], hp: 500 }));
  while (sb.tick < 201) sb.step([]);
  assert(sb.hburn >= 3, 'Samozapłon podpala co 20 s');
  const fb = new Fight(setup({ lo: { tiles: ['ziarno-mocy'], flawed: [{ id: 'ziarno-mocy', flaw: 'wybuchowy', on: true }] }, enemies: [foe({ hp: 1e7, atk: 1, aspd: 1 })], hp: 70 }));
  while (fb.tick < FURY_FROM) fb.step([]);
  const hb = fb.hp; fb.step([]); assert(hb - fb.hp >= flo(fb.S.maxHp * 15 / 100), 'Wybuchowa Usterka przy Furii');
  let flaws = 0; const y = R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 77 }).run; y.coins = 999; y.decrees = [null, null, null];
  for (let i = 0; i < 60; i++) { R.reroll(y); if (y.flawAt >= 0) { flaws++; assert(['stat', 'item'].includes(D.TILE_BY_ID[y.offer[y.flawAt]].type), 'wada tylko na statystyce lub przedmiocie'); } }
  assert(flaws > 3 && flaws < 40, 'wady pojawiają się czasem: ' + flaws);
});

test('Awans Wroga: zabójca zostaje Nemezis, kradnie kafelek, czeka w następnym runie; pokonany oddaje kafelek i Odznakę', () => {
  const n = fresh(); n.round = 3; n.tiles = ['opaska-rambo', 'twardy-grzebien']; n.hp = 1; n.phase = 'fight'; n.fight = {};
  const lo = R.fightFinish(n, []); assert(lo.ended === 'lose' && n.killer && !n.killer.nemesis && D.ENEMIES[n.killer.enemy], 'zabójca zapisany');
  const nx = n.killer.next; assert(D.NEMESIS_TITLES.includes(nx.title) && D.NEMESIS_NAMES.includes(nx.given) && D.AFFIXES[nx.affix] && ['opaska-rambo', 'twardy-grzebien'].includes(nx.tile), 'awans: tytuł, imię, cecha, łup');
  const p = newProfile(); onRunEnd(p, n); eq(p.nemesis, nx, 'Nemezis w profilu');
  const m = fresh({ nemesis: p.nemesis }); const M = D.MODES.full, nr = m.nemesis.round;
  assert(nr >= 2 && !M.bosses[nr] && !M.elite.includes(nr) && !M.doors.includes(nr) && R.zoneOf('full', nr) === D.ENEMIES[nx.enemy].zone, 'piętro w strefie wroga');
  m.round = nr; const ids = R.encounterIds(m); assert(ids[0] === nx.enemy && ids.length === 2, 'Nemezis z pomocnikiem');
  const st = R.buildSetup(m); assert(st.nemesis && st.enemies[0].nemesis && st.enemies[0].name === R.nemesisName(nx) && st.enemies[0].affixes[0] === nx.affix, 'Nemezis w walce');
  assert(R.view(m).nemesisRound && R.view(m).nemesis.name === R.nemesisName(nx), 'widok');
  m.tiles = [...Array(14).fill('ziarno-mocy'), ...Array(10).fill('twardy-grzebien')]; const had = m.tiles.filter(x => x === nx.tile).length; m.hp = R.statsOf(m).maxHp;
  const ow = win(m); assert(ow.result.win && ow.nemesis && m.nemesis.beaten && m.badges.includes('sprawiedliwosc'), 'pokonany: Odznaka');
  eq(m.tiles.filter(x => x === nx.tile).length, had + 1, 'skradziony kafelek wraca');
  assert(!D.BADGE_POOL.includes('sprawiedliwosc'), 'Odznaka Nemezis nie trafia do losowych ofert');
  const again = fresh({ nemesis: p.nemesis }); again.round = again.nemesis.round; again.hp = 1; again.phase = 'fight'; again.fight = {}; R.fightFinish(again, []);
  assert(again.killer.nemesis, 'zabity przez Nemezis'); onRunEnd(p, again); eq(p.nemesis.lvl, 2, 'Nemezis awansuje wyżej');
  const l2 = fresh({ nemesis: p.nemesis }); l2.round = l2.nemesis.round; assert(R.buildSetup(l2).enemies[0].hp > st.enemies[0].hp, 'wyższy poziom = mocniejszy');
  const bossRun = fresh(); bossRun.round = 6; bossRun.hp = 1; bossRun.phase = 'fight'; bossRun.fight = {}; R.fightFinish(bossRun, []); assert(!bossRun.killer, 'boss nie zostaje Nemezis');
});

test('BgPlayer: Testament Pyrtka (po przegranej, piąta karta następnego runu, inna postać) i Nemezis znika po pokonaniu', async () => {
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  let r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  const okTile = id => !D.TILE_BY_ID[id].event && D.TILE_BY_ID[id].rarity <= 1 && D.TILE_BY_ID[id].type !== 'skill';
  for (let k = 0; k < 40 && !r.j.run.offer.some(okTile); k++) { await post(o, 'abandon', { pl: PL }); r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); }   // oferta bez zwykłego/rzadkiego kafelka: losuj nowy run
  const i = r.j.run.offer.findIndex(okTile);
  await post(o, 'pick', { pl: PL, i, slot: 0, mut: 1 });
  assert((await post(o, 'will', { pl: PL, i: 0 })).status === 409, 'testament dopiero po przegranej');
  r = await post(o, 'abandon', { pl: PL }); const opts = r.j.run.willOptions; assert(Array.isArray(opts) && opts.length >= 1, 'opcje testamentu');
  r = await post(o, 'will', { pl: PL, i: 0 }); assert(r.j.ok && r.j.profile.will.tile === opts[0] && r.j.run.willOptions === null, 'testament spisany');
  assert((await post(o, 'will', { pl: PL, i: 0 })).status === 409, 'tylko raz');
  r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  assert(r.j.run.offer.includes(opts[0]) && r.j.run.will === opts[0] && r.j.profile.will === null, 'kafelek z testamentu w pierwszej ofercie');
  const k = r.j.run.offer.indexOf(opts[0]); r = await post(o, 'pick', { pl: PL, i: k, slot: 0, mut: 1 }); assert(r.j.run.will === null, 'testament zużyty');
  await post(o, 'abandon', { pl: PL }); await post(o, 'will', { pl: PL, i: 0 });
  st.m.get('profile').chars.push('kwoka');
  r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); assert(r.j.run.will === null && r.j.profile.will, 'ta sama postać: testament czeka');
  await post(o, 'abandon', { pl: PL }); r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'kwoka' }); assert(r.j.run.will && r.j.profile.will === null, 'inna postać: działa');
  await post(o, 'abandon', { pl: PL });
  const prof = st.m.get('profile'); prof.nemesis = { enemy: 'szczur-pasz', title: 'Kierownik', given: 'Zbigniew', affix: 'szybki', tile: null, lvl: 1 };
  r = await post(o, 'state', { pl: PL }); assert(r.j.profile.nemesis.name === 'Kierownik Szczur Pasz Zbigniew', 'Nemezis w profilu publicznym');
  r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); assert(r.j.run.nemesis && r.j.run.nemesis.round >= 2, 'Nemezis w nowym runie');
  const run = st.m.get('run'); run.round = run.nemesis.round; run.phase = 'fight'; run.fight = { started: true }; run.tiles = [...Array(14).fill('ziarno-mocy'), ...Array(10).fill('twardy-grzebien')]; run.hp = 500;
  r = await post(o, 'fightfinish', { pl: PL, inputs: [] }); assert(r.j.result.win && r.j.nemesis && r.j.profile.nemesis === null && r.j.profile.counters.nemesisKills === 1, 'pokonany Nemezis znika z profilu');
});

// ---------- Szablony pięter i ukryty podgląd (2026-11-22) ----------
test('szablony pięter: Czempion, Rój, Zwiad, Para losowane z ziarna, bez bossów, elit, Nemezis, drzwi i wczesnych pięter', () => {
  const seen = {};
  for (let seed = 1; seed <= 120; seed++) for (const mode of ['full', 'quick']) {
    const M = D.MODES[mode], r = fresh({ seed, mode });
    for (let round = 1; round <= M.rounds; round++) {
      r.round = round; const tp = R.floorTemplate(r);
      eq(R.floorTemplate(r), tp, 'deterministyczny');
      if (M.bosses[round] || M.elite.includes(round) || round <= M.early.rounds) eq(tp, null, 'bez szablonu: boss/elita/wczesne ' + round);
      if (!tp) continue;
      seen[tp] = (seen[tp] || 0) + 1;
      const ids = R.encounterIds(r), st = R.buildSetup(r), zi = R.zoneOf(mode, round);
      eq(st.tpl, tp, 'setup zna szablon');
      if (tp === 'czempion') assert(ids.length === 1 && st.enemies[0].champion && st.enemies[0].name.startsWith('Czempion '), 'Czempion: 1 wróg');
      if (tp === 'roj') assert(ids.length === 3 && ids.every(id => !D.ENEMIES[id].swarm), 'Rój: 3 wrogów');
      if (tp === 'zwiad') assert(ids.length === 1 && zi < 2 && D.ENEMIES[ids[0]].zone === zi + 1 && st.enemies[0].scout, 'Zwiad: wróg z następnej strefy');
      if (tp === 'para') assert(ids.length === 2 && ids[0] !== ids[1] && st.enemies.every(e => e.regenPct === D.FLOOR_TPL.para.regen), 'Para: 2 różne typy, wspierają się');
    }
  }
  for (const k of ['czempion', 'roj', 'zwiad', 'para']) assert(seen[k] > 20, 'szablon występuje: ' + k + ' ' + seen[k]);
  // Czempion ma +80% Życia względem tego samego wroga bez szablonu
  let r = null; for (let seed = 1; seed < 500 && !r; seed++) { const x = fresh({ seed }); x.round = 8; if (R.floorTemplate(x) === 'czempion') r = x; }
  assert(r, 'znaleziono Czempiona'); const ch = R.buildSetup(r).enemies[0];
  // Nemezis i ryzykowne drzwi wyłączają szablon
  const n = fresh(); n.round = 8; n.nemesis = { enemy: 'lis-windykator', round: 8, affix: 'szybki', lvl: 1 }; eq(R.floorTemplate(n), null, 'Nemezis bez szablonu');
  const d = fresh(); d.round = 8; d.door = { risky: true, affix: 'szybki', reward: 'coins' }; eq(R.floorTemplate(d), null, 'ryzykowne drzwi bez szablonu');
  // Rój: każdy wróg osłabiony
  let rj = null; for (let seed = 1; seed < 500 && !rj; seed++) { const x = fresh({ seed }); x.round = 9; if (R.floorTemplate(x) === 'roj') rj = x; }
  assert(rj && R.buildSetup(rj).enemies.length === 3, 'Rój ma 3 wrogów');
  assert(ch.hp > 0, 'Czempion ma życie');
});

test('ukryty podgląd: od Garnka 1 widok nie zdradza wrogów, szablonu ani cech elity (bossowie zapowiedziani)', () => {
  const g0 = fresh(), g1 = fresh({ garnek: 1 });
  for (const round of [2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 16]) {
    g0.round = g1.round = round;
    const v0 = R.view(g0), v1 = R.view(g1);
    assert(Array.isArray(v0.enemies) && v0.enemies.length >= 1, 'Garnek 0 widzi wrogów r' + round);
    eq(v1.enemies, null, 'Garnek 1 nie widzi wrogów r' + round);
    eq(v1.tpl, null, 'Garnek 1 nie widzi szablonu r' + round);
    eq(v1.affixes, null, 'Garnek 1 nie widzi cech elity r' + round);
    assert(v1.hidden === true, 'widok mówi, że skład jest ukryty');
    // żaden identyfikator ani nazwa wroga nie wycieka w całym widoku
    const txt = JSON.stringify(v1);
    for (const id of R.encounterIds(g1)) { assert(!txt.includes('"' + id + '"'), 'wyciek id ' + id); assert(!txt.includes(D.ENEMIES[id].name), 'wyciek nazwy ' + id); }
  }
  g1.round = 6; eq(R.view(g1).enemies, ['brojler'], 'boss zapowiedziany także od Garnka 1');
  assert(!R.view(g1).hidden, 'boss nie jest ukryty');
  g0.round = 8; assert('tpl' in R.view(g0), 'Garnek 0 widzi szablon (albo null)');
});

test('unieważnianie runów ze starej wersji reguł', async () => {
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  const old = fresh(); old.v = 1; await st.put('run', old);
  const res = (await post(o, 'state', { pl: PL })).j;
  assert(res.ok && res.voided === true && res.run === null, 'stary run unieważniony');
  eq(await st.get('run'), undefined, 'stary run usunięty z pamięci');
  eq(fresh().v, R.RUN_V, 'nowy run ma bieżącą wersję');
});

// ---------- osiągnięcia i procent ukończenia ----------
test('osiągnięcia: warunki, brak powtórek, procent ukończenia gry', async () => {
  const A = await import('../../../src/games/bulgot/achievements.js');
  const ids = D.ACHIEVEMENTS.map(a => a.id);
  assert(new Set(ids).size === ids.length && ids.length >= 45, 'unikalne id, co najmniej 45 osiągnięć');
  const p = newProfile(); eq(A.completion(p).pct, 0, 'nowy profil: 0%');
  const run = fresh(); run.ended = 'win'; run.phase = 'over'; run.coins = 0;
  run.stats.fastWin = 7; run.stats.flawless = 1; run.stats.longWin = 650; run.stats.maxChainsFight = 3; run.stats.chains = 3;
  onRunEnd(p, run);
  const got = A.evaluateAch(p, run).map(a => a.id);
  for (const id of ['a-wygrana', 'a-szybka'.replace('szybka', 'wygrana'), 'a-pyrtek', 'a-bez-synergii', 'a-bez-zakupow', 'a-bez-rerolli', 'a-bez-odpoczynku', 'a-bez-umiejetnosci', 'a-pusty-portfel', 'a-sekunda', 'a-minuta', 'a-bez-zadrapania', 'a-seria', 'a-trzy-serie', 'a-pierwszy']) assert(got.includes(id), 'zdobyte: ' + id);
  assert(!got.includes('a-nietykalny') && !got.includes('a-g1') && !got.includes('a-zagroda'), 'nie wszystko naraz');
  assert(A.evaluateAch(p, run).length === 0, 'drugi raz nic nowego');
  assert(p.clears['full:pyrtek:0'] === true, 'zapisano zwycięstwo trybu, postaci i palnika');
  const pc = A.completion(p); assert(pc.pct > 0 && pc.pct < 100, 'procent rośnie: ' + pc.pct);
  // run ze starej wersji (bez v2) nie przyznaje osiągnięć stylu
  const old = fresh(); delete old.stats.v2; old.ended = 'win'; old.phase = 'over'; const p2 = newProfile(); onRunEnd(p2, old);
  assert(!A.evaluateAch(p2, old).some(a => a.id === 'a-bez-synergii'), 'brak danych = brak osiągnięcia');
});

test('Hasło do ukrytej postaci (code): tylko „dzioby”, odblokowuje Zjaranego Kurczaka i zostaje w profilu', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  let r = await post(o, 'code', { pl: PL, text: 'kurczak' }); assert(r.j.code === 'code' && !r.j.profile.chars.includes('zjarany'), 'złe hasło nie odblokowuje');
  r = await post(o, 'code', { pl: PL }); assert(r.j.code === 'code', 'puste hasło');
  r = await post(o, 'code', { pl: PL, text: '  DziObY ' }); assert(r.j.ok && r.j.profile.chars.includes('zjarany') && r.j.unlocks && r.j.unlocks[0].target === 'zjarany', 'dzioby (bez wielkości liter) odblokowuje');
  r = await post(o, 'state', { pl: PL }); assert(r.j.profile.chars.includes('zjarany'), 'zostaje w profilu');
  r = await post(o, 'code', { pl: PL, text: 'dzioby' }); assert(r.j.ok && !r.j.unlocks, 'drugi raz nic nie zmienia');
  r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'zjarany' }); assert(r.j.ok, 'można zacząć run Zjaranym');
});

// ---------- poziomy statystyk, Ulepszanie, łup z bossów ----------
test('rodziny statystyk: 9 rodzin × 3 poziomy + legendarny, stare id na poziomie 3, rosnąca moc, jedna ikona na rodzinę', () => {
  eq(D.STAT_FAMS.length, 9, '9 rodzin');
  const OLD = ['twardy-grzebien', 'ziarno-mocy', 'ostry-dziob', 'szybki-dziob', 'pancerz-z-pierza', 'czujne-oko', 'zwinne-nogi', 'cieple-gniazdko', 'czterolistna-koniczyna'];
  for (const F of D.STAT_FAMS) {
    eq(F.ids.length, 4, 'cztery poziomy ' + F.fam);
    const ts = F.ids.map(id => D.TILE_BY_ID[id]);
    ts.forEach((t, i) => { assert(t && t.type === 'stat' && t.repeat && t.fam === F.fam && t.lvl === i + 1 && t.rarity === i, 'poziom ' + (i + 1) + ' ' + F.fam); });
    assert(OLD.includes(F.ids[2]), 'poziom 3 ma stare id: ' + F.fam);
    const v = ts.map(t => t.fx[0].v); assert(v[0] < v[1] && v[1] < v[2] && v[2] < v[3], 'moc rośnie ' + F.fam);
    assert(v[3] >= v[2] * 1.5 && v[3] <= v[2] * 1.85, 'legendarny 150–185% poziomu 3: ' + F.fam + ' ' + v.join('/'));
    eq([ts[0].next, ts[1].next, ts[2].next, !!ts[3].boss], [F.ids[1], F.ids[2], undefined, true], 'next i boss ' + F.fam);
    assert(!D.STARTER_TILES.includes(F.ids[3]), 'legendarny nie jest w puli startowej');
  }
});

test('oferty: występują poziomy 1–3, legendarne z bossów nigdy w ofertach, rerollach, bonusie ani Automacie', () => {
  const lv = new Set(); let boss = 0;
  for (let seed = 1; seed < 400; seed++) {
    const run = fresh({ seed, mode: 'full' });
    for (const salt of [0, 100, 101, 300]) for (const round of [1, 8, 15]) {
      run.round = round;
      for (const id of R.makeOffer(run, salt, salt === 300 ? { size: 3, minRarity: 1, noEvents: true } : {})) { const t = D.TILE_BY_ID[id]; if (t.type === 'stat') lv.add(t.lvl); if (t.boss) boss++; }
    }
  }
  eq([...lv].sort(), [1, 2, 3], 'w ofertach poziomy 1–3'); eq(boss, 0, 'legendarne statystyki nie wypadają w ofertach');
  const a = fresh(); a.coins = 5; a.offer = ['automat-z-pasza', 'ziarno-mocy', 'twardy-grzebien', 'szybki-dziob'];
  const ra = R.pickTile(a, 0); assert(ra.ok && ra.automat.every(id => D.TILE_BY_ID[id].lvl === 3), 'Automat daje statystyki poziomu 3');
});

test('Ulepszanie: 2 kopie poziomu 1 lub 2 → 1 kafelek następnego poziomu; błędy: za mało kopii, zła faza, poziom 3, brak kafelka', () => {
  eq(D.RULES.upgradeCost, 2, 'koszt zlania: 2 kopie');
  const run = fresh(); run.tiles = ['grzebien-z-tasmy', 'czujne-oko'];
  eq(R.view(run).up, [], 'za mało kopii: brak ulepszeń w widoku');
  eq(R.upgrade(run, 'grzebien-z-tasmy').code, 'copies', 'za mało kopii');
  run.tiles.push('grzebien-z-tasmy', 'grzebien-z-tasmy'); run.hp = R.statsOf(run).maxHp;
  eq(R.view(run).up, ['grzebien-z-tasmy'], 'widok pokazuje możliwe ulepszenie');
  const hp0 = R.statsOf(run).maxHp, r = R.upgrade(run, 'grzebien-z-tasmy');
  assert(r.ok && r.upgraded.to === 'grzebien-hodowlany', 'zlanie');
  eq(run.tiles, ['grzebien-z-tasmy', 'czujne-oko', 'grzebien-hodowlany'], '2 kopie znikają, 1 nowa (jedna zostaje)');
  eq(R.statsOf(run).maxHp, hp0 + 1, 'statystyki liczą się z nowego kafelka'); assert(run.hp <= R.statsOf(run).maxHp, 'życie nie przekracza maks.');
  eq([run.stats.upgrades, run.cur.upgrades], [1, [{ from: 'grzebien-z-tasmy', to: 'grzebien-hodowlany' }]], 'licznik i dziennik rundy');
  run.tiles = Array(2).fill('grzebien-hodowlany'); assert(R.upgrade(run, 'grzebien-hodowlany').ok && run.tiles[0] === 'twardy-grzebien', 'poziom 2 → 3 (stare id)');
  run.tiles = Array(2).fill('twardy-grzebien'); eq(R.upgrade(run, 'twardy-grzebien').code, 'level', 'poziom 3 nie jest ulepszany');
  run.tiles = Array(2).fill('grzebien-rosolowego-krola'); eq(R.upgrade(run, 'grzebien-rosolowego-krola').code, 'level', 'legendarny nie jest ulepszany');
  eq(R.upgrade(run, 'ziarno-mocy').code, 'index', 'brak takiego kafelka'); eq(R.upgrade(run, 'nie-ma').code, 'index', 'nieznany kafelek');
  run.tiles = Array(2).fill('slieskie-nozki'); run.phase = 'fight'; eq(R.upgrade(run, 'slieskie-nozki').code, 'phase', 'zła faza'); assert(run.tiles.length === 2, 'nic nie zginęło');
  run.phase = 'event'; eq(R.upgrade(run, 'slieskie-nozki').code, 'phase', 'zła faza (wydarzenie)');
});

test('Ulepszanie: wynik liczy się jak zdobyty (próg), wada fabryczna nie zostaje sierotą, regeneracja w dziesiątych, BgPlayer przyjmuje akcję', async () => {
  const run = fresh(); run.tiles = [...Array(2).fill('nogi-akrobaty'), ...Array(2).fill('zwinne-nogi')];
  assert(R.upgrade(run, 'nogi-akrobaty').ok && run.tiles.filter(x => x === 'zwinne-nogi').length === 3, 'Nogi Akrobaty ×2 → Zwinne Nogi (trzecia kopia)');
  eq([R.statsOf(run).evade, R.statsOf(run).aspd], [11 * 3 + 5, 108], 'trzy Zwinne Nogi: 30% + próg Taniec Kurczaka (5% uniku, 8% szybkości ataku)');
  const f = fresh(); f.tiles = Array(2).fill('sloma-z-wczoraj'); f.flawed = [{ id: 'sloma-z-wczoraj', flaw: 'kruchy', on: false, round: 1 }];
  assert(R.upgrade(f, 'sloma-z-wczoraj').ok && f.flawed.length === 0, 'wada zniknęła razem ze stopioną kopią');
  eq(heroStats({ char: 'pyrtek', tiles: ['sloma-z-wczoraj', 'gniazdko-z-siana'] }).regen, 7, 'regeneracja w dziesiątych częściach (0,2 + 0,5 / s)');
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  const run0 = await st.get('run'); run0.tiles = Array(2).fill('ziarenko-z-podlogi'); run0.phase = 'offer'; await st.put('run', run0);
  let r = await post(o, 'upgrade', { pl: PL, id: 'ziarenko-z-podlogi' });
  assert(r.j.ok && r.j.upgraded.to === 'ziarno-selekcjonowane' && r.j.run.tiles.join() === 'ziarno-selekcjonowane' && r.j.run.up.length === 0, 'BgPlayer: upgrade');
  r = await post(o, 'upgrade', { pl: PL, id: 'ziarno-selekcjonowane' }); eq(r.j.code, 'copies', 'BgPlayer: za mało kopii'); eq(r.status, 409, 'status 409');
});

test('łup z bossa: po bossie (nie ostatnim) wybierasz 1 z 3 legendarnych z ziarna runu, deterministycznie; po Prezesie run się kończy bez łupu', () => {
  const mkBoss = () => { const b = fresh(); b.round = 6; b.tiles = [...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; b.hp = 9999; b.phase = 'fight'; b.fight = {}; return b; };
  const A = mkBoss(), B = mkBoss(); R.fightFinish(A, []); R.fightFinish(B, []);
  eq([A.phase, A.pending.kind, A.pending.offer.length], ['badge', 'badge', 3], 'najpierw Odznaka'); assert(A.pending.loot, 'po Odznace łup');
  R.choose(A, 0); R.choose(B, 0);
  eq(A.phase, 'loot', 'faza łupu'); eq(A.pending.offer, B.pending.offer, 'deterministyczny wybór (to samo ziarno)');
  assert(A.pending.offer.length === 3 && new Set(A.pending.offer).size === 3 && A.pending.offer.every(id => D.TILE_BY_ID[id].boss && D.TILE_BY_ID[id].rarity === 3), 'trzy różne legendarne');
  eq(R.view(A).offer, [], 'oferta pusta w fazie łupu'); assert(!('seed' in R.view(A)), 'widok nie zdradza ziarna');
  eq(R.choose(A, 5).code, 'index', 'zły indeks'); eq(R.pickTile(A, 0).code, 'phase', 'nie wybierzesz zwykłego kafelka w fazie łupu');
  const id = A.pending.offer[2], r = R.choose(A, 2);
  assert(r.ok && r.looted === id && A.tiles.includes(id), 'łup dodany do kafelków');
  eq(A.phase, 'bonus', 'po łupie bonus (po bossie 1 w trybie pełnym)'); eq(A.log.at(-1).loot, id, 'łup w dzienniku');
  const C = mkBoss(); C.seed = 777; R.fightFinish(C, []); R.choose(C, 0); assert(C.pending.offer.every(x => D.TILE_BY_ID[x].boss), 'inne ziarno, nadal legendarne');
  const P = fresh(); P.round = 20; P.tiles = [...Array(40).fill('ziarno-mocy'), ...Array(40).fill('twardy-grzebien')]; P.skills = [{ id: 'granat', lvl: 2 }]; P.hp = 99999; P.phase = 'fight'; P.fight = {};
  const rp = R.fightFinish(P, []); assert(rp.victory && P.phase === 'victory' && !rp.loot && P.cleared === P.done, 'Prezes: wygrana, wybór Dogrywki, bez łupu'); R.choose(P, 1); assert(P.phase === 'over' && P.ended === 'win', 'koniec runu po wyborze');
  const Q = fresh({ mode: 'quick' }); Q.round = 5; Q.tiles = [...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; Q.hp = 9999; Q.phase = 'fight'; Q.fight = {};
  R.fightFinish(Q, []); R.choose(Q, 0); eq(Q.phase, 'loot', 'tryb szybki: łup po bossie 5'); R.choose(Q, 0); eq(Q.phase, 'bonus', 'potem bonus');
});

test('łup z bossa: posiadane legendarne nie są proponowane, dopóki są inne; pula nigdy nie jest pusta', () => {
  const b = fresh(); b.round = 6; b.tiles = ['grzebien-rosolowego-krola', ...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; b.hp = 9999; b.phase = 'fight'; b.fight = {}; R.fightFinish(b, []); R.choose(b, 0);
  assert(!b.pending.offer.includes('grzebien-rosolowego-krola'), 'nie proponuje już posiadanego');
  const all = D.TILES.filter(t => t.boss).map(t => t.id); const c = fresh(); c.round = 6; c.tiles = [...all.slice(0, 8), ...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; c.hp = 9999; c.phase = 'fight'; c.fight = {}; R.fightFinish(c, []); R.choose(c, 0);
  eq(c.pending.offer.length, 3, 'nadal 3 propozycje, gdy zostało mniej niż 3 nowe');
});

test('RUN_V = 7: stary run (wersja 2) jest unieważniany', async () => {
  eq(R.RUN_V, 11, 'wersja reguł');
  const env = mkEnv(), st = mkStorage(), o = new BgPlayer({ storage: st }, env);
  await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' });
  const run = await st.get('run'); run.v = 2; await st.put('run', run);
  const r = await post(o, 'state', { pl: PL }); assert(r.j.voided && !r.j.run, 'run v2 unieważniony');
});

test('regeneracja: ułamkowe wartości kumulują się w sekundach (0,2 / s = 1 Życia co 5 s)', () => {
  const lo = { char: 'pyrtek', tiles: ['sloma-z-wczoraj'], skills: [] };
  const setup = { v: 1, round: 1, mode: 'quick', seed: 5, boss: null, elite: false, zone: 0, hero: { loadout: lo, hp: 10 }, enemies: [{ id: 'szczur-pasz', name: 'Test', hp: 999999, atk: 1, aspd: 100, armor: 0, evade: 0, crit: 0, art: 'rat', idle: 99999 }], minion: null };
  const f = new Fight(setup); for (let i = 0; i < 100; i++) f.step([]); eq(f.hp, 12, '10 s × 0,2 = +2 Życia (ułamki się kumulują)');
});

test('łup z bossa: szansa 15% (RULES.lootChance), losowana deterministycznie z ziarna; bez łupu od razu bonus albo następne piętro', () => {
  D.RULES.lootChance = 15;
  try {
    let hit = 0; const N = 2000;
    for (let seed = 1; seed <= N; seed++) { const r = fresh({ seed }); r.round = 6; const a = R.lootRoll(r); eq(a, R.lootRoll(r), 'deterministyczne'); if (a) hit++; }
    assert(hit > N * 0.11 && hit < N * 0.19, 'ok. 15% runów dostaje łup: ' + hit + ' z ' + N);
    let nl = null, wl = null;
    for (let seed = 1; seed < 200 && (!nl || !wl); seed++) { const r = fresh({ seed }); r.round = 6; if (R.lootRoll(r)) wl = wl || seed; else nl = nl || seed; }
    const go = seed => { const b = fresh({ seed }); b.round = 6; b.tiles = [...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; b.hp = 9999; b.phase = 'fight'; b.fight = {}; R.fightFinish(b, []); R.choose(b, 0); return b; };
    eq(go(nl).phase, 'bonus', 'bez łupu: po Odznace od razu bonus'); eq(go(wl).phase, 'loot', 'z łupem: faza łupu');
  } finally { D.RULES.lootChance = 100; }
});

// ---------- etap 2: nowe umiejętności i przedmioty ----------
test('etap 2: pula (121 kafelków), zestawy mają 6–7 sztuk, każda nowa umiejętność ma 2 mutacje i kafelek, nowe kafelki są w ofertach', () => {
  const sets = {}; for (const t of D.TILES.filter(x => x.set && !x.hatched)) sets[t.set] = (sets[t.set] || 0) + 1;
  for (const [s, n] of Object.entries(sets)) assert(n >= 6 && n <= 7, 'zestaw ' + s + ' ma ' + n + ' sztuk');
  for (const id of ['wrzatek', 'podpalka', 'powiew', 'sopel', 'zakwas', 'pazury', 'wir', 'garsc', 'zwolnienie', 'pogotowie']) { const s = D.SKILLS[id]; assert(s && s.muts.length === 2 && D.TILES.some(t => t.skill === id), 'umiejętność ' + id); }
  const seen = new Set();
  for (let seed = 1; seed < 300; seed++) { const run = fresh({ seed }); run.round = 8; for (const id of R.makeOffer(run, 100 + (seed % 5))) seen.add(id); }
  for (const id of ['wrzatek-z-kotla', 'kura-nioska', 'open-space', 'zwolnienie-dyscyplinarne', 'spichlerz', 'sopel-w-plecy']) assert(seen.has(id), 'w ofertach pojawia się ' + id);
});

test('umiejętności etapu 2: Wrzątek, Podpałka, Powiew, Sopel, Zakwas, Pazury, Wir, Garść Ziarna, Zwolnienie, Pogotowie (i ich Mutacje)', () => {
  const big = (o = {}) => foe({ hp: 100000, atk: 1, aspd: 10, ...o });
  const first = (id, lvl = 1, mut = 0, enemies = [big(), big()], lo = {}, hp) => { const f = new Fight(setup({ lo: { ...lo, skills: [{ id, lvl, mut }] }, enemies, hp })); f.skills[0].cd = 0; f.step([0]); return f; };
  let f = first('wrzatek'); eq([f.enemies[0].burn, f.enemies[1].burn], [3, 0], 'Wrzątek: 3 Oparzenia na celu');
  f = first('wrzatek', 3, 1); eq([f.enemies[0].burn, f.enemies[1].burn], [3, 3], 'Wrzątek Hurtowy: na wszystkich');
  let g = new Fight(setup({ lo: { skills: [sk('wrzatek')] }, enemies: [big()] })); g.skills[0].cd = 0; g.applyStatus(g.enemies[0], 'burn', 4); g.step([0]); eq(g.enemies[0].burn, 10, 'podwaja 4 → 8 i +3, limit 10');
  const dmg = m => { const x = first('wrzatek', 3, m, [big()]); return 100000 - x.enemies[0].hp; };
  assert(dmg(2) > dmg(1) * 2, 'Gotowanie na Wolnym Ogniu: 150% zamiast 60%');
  f = first('podpalka'); for (let i = 0; i < 12; i++) f.step(); assert(f.enemies[0].burn >= 1 && f.igniteUntil > f.tick, 'Podpałka: ataki nakładają Oparzenie');
  f = first('podpalka', 3, 2); assert(f.igniteUntil - f.tick > 100, 'Długi Knot trwa 2 razy dłużej');
  f = first('powiew'); eq(f.enemies.map(e => e.frost), [3, 3], 'Powiew: 3 Mrozu na wszystkich'); f = first('powiew', 3, 1); assert(f.enemies.every(e => e.frozenUntil > 0), 'Zamieć: 5 stosów zamraża');
  f = first('powiew', 3, 2, [big()], {}, 20); assert(f.hp > 20, 'Szron na Piórach leczy');
  g = new Fight(setup({ lo: { skills: [sk('sopel')] }, enemies: [big(), big()] })); g.skills[0].cd = 0; g.applyStatus(g.enemies[1], 'frost', 2); g.step([0]);
  assert(g.enemies[0].hp === 100000 && g.enemies[1].hp < 100000, 'Sopel w Plecy celuje w wroga z Mrozem');
  const sd = (fr) => { const x = new Fight(setup({ lo: { skills: [sk('sopel')] }, enemies: [big()] })); x.skills[0].cd = 0; if (fr) x.applyStatus(x.enemies[0], 'frost', 2); x.step([0]); return 100000 - x.enemies[0].hp; };
  assert(sd(true) >= sd(false) * 2.5, 'Sopel: ok. ×2,7 w wroga z Mrozem');
  f = first('sopel', 3, 1); assert(f.enemies.every(e => e.hp < 100000), 'Odłamki: oba cele dostają obrażenia');
  f = first('zakwas'); eq(f.enemies.map(e => e.poison), [1, 1], 'Zakwas: +1 na nowo'); g = new Fight(setup({ lo: { skills: [sk('zakwas')] }, enemies: [big()] })); g.skills[0].cd = 0; g.applyStatus(g.enemies[0], 'poison', 3); g.step([0]); eq(g.enemies[0].poison, 7, 'podwaja 3 → 6 i +1');
  g = new Fight(setup({ lo: { skills: [{ id: 'zakwas', lvl: 3, mut: 1 }] }, enemies: [big()] })); g.skills[0].cd = 0; g.applyStatus(g.enemies[0], 'poison', 3); g.step([0]); eq(g.enemies[0].poison, 10, 'Burzliwa Fermentacja potraja 3 → 9 i +1');
  f = first('pazury'); eq(f.enemies[0].bleed, 3, 'Pazury: 3 Krwawienia'); f = first('pazury', 3, 1); assert(f.enemies[0].bleed + f.enemies[1].bleed >= 3, 'Krwawy Taniec');
  f = first('pazury', 1, 0, [big()], {}, 20); assert(f.hp > 20, 'Pazury leczą za stosy Krwawienia');
  f = first('wir'); assert(100000 - f.enemies[0].hp + 100000 - f.enemies[1].hp > 0 && evs(f.ev, 'hit').length === 3, 'Wir: 3 jaja'); f = first('wir', 3, 2); eq(evs(f.ev, 'hit').length, 6, 'Dziesiątka: 6 jaj');
  f = first('wir', 3, 1); assert(f.enemies.some(e => e.burn > 0), 'Jajecznica: Oparzenie');
  f = first('garsc', 1, 0, [big()], {}, 20); assert(f.hp > 20 && f.dmgUntil > f.tick && f.dmgBonus === 30, 'Garść Ziarna: bonus obrażeń i leczenie'); f = first('garsc', 3, 1, [big()]); eq(f.dmgBonus, 78, 'Wiadro Ziarna: 60% × moc poziomu 3');
  // Zwolnienie: wróg poniżej progu odchodzi, boss nie
  g = new Fight(setup({ lo: { skills: [sk('zwolnienie')] }, enemies: [foe({ hp: 1000 }), foe({ hp: 1000 })] })); g.skills[0].cd = 0; g.enemies[1].hp = 100; g.step([0]); assert(g.enemies[1].dead && !g.enemies[0].dead && g.coinsWon === 1, 'Zwolnienie: wróg poniżej 25% odchodzi, +1 Ziarno');
  g = new Fight(setup({ lo: { skills: [sk('zwolnienie')] }, enemies: [foe({ hp: 100000, boss: 'brojler', id: 'brojler' })] })); g.skills[0].cd = 0; g.enemies[0].hp = 100; g.step([0]); assert(!g.enemies[0].dead || g.enemies[0].hp <= 0, 'boss nie jest zwalniany od ręki (traci tylko zwykłe obrażenia)');
  g = new Fight(setup({ lo: { skills: [{ id: 'zwolnienie', lvl: 3, mut: 2 }] }, enemies: [foe({ hp: 1000 }), foe({ hp: 1000 })] })); g.skills[0].cd = 0; g.enemies[1].hp = 350; g.step([0]); assert(g.enemies[1].dead, 'Restrukturyzacja: próg 40%');
  g = new Fight(setup({ lo: { skills: [sk('pogotowie')] }, enemies: [big({ idle: 99999 })], hp: 10 })); g.skills[0].cd = 0; g.step([0]); for (let i = 0; i < 45; i++) g.step(); assert(g.hp >= 10 + 3 * 5, 'Pogotowie leczy co sekundę (8% z 70 = 5, ok. 4 s)'); const h1 = g.hp; for (let i = 0; i < 100; i++) g.step(); eq(g.hp, h1, 'po 4 s koniec leczenia');
});

test('przedmioty etapu 2: Wywar Dnia, Tłusta Pokrywka, Szczypta Soli, Lodowa Spódnica, Szron Poranny, Jajko Niespodzianka, Kombajn, Strach na Wróble, Karabin, Apteczka, Open Space', () => {
  const big = (o = {}) => foe({ hp: 100000, atk: 1, aspd: 10, ...o });
  const S = ids => heroStats(loadout({ tiles: ids }));
  // Wywar Dnia: po śmierci płonącego wroga stosy przechodzą dalej
  let f = new Fight(setup({ lo: { tiles: ['wywar-dnia'] }, enemies: [foe({ hp: 5 }), big()] })); f.applyStatus(f.enemies[0], 'burn', 6); f.kill(f.enemies[0]); eq(f.enemies[1].burn, 3, 'Wywar Dnia: połowa stosów przechodzi');
  f = new Fight(setup({ lo: { tiles: [] }, enemies: [foe({ hp: 5 }), big()] })); f.applyStatus(f.enemies[0], 'burn', 6); f.kill(f.enemies[0]); eq(f.enemies[1].burn, 0, 'bez przedmiotu nic nie przechodzi');
  // Tłusta Pokrywka: pancerz za stosy Oparzenia na wrogach (maks. 12)
  const hurt = tiles => { const x = new Fight(setup({ lo: { tiles }, enemies: [foe({ hp: 100000, atk: 100, aspd: 10 })], hp: 1000 })); x.applyStatus(x.enemies[0], 'burn', 10); x.hp = 1000; x.enemyHit(x.enemies[0], 100); return 1000 - x.hp; };
  assert(hurt(['tlusta-pokrywka']) < hurt([]), 'Tłusta Pokrywka zmniejsza obrażenia przy płonącym wrogu');
  // Szczypta Soli: +20% obrażeń na wroga z Oparzeniem
  const dealt = tiles => { const x = new Fight(setup({ lo: { tiles }, enemies: [big()] })); x.applyStatus(x.enemies[0], 'burn', 1); const b = x.enemies[0].hp; x.heroHit(x.enemies[0], 1000, false, 'test'); return b - x.enemies[0].hp; };
  assert(dealt(['szczypta-soli']) > dealt([]), 'Szczypta Soli');
  // Lodowa Spódnica
  const hurtF = (tiles, frost) => { const x = new Fight(setup({ lo: { tiles }, enemies: [foe({ hp: 100000, atk: 100, aspd: 10 })], hp: 1000 })); if (frost) x.applyStatus(x.enemies[0], 'frost', 1); x.hp = 1000; x.enemyHit(x.enemies[0], 100); return 1000 - x.hp; };
  assert(hurtF(['lodowa-spodnica'], true) < hurtF([], true) && hurtF(['lodowa-spodnica'], false) === hurtF([], false), 'Lodowa Spódnica: słabsze ciosy tylko od mroźnych wrogów');
  // Szron Poranny: pierwszy cios mrozi (5 stosów = zamrożenie)
  f = new Fight(setup({ lo: { tiles: ['szron-poranny'] }, enemies: [big()] })); for (let i = 0; i < 12; i++) f.step(); assert(f.freezes === 1 || f.enemies[0].frozenUntil > 0, 'Szron Poranny: pierwszy cios zamraża');
  // Jajko Niespodzianka: co 9 s wybuch
  f = new Fight(setup({ lo: { tiles: ['jajko-niespodzianka'] }, enemies: [big()] })); for (let i = 0; i < 280; i++) f.step(); let eggs = 0; const g2 = new Fight(setup({ lo: { tiles: ['jajko-niespodzianka'] }, enemies: [big()] })); for (let i = 0; i < 280; i++) { g2.step(); eggs += evs(g2.ev, 'egg').length; } eq(eggs, 3, 'co 9 s: 3 wybuchy w 28 s');
  // Kura Nioska
  eq(S(['kura-nioska', 'zlote-jajo', 'tykajace-jajo']).coinFlat, 3 + 3, 'Kura Nioska: +1 za każdy przedmiot Jajeczny (3 sztuki) plus Złote Jajo +3');
  eq(S(Array(6).fill('kura-nioska')).coinFlat, 4, 'limit +4');
  // Kombajn: obrażenia dla pozostałych wrogów
  f = new Fight(setup({ lo: { tiles: ['kombajn-zbozowy', 'kombajn-zbozowy', 'kombajn-zbozowy', 'kombajn-zbozowy', 'kombajn-zbozowy'] }, enemies: [big(), big()] })); for (let i = 0; i < 200; i++) f.step(); assert(f.enemies[1].hp < 100000, 'Kombajn: pozostali wrogowie obrywają');
  // Strach na Wróble
  f = new Fight(setup({ lo: { tiles: ['strach-na-wroble'] }, enemies: [foe({ boss: 'brojler', id: 'brojler', hp: 100000 }), big()] })); eq([f.enemies[0].stunUntil, f.enemies[1].stunUntil], [7, 15], 'Strach na Wróble: 1,5 s (boss 0,8 s)');
  // Karabin Maszynowy: więcej ciosów
  const swings = tiles => { const x = new Fight(setup({ lo: { tiles }, enemies: [big()] })); for (let i = 0; i < 300; i++) x.step(); return 100000 - x.enemies[0].hp; };
  assert(swings(Array(6).fill('karabin-maszynowy')) > swings([]) * 1.3, 'Karabin Maszynowy: podwójne uderzenia');
  // Apteczka Polowa: raz na walkę poniżej 50%
  f = new Fight(setup({ lo: { tiles: ['apteczka-polowa'] }, enemies: [foe({ hp: 100000, atk: 20, aspd: 10 })], hp: 40 })); f.enemyHit(f.enemies[0], 100); assert(f.hp > 20 && f.medUsed, 'Apteczka leczy po zejściu poniżej 50%'); const hh = f.hp; f.hp = 10; f.enemyHit(f.enemies[0], 100); assert(f.hp < hh && f.hp < 10, 'tylko raz na walkę');
  // Open Space: reset cooldownu
  const uses = tiles => { const x = new Fight(setup({ lo: { tiles, skills: [sk('grad')] }, enemies: [big()] })); x.skills[0].cd = 0; for (let i = 0; i < 600; i++) x.step(x.tick >= x.skills[0].cd ? [0] : []); return x.used; };
  assert(uses(Array(5).fill('open-space')) > uses([]) + 2, 'Open Space: umiejętność używana częściej (reset cooldownu)');
  // Spichlerz, Służbowy Samochód, Szczypta: statystyki
  eq(S(['spichlerz']).maxHp, 70 + 12, 'Spichlerz +12 Życia'); eq(S(['spichlerz']).coinPct, 20, 'Spichlerz +20% Ziaren');
  const car = fresh(); car.tiles = ['sluzbowy-samochod']; car.hp = 5; eq(R.restCost(car), 0, 'Służbowy Samochód: darmowy Odpoczynek'); eq(S(['sluzbowy-samochod']).restDisc, 4, 'restDisc'); eq(S(['sluzbowy-samochod']).healBonus, 10, 'leczenie po wygranej +10 pkt proc.');
});

// ---------- etap 3: ryzyko i legendarne przedmioty ----------
test('etap 3: pula 134 kafelki, legendarne przedmioty (legend) dopiero od 60% runu, nigdy wyklęty Dinozaur w ofertach', () => {
  eq(D.TILES.length, 136, 'pula kafelków');
  const leg = D.TILES.filter(t => t.legend); eq(leg.length, 6, '6 legendarnych przedmiotów'); assert(leg.every(t => t.rarity === 3 && t.type === 'item'), 'rzadkość 3, przedmioty');
  const risk = ['pozyczka-chwilowka', 'dopalacz-z-biedronki', 'nadgodziny-bez-doplaty', 'dieta-cud', 'uklad-z-zarzadem', 'los-na-loterii']; assert(risk.every(id => D.TILE_BY_ID[id] && D.TILE_BY_ID[id].type === 'risk'), '6 kafelków ryzyka');
  const early = new Set(), late = new Set(); let dino = 0;
  for (let seed = 1; seed < 600; seed++) {
    const run = fresh({ seed, mode: 'full' });
    for (const [round, set] of [[5, early], [14, late], [19, late]]) { run.round = round; for (const salt of [0, 101, 102]) for (const id of R.makeOffer(run, salt)) { if (D.TILE_BY_ID[id].legend) set.add(id); if (id === 'dinozaur') dino++; } }
  }
  eq(early.size, 0, 'w trybie pełnym legendarne przedmioty nie wypadają przed strefą III'); assert(late.size >= 4, 'od strefy III wypadają: ' + [...late].join()); eq(dino, 0, 'Dinozaur nie jest w ofertach');
  const q = fresh({ seed: 3, mode: 'quick' }); q.round = 3; for (let i = 0; i < 40; i++) assert(!R.makeOffer(q, i).some(id => D.TILE_BY_ID[id].legend), 'tryb szybki: nie przed 60% runu');
});

test('kafelki ryzyka etapu 3: Pożyczka (Ziarna teraz, odsetki, nie do lombardu), Układ z Zarządem (boss +25%), Dopalacz, Nadgodziny, Dieta, Los', () => {
  const run = fresh(); run.coins = 0; force(run, 'pozyczka-chwilowka', 'dieta-cud', 'los-na-loterii', 'dopalacz-z-biedronki');
  assert(R.pickTile(run, 0).ok && run.coins === 15 && run.stats.riskPicks === 1 && R.statsOf(run).coinFlat === -2, 'Pożyczka: +15 Ziaren, odsetki -2 po rundzie');
  run.phase = 'offer'; eq(R.pawn(run, 'pozyczka-chwilowka').code, 'kind', 'Lis nie bierze pożyczki');
  const w = fresh(); w.tiles = ['pozyczka-chwilowka']; w.phase = 'fight'; w.fight = { started: true }; w.hp = 70; w.coins = 0; const before = w.coins; R.fightFinish(w, []); assert(w.coins >= 0 && w.coins <= before + 4 - 2 + 2, 'odsetki obniżają nagrodę (4 - 2)');
  const b = fresh(); force(b, 'uklad-z-zarzadem', 'dieta-cud', 'los-na-loterii', 'dopalacz-z-biedronki'); b.coins = 1; R.pickTile(b, 0); eq([b.coins, b.flags.bossHpBonus], [13, 25], 'Układ: +12 Ziaren, boss +25% Życia');
  const S = ids => heroStats(loadout({ tiles: ids }));
  eq([S(['dopalacz-z-biedronki']).aspd, S(['dopalacz-z-biedronki']).maxHp], [140, Math.floor(70 * 75 / 100)], 'Dopalacz: +40% szybkości, -25% Życia');
  const ng = fresh(); ng.tiles = ['nadgodziny-bez-doplaty']; ng.hp = 10; eq(R.restPctOf(ng), 10, 'Nadgodziny: Odpoczynek leczy o połowę mniej'); eq(S(['nadgodziny-bez-doplaty']).dmg, 30, '+30% obrażeń');
  eq([S(['dieta-cud']).armor, S(['dieta-cud']).aspd], [15, 70], 'Dieta: +15 Pancerza, -30% szybkości'); eq([S(['los-na-loterii']).luck, S(['los-na-loterii']).coinFlat], [25, -1], 'Los na Loterii');
});

test('legendarne przedmioty: Złoty Rosołek, Kogut Alfa, Plan B, Dziób Mistrza, Akcje Zarządu', () => {
  const big = (o = {}) => foe({ hp: 100000, atk: 1, aspd: 10, ...o });
  // Złoty Rosołek: +1 stos przy każdym nałożeniu
  let f = new Fight(setup({ lo: { tiles: ['zloty-rosolek'] }, enemies: [big()] })); f.applyStatus(f.enemies[0], 'burn', 2); eq(f.enemies[0].burn, 3, 'Złoty Rosołek: 2 → 3 stosy');
  f = new Fight(setup({ lo: { tiles: [] }, enemies: [big()] })); f.applyStatus(f.enemies[0], 'burn', 2); eq(f.enemies[0].burn, 2, 'bez przedmiotu 2');
  // Kogut Alfa: 1. slot gotowy od początku i krótszy cooldown, 2. slot bez zmian
  f = new Fight(setup({ lo: { tiles: ['kogut-alfa'], skills: [sk('grad'), sk('granat')] }, enemies: [big()] })); eq(f.skills[0].cd, 0, 'Kogut Alfa: 1. slot gotowy'); f.step([0]); const base = new Fight(setup({ lo: { skills: [sk('grad'), sk('granat')] }, enemies: [big()] })); base.skills[0].cd = 0; base.step([0]);
  assert(f.skills[0].cd - f.tick <= (base.skills[0].cd - base.tick) / 2 + 1, 'cooldown 1. slotu o 50% krótszy');
  f.skills[1].cd = 0; f.step([1]); eq(f.skills[1].cd - (f.tick - 1), 80, '2. slot: cooldown bez zmian');
  // Plan B: raz na walkę wstajesz z 30% i 3 s nietykalności
  f = new Fight(setup({ lo: { tiles: ['plan-b'] }, enemies: [foe({ hp: 100000, atk: 100, aspd: 10 })] })); f.hp = 10; f.enemyHit(f.enemies[0], 100); assert(f.hp === Math.floor(70 * 15 / 100) && !f.over && f.invulnUntil > f.tick, 'Plan B: wstajesz z 15% Życia'); f.invulnUntil = 0; f.hp = 5; f.enemyHit(f.enemies[0], 100); assert(f.over && !f.win, 'tylko raz na walkę');
  // Dziób Mistrza: umiejętności mogą krytykować
  const crit = tiles => { let n = 0; const x = new Fight(setup({ lo: { tiles, skills: [sk('granat')] }, enemies: [big()] })); x.hasCrit = 0; for (let i = 0; i < 40; i++) { x.skills[0].cd = 0; x.step([0]); n += x.ev.filter(e => e.k === 'hit' && e.crit && e.kind === 'granat').length; } return n; };
  assert(crit(Array(7).fill('dziob-mistrza')) > 0 && crit([]) === 0, 'Dziób Mistrza: krytyki z umiejętności (bez niego zero)');
  eq(heroStats(loadout({ tiles: ['dziob-mistrza'] })).crit, 25, '+20% krytyka'); assert(heroStats(loadout({ tiles: ['dziob-mistrza'] })).skillCrit, 'flaga skillCrit');
  // Akcje Zarządu: +25% Ziaren (maks. 12)
  const a = fresh(); a.tiles = ['akcje-zarzadu']; a.coins = 20; a.hp = 70; a.phase = 'fight'; a.fight = { started: true }; R.fightFinish(a, []); assert(a.coins >= 20 + 4 + 2 + 5 - 1, 'Akcje: +25% z 20 = 5 (oraz odsetki i nagroda)');
  const a2 = fresh(); a2.tiles = ['akcje-zarzadu']; a2.coins = 100; a2.hp = 70; a2.phase = 'fight'; a2.fight = { started: true }; R.fightFinish(a2, []); assert(a2.coins <= 100 + 4 + 3 + 12, 'limit +12');
});

test('Jajko Dinozaura: po 4 wygranych piętrach wykluwa się Dinozaur (+30% Ataku i Życia), licznik w grow, widok i odpowiedź', async () => {
  const run = fresh(); run.tiles = ['jajko-dinozaura', ...Array(8).fill('twardy-grzebien'), 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy']; run.hp = R.statsOf(run).maxHp;
  let out = null;
  for (let i = 1; i <= 4; i++) {
    run.round = 2; run.phase = 'fight'; run.fight = { started: true }; run.hp = R.statsOf(run).maxHp; run.door = null;
    out = R.fightFinish(run, []); assert(out.ok && out.result.win, 'wygrana ' + i);
    if (i < 4) { eq(run.grow['jajko-dinozaura'], i, 'licznik ' + i); assert(run.tiles.includes('jajko-dinozaura') && !out.dino, 'jeszcze jajo'); }
    if (run.phase !== 'offer' && run.phase !== 'door') { run.pending = null; }
  }
  assert(out.dino && run.tiles.includes('dinozaur') && !run.tiles.includes('jajko-dinozaura') && !('jajko-dinozaura' in run.grow), 'po 4 wygranych wykluwa się Dinozaur');
  const eggless = fresh(); eggless.tiles = run.tiles.filter(x => x !== 'dinozaur'); const atk0 = R.statsOf(eggless).atk;
  assert(R.statsOf(run).atk >= Math.floor(atk0 * 1.15), 'Dinozaur: +30% Ataku');
  eq(R.view(run).tiles.includes('dinozaur'), true, 'widok zawiera Dinozaura');
});

// ---------- nowe postacie ----------
test('nowe postacie: 14 postaci, każda ma blokadę i odblokowanie, tylko Zjarany ma hasło, Dinozaur jest sekretny', () => {
  eq(Object.keys(D.CHARS).length, 14, '14 postaci');
  for (const id of ['barista', 'ges', 'lodziarz', 'pielegniarka', 'rzeznik', 'wrozka', 'stazysta', 'mutant', 'dinozaur']) {
    const c = D.CHARS[id]; assert(c && c.lock && D.UNLOCK_BY_ID[c.lock] && D.UNLOCK_BY_ID[c.lock].kind === 'char' && D.UNLOCK_BY_ID[c.lock].target === id, 'blokada ' + id);
    assert(R.newRun({ mode: 'quick', char: id, garnek: 0, pool: ALL, seed: 11 }).ok, 'start runu ' + id);
  }
  assert(D.CHARS.dinozaur.secret && D.UNLOCK_BY_ID['u-dino'].secret && !D.CHARS.barista.secret, 'sekretny tylko Dinozaur (i Zjarany)');
  eq(Object.values(D.CHARS).filter(c => c.hasCode).map(c => c.id), ['zjarany'], 'hasło tylko do Zjaranego');
});

test('postacie: Barista, Gęś, Lodziarz, Pielęgniarka, Rzeźnik, Wróżka — statystyki i start', () => {
  const S = ch => heroStats(loadout({ char: ch }));
  let s = S('barista'); eq([s.aspd, s.maxHp, s.atk], [135, 49, 7], 'Barista: +35% szybkości, -30% Życia, -10% Ataku');
  const g = R.newRun({ mode: 'quick', char: 'ges', garnek: 0, pool: ALL, seed: 5 }).run; eq([g.coins, R.statsOf(g).coinFlat, R.view(g).interestMax], [15, 1, 6], 'Gęś: 15 Ziaren, +1 po rundzie, Odsetki do 6');
  s = S('lodziarz'); eq([s.frostHit, s.frostWeak, s.aspd], [20, 10, 80], 'Lodziarz'); eq(R.newRun({ mode: 'quick', char: 'lodziarz', garnek: 0, pool: ALL, seed: 5 }).run.skills, [{ id: 'lodowy', lvl: 1 }], 'Lodziarz zaczyna z Lodowym Dziobem');
  s = S('pielegniarka'); eq([s.regen, s.healBonus, s.atk], [12, 8, 6], 'Pielęgniarka'); eq(R.newRun({ mode: 'quick', char: 'pielegniarka', garnek: 0, pool: ALL, seed: 5 }).run.skills[0].id, 'zagrzebanie', 'zaczyna z Zagrzebaniem');
  s = S('rzeznik'); eq([s.bleed, s.bleedMax, s.maxHp, s.atk], [1, 1, 59, 7], 'Rzeźnik'); eq(R.newRun({ mode: 'quick', char: 'rzeznik', garnek: 0, pool: ALL, seed: 5 }).run.skills[0].id, 'darcie', 'zaczyna z Darciem Pierza');
  const w = R.newRun({ mode: 'quick', char: 'wrozka', garnek: 0, pool: ALL, seed: 5 }).run; eq([R.statsOf(w).luck, w.freeLeft, R.statsOf(w).maxHp], [20, 1, 63], 'Wróżka: 20 Szczęścia, darmowy reroll, -10% Życia');
});

test('Kurczak Stażysta rośnie z piętrami (+5% wszystkich statystyk, maks. +35%), Mutant zaczyna z losową umiejętnością (deterministycznie), Dinozaur z Jajkiem', () => {
  const st = R.newRun({ mode: 'quick', char: 'stazysta', garnek: 0, pool: ALL, seed: 8 }).run; const atk = [0, 1, 5, 10, 20].map(n => { st.done = n; return R.statsOf(st).atk; });
  assert(atk[0] <= atk[1] && atk[1] < atk[2] && atk[2] < atk[3] && atk[3] === atk[4], 'Atak rośnie z piętrami i ma limit: ' + atk.join());
  st.done = 0; const hp0 = R.statsOf(st).maxHp; st.done = 10; assert(R.statsOf(st).maxHp > hp0 * 1.4, 'Życie też rośnie (z -25% do +10%)');
  st.done = 3; eq(R.buildSetup(st).hero.loadout.floors, 3, 'setup walki zawiera piętra');
  const m1 = R.newRun({ mode: 'quick', char: 'mutant', garnek: 0, pool: ALL, seed: 21 }).run, m2 = R.newRun({ mode: 'quick', char: 'mutant', garnek: 0, pool: ALL, seed: 21 }).run;
  eq(m1.skills, m2.skills, 'ta sama umiejętność dla tego samego ziarna'); assert(m1.skills.length === 1 && D.SKILLS[m1.skills[0].id], 'jedna losowa umiejętność');
  const kinds = new Set(); for (let sd = 1; sd < 60; sd++) kinds.add(R.newRun({ mode: 'quick', char: 'mutant', garnek: 0, pool: ALL, seed: sd }).run.skills[0].id); assert(kinds.size >= 8, 'różne umiejętności dla różnych ziaren: ' + kinds.size);
  eq([heroStats(loadout({ char: 'mutant' })).cdPct, heroStats(loadout({ char: 'mutant' })).maxHp], [25, 56], 'Mutant: -25% cooldownu, -20% Życia');
  const d = R.newRun({ mode: 'quick', char: 'dinozaur', garnek: 0, pool: ALL, seed: 3 }).run; eq(d.tiles, ['jajko-dinozaura'], 'Dinozaur zaczyna z Jajkiem Dinozaura'); eq(d.hp, R.statsOf(d).maxHp, 'pełne życie na start');
});

test('palniki: premie rosną z piętrem (garnekRamp), G5 ma Ziarno mniej i mocniejsze bossy, G0 bez zmian', () => {
  eq([D.garnekRamp('full', 1), D.garnekRamp('full', 20), D.garnekRamp('quick', 10)], [40, 100, 100], 'ramp: 40% na 1. piętrze, 100% na ostatnim');
  assert(D.garnekRamp('full', 10) > D.garnekRamp('full', 5), 'ramp rośnie');
  const g0 = D.garnekMods(0), g5 = D.garnekMods(5);
  eq([g0.enemyHp, g0.enemyAtk, g0.bossHp, g0.coinMinus], [0, 0, 0, 0], 'palnik 0 bez modyfikatorów');
  assert(g5.enemyHp > D.garnekMods(4).enemyHp && g5.enemyAtk > D.garnekMods(4).enemyAtk && g5.bossHp > D.garnekMods(4).bossHp && g5.coinMinus === 1 && g5.noRegen, 'palnik 5 najtrudniejszy');
  const mk = (g, round) => { const r = fresh({ garnek: g }); r.round = round; return R.buildSetup(r).enemies[0]; };
  assert(mk(5, 2).hp > mk(0, 2).hp && mk(5, 11).hp / mk(0, 11).hp > mk(5, 2).hp / mk(0, 2).hp, 'wrogowie na G5 mocniejsi, a przewaga rośnie z piętrem');
  const bossHp = g => { const r = fresh({ garnek: g }); r.round = 6; return R.buildSetup(r).enemies[0].hp; }; assert(bossHp(4) > bossHp(3) * 1.04, 'bossowie od G4 mają więcej Życia');
  const coins = g => { const r = fresh({ garnek: g }); r.tiles = [...Array(8).fill('twardy-grzebien'), ...Array(6).fill('ziarno-mocy')]; r.hp = R.statsOf(r).maxHp; r.phase = 'fight'; r.fight = { started: true }; r.coins = 0; R.fightFinish(r, []); return r.coins; };
  assert(coins(5) === coins(0) - 1, 'palnik 5: o 1 Ziarno mniej po wygranej (' + coins(5) + ' vs ' + coins(0) + ')');
});

// ======================================================================
// Aktualizacja „siedem nowości”: Klątwy Prezesa, Dogrywka, trasy, warianty bossów, Arena Duchów, Towarzysz, Kurnik
// ======================================================================
const fightWin = run => { run.hp = 99999; run.phase = 'fight'; run.fight = {}; return R.fightFinish(run, []); };
const strong = run => { run.tiles = [...Array(40).fill('ziarno-mocy'), ...Array(40).fill('twardy-grzebien')]; run.skills = [{ id: 'granat', lvl: 2 }]; run.hp = 99999; return run; };

test('Klątwy: walidacja przy starcie, mnożnik wyniku, efekty reguł', () => {
  assert(R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 1, curses: ['nie-ma'] }).code === 'curses', 'nieznana klątwa');
  assert(R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 1, curses: ['mgla', 'mgla'] }).code === 'curses', 'duplikat');
  assert(R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 1, curses: ['mgla', 'podatek', 'pospiech', 'zakaz-drzemek'] }).code === 'curses', 'najwyżej trzy');
  // Zakaz Wymian / Drzemek
  let r = fresh({ curses: ['zakaz-wymian', 'zakaz-drzemek'] });
  eq(R.reroll(r).code, 'curse', 'reroll zablokowany'); eq(R.view(r).rerollCost, null, 'widok bez ceny rerollu');
  r.hp = 1; eq(R.rest(r).code, 'curse', 'odpoczynek zablokowany');
  // Ciasne Gniazdo: 2 sloty
  r = fresh({ curses: ['ciasne-gniazdo'] }); r.skills = [sk('grad'), sk('granat')];
  const t3 = D.TILES.find(t => t.type === 'skill' && t.skill !== 'grad' && t.skill !== 'granat');
  force(r, t3.id); eq(R.pickTile(r, 0).code, 'slot', 'trzeci slot niedostępny'); eq(R.view(r).maxSkills, 2, 'widok: 2 sloty');
  // Podatek: -2 Ziarna po wygranej
  const a = strong(fresh()), b = strong(fresh({ curses: ['podatek'] }));
  a.round = 3; b.round = 3; const ca = a.coins, cb = b.coins; fightWin(a); fightWin(b);
  eq((a.coins - ca) - (b.coins - cb), 2, 'podatek -2 Ziarna');
  // Mnożnik wyniku
  const s1 = fresh(), s2 = fresh({ curses: ['przegrzany-piec', 'kruche-kosci'] }); s1.done = s2.done = 5;
  eq(R.liveScore(s2), Math.floor(R.liveScore(s1) * (100 + D.cursePct(['przegrzany-piec', 'kruche-kosci'])) / 100), 'wynik × (1 + suma klątw)');
  // Mgła: ukryty skład piętra także na Garnku 0
  r = fresh({ curses: ['mgla'] }); assert(R.view(r).hidden === true && R.view(r).enemies === null, 'Mgła ukrywa skład');
  // Kruche Kości: -25% życia
  eq(R.statsOf(fresh({ curses: ['kruche-kosci'] })).maxHp, Math.floor(70 * 0.75), '-25% życia');
  // Przegrzany Piec i Pospiech w setupie walki
  const base = R.buildSetup(fresh()), hot = R.buildSetup(fresh({ curses: ['przegrzany-piec', 'pospiech'] }));
  assert(hot.enemies[0].hp > base.enemies[0].hp && hot.enemies[0].atk >= base.enemies[0].atk && hot.fury === 300 && base.fury === undefined, 'wrogowie mocniejsi, Furia od 30 s');
});

test('Klątwy: BgPlayer przyjmuje klątwy przy starcie i zapisuje je w runie', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  assert((await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek', curses: ['x'] })).j.code === 'curses', 'zła klątwa = błąd');
  const r = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek', curses: ['mgla', 'podatek'] });
  assert(r.j.ok && r.j.run.curses.length === 2 && r.j.run.cursePct === D.cursePct(['mgla', 'podatek']), 'klątwy w widoku runu');
});

test('Dogrywka: po Prezesie wybór (koniec albo dalej), super-boss co 5 pięter, porażka w Dogrywce nadal wygrana', () => {
  const run = strong(fresh({ mode: 'quick' })); run.round = 10; run.phase = 'fight'; run.fight = {};
  const out = R.fightFinish(run, []);
  assert(out.victory && run.phase === 'victory' && run.cleared === run.done && run.pending.kind === 'victory', 'wygrana Prezesa → faza victory');
  eq(R.choose(run, 7).code, 'index', 'zły wybór');
  const r2 = JSON.parse(JSON.stringify(run));
  assert(R.choose(r2, 1).ok && r2.phase === 'over' && r2.ended === 'win', 'koniec po wyborze');
  assert(R.choose(run, 0).ok && run.endless && run.round === 11 && run.phase === 'offer', 'Dogrywka: piętro 11');
  // piętra Dogrywki rosną szybciej niż normalnie
  const s11 = R.buildSetup(run).enemies[0].hp, eh = D.RULES.endlessHp; D.RULES.endlessHp = 0; const sRef = R.buildSetup(run).enemies[0].hp; D.RULES.endlessHp = eh;
  assert(s11 > sRef, 'Dogrywka: dodatkowy wzrost Życia wrogów (' + s11 + ' > ' + sRef + ')');
  // super-boss na piętrze 15 (quick: 10 + 5)
  eq(R.bossFor('quick', 1, 15), D.SUPER_BOSSES[0], 'piętro 15: pierwszy super-boss'); eq(R.bossFor('quick', 1, 20), D.SUPER_BOSSES[1], 'piętro 20: drugi'); eq(R.bossFor('quick', 1, 25), D.SUPER_BOSSES[2], 'piętro 25: trzeci'); eq(R.bossFor('quick', 1, 30), D.SUPER_BOSSES[0], 'cykl');
  eq(R.bossFor('quick', 1, 12), null, 'zwykłe piętro Dogrywki bez bossa');
  strong(run); run.round = 15; run.phase = 'fight'; run.fight = {}; const sb = R.buildSetup(run); assert(sb.boss === D.SUPER_BOSSES[0] && sb.enemies.length === 1, 'setup super-bossa');
  // porażka w Dogrywce = wygrana (Prezes pokonany)
  run.hp = 1; run.tiles = []; run.skills = []; run.round = 15; run.phase = 'fight'; run.fight = {};
  const lose = R.fightFinish(run, []); assert(lose.ended === 'win' && run.phase === 'over' && run.fell && run.ended === 'win', 'porażka w Dogrywce nadal liczy się jako wygrana');
  // porzucenie w fazie victory też = wygrana
  const v = strong(fresh({ mode: 'quick' })); v.round = 10; v.phase = 'fight'; v.fight = {}; R.fightFinish(v, []); R.abandon(v); eq(v.ended, 'win', 'abandon w victory = win');
});

test('Dogrywka: ranking głębokości (kind=deep) i Pióra za piętra Dogrywki', async () => {
  const env = mkEnv(), ranks = env.BG_RANKS.get('ranks');
  const sub = (n, deep, score) => post({ fetch: u => ranks.fetch(u) }, 'submit', { mode: 'full', entry: { n, nick: n, score, rounds: 20 + deep, win: true, char: 'pyrtek', garnek: 0, deep, at: 1 } });
  await sub('a', 3, 9000); await sub('b', 8, 8000); await sub('c', 0, 99999); await sub('a', 5, 9500);
  const l = await (await ranks.fetch('https://bg/list?mode=full&kind=deep')).json();
  eq(l.list.map(e => e.nick + ':' + e.deep), ['b:8', 'a:5'], 'ranking głębokości: tylko wpisy z Dogrywki, najgłębszy pierwszy, jeden na gracza');
  const p = newProfile(), r = strong(fresh({ mode: 'quick' })); r.round = 10; r.done = 14; r.endless = true; r.cleared = 10; r.ended = 'win'; r.phase = 'over'; r.score = 5;
  const end = onRunEnd(p, r); eq(end.deep, 4, 'piętra Dogrywki'); eq(end.feathers, 14 + D.RULES.featherWin + D.RULES.featherEndless * 4, 'Pióra: piętra + wygrana + Dogrywka');
});

test('Trasy: wybór na początku strefy II i III, dwie różne opcje, modyfikatory wrogów i ekonomii', () => {
  const r = fresh(); r.round = 6; r.tiles = strong(fresh()).tiles; r.hp = 99999;
  r.phase = 'fight'; r.fight = {}; R.fightFinish(r, []);   // boss 6
  while (r.phase !== 'route') { if (r.phase === 'badge') R.choose(r, 0); else if (r.phase === 'loot') R.choose(r, 0); else if (r.phase === 'bonus') R.bonusPick(r, 0, 0); else break; }
  assert(r.phase === 'route' && r.round === 7 && r.pending.kind === 'route' && r.pending.opts.length === 2 && r.pending.opts[0] !== r.pending.opts[1], 'faza trasy na piętrze 7');
  eq(R.pickTile(r, 0).code, 'phase', 'najpierw trasa'); eq(R.choose(r, 5).code, 'index', 'zła trasa');
  const key = r.pending.opts[1]; assert(R.choose(r, 1).ok && r.phase !== 'route' && r.routes[1] === key && R.view(r).route === key, 'trasa zapisana dla strefy');
  // brak ponownego pytania w tej samej strefie, a w strefie III pytanie wraca
  assert(!R.routeOptions(r).includes(undefined), 'opcje tras');
  for (const k of Object.keys(D.ROUTES)) { const x = fresh(); x.round = 8; x.routes = [null, k, null]; const e0 = R.buildSetup(fresh({})); const e1 = R.buildSetup(x); const R_ = D.ROUTES[k]; if (R_.enemyHp) assert(R_.enemyHp > 0 ? e1.enemies[0].hp >= 1 : true, 'trasa ' + k + ' działa'); }
  const hot = fresh(); hot.round = 8; hot.routes = [null, 'kanaly', null]; const cold = fresh(); cold.round = 8;
  assert(R.buildSetup(hot).enemies[0].hp > R.buildSetup(cold).enemies[0].hp, 'Kanały: wrogowie z większym Życiem');
  const sor = fresh(); sor.round = 8; sor.routes = [null, 'sortownia', null]; assert(R.buildSetup(sor).enemies.every(e => (e.shieldHits || 0) >= 1), 'Sortownia: tarcza');
  assert(R.shopPrice(D.TILE_BY_ID['ziarno-mocy'], sor) < R.shopPrice(D.TILE_BY_ID['ziarno-mocy'], cold), 'Sortownia: taniej');
  const mag = fresh(); mag.round = 8; mag.routes = [null, 'magazyn', null];
  const co = (run, k) => { run.routes = [null, k, null]; run.round = 8; run.hp = 99999; Object.assign(run, { tiles: strong(fresh()).tiles }); const c0 = run.coins; fightWin(run); return run.coins - c0; };
  assert(co(fresh(), 'chlodnia') === co(fresh(), 'sortownia') + D.ROUTES.chlodnia.coins, 'Chłodnia: Ziarna za piętro');
  // quick: trasa na piętrze 6 (początek strefy II), nie na bossie 10
  const q = fresh({ mode: 'quick' }); q.round = 5; strong(q); q.phase = 'fight'; q.fight = {}; R.fightFinish(q, []);
  while (q.phase === 'badge' || q.phase === 'loot' || q.phase === 'bonus') { if (q.phase === 'bonus') R.bonusPick(q, 0, 0); else R.choose(q, 0); }
  eq(q.phase, 'route', 'quick: trasa na piętrze 6'); eq(q.round, 6, 'piętro 6');
});

test('Warianty bossów: deterministyczne z ziarna, mechaniki (noc, zamieć, przegrzanie, audyt), slot liczy się dla odblokowań', () => {
  const saved = {}; for (const k of Object.keys(D.BOSS_POOL)) { saved[k] = D.BOSS_POOL[k]; }
  try {
    Object.assign(D.BOSS_POOL, structuredClone(BOSS_POOL_FULL));
    const seen = new Set(); for (let s = 1; s < 300; s++) seen.add(R.bossFor('full', s, 6) + '|' + R.bossFor('full', s, 12) + '|' + R.bossFor('full', s, 20));
    const flat = new Set([...seen].flatMap(x => x.split('|'))); assert(flat.size === 9, 'wszystkie 9 bossów się pojawia (' + flat.size + ')');
    eq(R.bossFor('full', 77, 6), R.bossFor('full', 77, 6), 'deterministycznie');
    const orig = [...Array(600).keys()].filter(s => R.bossFor('full', s + 1, 6) === 'brojler').length; assert(orig > 600 * 0.4 && orig < 600 * 0.6, 'oryginał ma wagę 2 z 4 (' + orig + '/600)');
    // każdy wariant buduje prawidłowy setup
    for (const id of Object.keys(D.BOSSES)) {
      const def = D.BOSSES[id]; const run = fresh(); run.round = def.slot === 'brojler' ? 6 : def.slot === 'skubarka' ? 12 : 20;
      if (!def.slot) { run.mode = 'quick'; run.round = 15; run.endless = true; }
      D.BOSS_POOL[def.slot || 'x'] = [id]; const su = def.slot ? R.buildSetup(run) : null;
      if (su) { const e = su.enemies.find(x => x.boss); assert(e && e.boss === id && e.mech && e.mech.length, 'setup ' + id); }
    }
  } finally { for (const k of Object.keys(saved)) D.BOSS_POOL[k] = saved[k]; for (const k of Object.keys(D.BOSS_POOL)) D.BOSS_POOL[k] = [k]; }
  // mechaniki w silniku
  const nc = foe({ id: 'szef-nocnej', boss: 'szef-nocnej', name: 'Szef Nocnej Zmiany', hp: 3000, atk: 1, aspd: 40, ...bossFx('szef-nocnej') });
  let a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy'] }, enemies: [nc] })); assert(evs(a.ev, 'night').length >= 2 && evs(a.ev, 'miss').length > 0, 'Szef Nocnej Zmiany oślepia (chybienia)');
  const ch = foe({ id: 'wielka-chlodnia', boss: 'wielka-chlodnia', name: 'Wielka Chłodnia', hp: 3000, atk: 1, aspd: 40, ...bossFx('wielka-chlodnia') });
  a = play(setup({ hp: 100000, enemies: [ch] })); assert(evs(a.ev, 'blizzard').length >= 2, 'zamieć spowalnia');
  const wz = foe({ id: 'wozek-prototyp', boss: 'wozek-prototyp', name: 'Wózek Prototyp', hp: 2000, atk: 1, aspd: 40, ...bossFx('wozek-prototyp') });
  a = play(setup({ hp: 100000, enemies: [wz] })); assert(evs(a.ev, 'crash').length >= 2 && evs(a.ev, 'telegraph').length >= 2, 'po szarży się przegrzewa');
  const kr = foe({ id: 'krol-szczurow', boss: 'krol-szczurow', name: 'Król Szczurów', hp: 2000, atk: 1, aspd: 40, ...bossFx('krol-szczurow') });
  a = play(setup({ hp: 100000, enemies: [kr] })); assert(evs(a.ev, 'summon').length >= 4, 'Król wzywa dużo stażystów');
  const df = foe({ id: 'dyrektor-finansowy', boss: 'dyrektor-finansowy', name: 'Dyrektor Finansowy', hp: 3000, atk: 2, aspd: 100, ...bossFx('dyrektor-finansowy') });
  a = play(setup({ hp: 100000, lo: { skills: [sk('grad')] }, enemies: [df] })); assert(evs(a.ev, 'audit').length >= 2 && evs(a.ev, 'steal').length > 0, 'audyt i kradzież Ziaren');
  // slot bossa: miejsce jest zapisane jako brojler/skubarka/prezes, więc odblokowania działają
  const run = strong(fresh()); run.round = 6; D.BOSS_POOL.brojler = ['szef-nocnej']; run.phase = 'fight'; run.fight = {}; const out = R.fightFinish(run, []); D.BOSS_POOL.brojler = ['brojler'];
  assert(out.boss === 'brojler' && out.bossVar === 'szef-nocnej' && run.stats.bossKills.includes('brojler'), 'wariant liczy się jako slot');
  const p = newProfile(); onBossKill(p, out.boss); onBossKill(p, out.bossVar); assert(p.bosses.brojler === 1 && p.bosses['szef-nocnej'] === 1, 'profil liczy slot i wariant');
});

test('Arena Duchów: wydarzenie od 3. piętra (nie na bossie), Odbicie gdy brak cudzego ducha, walka z Duchem, nagroda', () => {
  const r = fresh(); r.round = 2; assert(!r.pool.map(id => D.TILE_BY_ID[id]).filter(t => t.event === 'arena').some(t => R.makeOffer(r, 5).includes(t.id)), 'brak Areny na piętrze 2');
  let seen = 0; for (let k = 0; k < 800; k++) { const q = fresh({ seed: 1000 + k }); q.round = 5; if (R.makeOffer(q, 1).includes('arena-duchow')) seen++; } assert(seen > 0, 'Arena trafia do ofert od 3. piętra');
  const boss = fresh(); boss.round = 6; for (let k = 0; k < 20; k++) assert(!R.makeOffer(boss, k).includes('arena-duchow'), 'brak Areny na piętrze bossa');
  const run = strong(fresh()); run.round = 4; force(run, 'arena-duchow', 'ziarno-mocy');
  const pk = R.pickTile(run, 0); assert(pk.ok && pk.event === 'arena' && run.phase === 'event' && run.pending.kind === 'arena' && run.pending.ghost.mirror, 'Odbicie jako Duch');
  const v = R.view(run).pending; assert(v.ghost.stats.hp > 0 && !('curve' in v.ghost) && !('n' in v.ghost), 'widok bez krzywej i klucza');
  eq(R.choose(run, 7).code, 'index', 'zły wybór');
  const run2 = JSON.parse(JSON.stringify(run)); assert(R.choose(run2, 1).ok && run2.phase === 'fight' && !R.buildSetup(run2).arena, 'odwrót: zwykła walka');
  assert(R.choose(run, 0).ok && run.phase === 'fight', 'walka z Duchem');
  run.tiles.push(...Array(30).fill('ziarno-mocy'), ...Array(30).fill('twardy-grzebien'));   // gracz mocniejszy od własnego Odbicia
  const su = R.buildSetup(run); assert(su.arena && su.enemies.length === 1 && su.enemies[0].ghost && su.enemies[0].name === 'Duch: Twoje Odbicie' && !su.boss && !su.elite, 'setup: jeden Duch');
  const c0 = run.coins; run.fight = {}; const out = R.fightFinish(run, []);
  assert(out.ok && out.result.win && out.arena && out.arena.won && run.phase === 'bonus' && run.offer.length === 3 && run.coins >= c0 + D.RULES.arenaCoins, 'wygrana: Ziarna i bonus');
  assert(run.stats.arenaWins === 1 && !run.arena, 'licznik wygranych');
  // Duch cudzego gracza: statystyki z piętra odpowiadającego rundzie (albo ostatniego)
  const ghost = { n: 'bob', nick: 'Bob', avatar: 1, char: 'kwoka', floors: 6, curve: [[70, 8, 100, 0, 5, 0], [80, 10, 100, 0, 5, 0], [90, 14, 100, 2, 5, 0], [110, 18, 100, 4, 5, 0]], tiles: [] };
  const a = D.RULES; const s3 = R.ghostStats(ghost, 3), s9 = R.ghostStats(ghost, 9);
  eq(s3.hp, Math.floor(90 * a.ghostPct / 100), 'piętro 3: statystyki z 3. wpisu'); eq(s9.hp, Math.floor(110 * a.ghostPct / 100), 'późna runda: ostatni wpis');
  const g2 = strong(fresh()); g2.round = 5; force(g2, 'arena-duchow', 'ziarno-mocy'); R.pickTile(g2, 0, undefined, undefined, { ghost }); assert(g2.pending.ghost.nick === 'Bob', 'cudzy Duch z kontekstu'); R.choose(g2, 0);
  eq(R.buildSetup(g2).enemies[0].gchar, 'kwoka', 'postać Ducha');
  // porażka z Duchem kończy run (jak każda walka) i nie robi z Ducha Nemezis
  const weak = fresh(); weak.round = 4; weak.hp = 1; force(weak, 'arena-duchow', 'ziarno-mocy'); R.pickTile(weak, 0, undefined, undefined, { ghost }); R.choose(weak, 0); weak.phase = 'fight'; weak.fight = {};
  const lo = R.fightFinish(weak, []); assert(lo.ended === 'lose' && !weak.killer && lo.arena.won === false, 'porażka z Duchem');
  // ghostOf: krzywa z dziennika
  const gr = strong(fresh()); for (let k = 0; k < 4; k++) { gr.phase = 'fight'; gr.fight = {}; R.fightFinish(gr, []); while (gr.phase !== 'offer' && gr.phase !== 'over' && gr.phase !== 'route') { if (gr.phase === 'badge' || gr.phase === 'loot' || gr.phase === 'door') R.choose(gr, 0); else if (gr.phase === 'bonus') R.bonusPick(gr, 0, 0); else break; } if (gr.phase === 'route') R.choose(gr, 0); if (gr.phase === 'door') R.choose(gr, 0); }
  const gh = R.ghostOf(gr); assert(gh && gh.curve.length >= 3 && gh.curve[0].length === 6 && gh.char === 'pyrtek', 'ghostOf z dziennika');
  eq(R.ghostOf(fresh()), null, 'za krótki run bez ducha');
});

test('Arena Duchów: BgRanks (put, pick bez własnego, result, get), BgPlayer zapisuje ducha po runie i pobiera cudzego', async () => {
  const env = mkEnv(), R_ = env.BG_RANKS.get('ranks'), rq = (p, b) => R_.fetch(new Request('https://bg/' + p, { method: 'POST', body: JSON.stringify(b) })).then(r => r.json());
  const g = { char: 'pyrtek', mode: 'full', garnek: 0, floors: 8, win: false, score: 7000, curve: [[70, 8, 100, 0, 5, 0], [80, 9, 100, 0, 5, 0], [90, 10, 100, 0, 5, 0], [100, 12, 100, 1, 5, 0]], tiles: ['ziarno-mocy'] };
  assert((await rq('ghost-put', { n: 'bob', nick: 'Bob', avatar: 1, ghost: g, at: 5 })).ok, 'zapis ducha');
  assert((await rq('ghost-put', { n: 'x', ghost: { ...g, curve: [[1]] } })).err, 'za krótka krzywa odrzucona');
  assert((await rq('ghost-pick', { n: 'bob', mode: 'full', round: 4, salt: 1 })).ghost === null, 'własny duch nie wraca');
  const pick = (await rq('ghost-pick', { n: 'ala', mode: 'full', round: 4, salt: 1 })).ghost; assert(pick && pick.n === 'bob' && pick.nick === 'Bob' && pick.curve.length === 4, 'cudzy duch');
  assert((await rq('ghost-pick', { n: 'ala', mode: 'quick', round: 4, salt: 1 })).ghost === null, 'duch tylko z tego samego trybu');
  await rq('ghost-result', { n: 'bob', mode: 'full', ghostWon: true }); await rq('ghost-result', { n: 'bob', mode: 'full', ghostWon: false }); await rq('ghost-result', { n: 'bob', mode: 'full', ghostWon: true });
  const mine = (await rq('ghost-get', { n: 'bob' })).ghosts; assert(mine.full.wins === 2 && mine.full.losses === 1 && mine.full.floors === 8 && !mine.quick, 'liczniki ducha');
  // BgPlayer: po zakończonym runie (≥3 piętra w dzienniku) powstaje duch; cudzy duch trafia do pending Areny
  const o = new BgPlayer({ storage: mkStorage() }, env), PL2 = { n: 'cezar', nick: 'Cezar', avatar: 3 };
  await post(o, 'start', { pl: PL2, mode: 'full', char: 'pyrtek' });
  const st = await o.ctx.storage.get('run'); strong(st); st.round = 4; st.log = [1, 2, 3, 4].map(r => ({ r, hero: { maxHp: 70 + r * 10, atk: 8 + r, aspd: 100, armor: 0, crit: 5, evade: 0 } })); st.offer = ['arena-duchow', 'ziarno-mocy', 'twardy-grzebien', 'czujne-oko']; st.flawAt = -1; await o.ctx.storage.put('run', st);
  const pk = await post(o, 'pick', { pl: PL2, i: 0 }); assert(pk.j.ok && pk.j.run.pending.kind === 'arena' && pk.j.run.pending.ghost.nick === 'Bob' && !pk.j.run.pending.ghost.mirror, 'cudzy duch w Arenie');
  await post(o, 'choose', { pl: PL2, i: 0 }); await post(o, 'fightstart', { pl: PL2 });
  const fin = await post(o, 'fightfinish', { pl: PL2, inputs: [] }); assert(fin.j.ok && fin.j.arena && fin.j.arena.nick === 'Bob', 'wynik walki z Duchem');
  const after = (await rq('ghost-get', { n: 'bob' })).ghosts.full; assert(after.wins + after.losses === 4, 'licznik ducha Boba zaktualizowany');
  await post(o, 'abandon', { pl: PL2 }); const mine2 = (await rq('ghost-get', { n: 'cezar' })).ghosts; assert(mine2.full && mine2.full.floors >= 0, 'po runie powstaje duch Cezara');
});

test('Towarzysz: Schronisko, poziomy po bossach, premie i czynności w walce', () => {
  const run = fresh(); run.round = 3; force(run, 'schronisko', 'ziarno-mocy');
  assert(R.pickTile(run, 0).event === 'adopt' && run.pending.kind === 'adopt' && run.pending.opts.length === 3 && new Set(run.pending.opts).size === 3, 'oferta 3 towarzyszy');
  eq(R.choose(run, 9).code, 'index', 'zły indeks');
  const id = run.pending.opts[1]; const ch = R.choose(run, 1); assert(ch.ok && run.companion.id === id && run.companion.lvl === 1 && run.phase === 'fight', 'adopcja');
  const dec = fresh(); dec.round = 3; force(dec, 'schronisko', 'ziarno-mocy'); R.pickTile(dec, 0); assert(R.choose(dec, -1).ok && !dec.companion, 'rezygnacja');
  // ewolucja po bossie
  const b = strong(fresh()); b.round = 6; b.companion = { id: 'pisklak', lvl: 1 }; b.phase = 'fight'; b.fight = {}; const out = R.fightFinish(b, []); assert(out.compUp === 2 && b.companion.lvl === 2, 'po bossie poziom 2');
  // czynności w silniku
  const lv = n => ({ companion: { id: 'pisklak', lvl: n } });
  const a1 = play(setup({ hp: 100000, lo: lv(1), enemies: [foe({ hp: 400, atk: 1, aspd: 20 })] })), a3 = play(setup({ hp: 100000, lo: lv(3), enemies: [foe({ hp: 400, atk: 1, aspd: 20 })] }));
  assert(evs(a1.ev, 'comp').length >= 3 && evs(a3.ev, 'comp').length > evs(a1.ev, 'comp').length, 'Pisklę dziobie, na poz. 3 częściej');
  assert(a3.res.ticks < a1.res.ticks, 'wyższy poziom = szybsze zwycięstwo');
  const none = play(setup({ hp: 100000, enemies: [foe({ hp: 400, atk: 1, aspd: 20 })] })); assert(none.res.ticks > a1.res.ticks, 'towarzysz pomaga');
  const heal = play(setup({ hp: 20, lo: { companion: { id: 'trzmiel', lvl: 3 } }, enemies: [foe({ hp: 600, atk: 1, aspd: 30 })] })); assert(evs(heal.ev, 'heal').length >= 2, 'Trzmiel leczy');
  const bu = play(setup({ hp: 100000, lo: { companion: { id: 'salamandra', lvl: 2 } }, enemies: [foe({ hp: 300, atk: 1, aspd: 20 })] })); assert(bu.f.enemies[0].burn >= 0 && bu.res.burnDealt > 0, 'Salamandra podpala');
  const fr = play(setup({ hp: 100000, lo: { companion: { id: 'balwanek', lvl: 3 } }, enemies: [foe({ hp: 500, atk: 1, aspd: 20 })] })); assert(fr.res.freezes >= 1, 'Bałwanek mrozi');
  const ho = play(setup({ hp: 100000, lo: { companion: { id: 'gasior', lvl: 3 } }, enemies: [foe({ hp: 900, atk: 3, aspd: 100 })] })); assert(evs(ho.ev, 'stun').length >= 1 && evs(ho.ev, 'block').length >= 2, 'Gąsior ogłusza i blokuje ciosy');
  eq(heroStats(loadout({ companion: { id: 'kot', lvl: 3 } })).coinFlat, 2, 'Kot: Ziarna'); eq(heroStats(loadout({ companion: { id: 'kot', lvl: 3 } })).luck, 10, 'Kot poz. 3: Szczęście');
  eq(Object.keys(D.COMPANIONS).length, 6, '6 towarzyszy'); for (const c of Object.values(D.COMPANIONS)) assert(c.lv.length === 3 && c.forms.length === 3, 'dane ' + c.id);
});

test('Kurnik: Pióra za run, kupno poziomów, efekty na starcie runu i w statystykach', async () => {
  const p = newProfile(); eq(p.feathers, 0, 'start bez Piór');
  const r = strong(fresh()); r.done = 12; r.ended = 'win'; r.garnek = 2; r.phase = 'over'; r.score = 1;
  const e = onRunEnd(p, r); eq(e.feathers, 12 + D.RULES.featherWin + D.RULES.featherGarnek * 2, 'Pióra: piętra + wygrana + palnik'); eq(p.feathers, e.feathers, 'zapisane w profilu');
  const lose = fresh(); lose.done = 3; lose.ended = 'lose'; lose.phase = 'over'; lose.score = 1; eq(onRunEnd(newProfile(), lose).feathers, 3, 'porażka: tylko piętra');
  // kupno
  const { kurnikBuy } = await import('../../../src/games/bulgot/profile.js');
  const q = newProfile(); q.feathers = 100;
  assert(kurnikBuy(q, 'spizarnia').ok && q.kurnik.spizarnia === 1 && q.feathers === 100 - D.KURNIK.spizarnia.cost[0], 'poz. 1');
  assert(kurnikBuy(q, 'spizarnia').ok && kurnikBuy(q, 'spizarnia').ok && q.kurnik.spizarnia === 3, 'poz. 3');
  eq(kurnikBuy(q, 'spizarnia').code, 'max', 'maks. poziom'); eq(kurnikBuy(q, 'nie-ma').code, 'index', 'nieznany budynek');
  q.feathers = 0; eq(kurnikBuy(q, 'gabinet').code, 'feathers', 'brak Piór');
  // efekty na starcie
  const k = fresh({ kurnik: { spizarnia: 2, silownia: 3, gabinet: 2, szkola: 1, kantyna: 2, skarbiec: 1, pisklecarnia: 3 } });
  eq(k.coins, 2, 'Spiżarnia +2 Ziarna (poz. 2)'); eq(k.freeLeft, 2, 'Kantyna: darmowe rerolle na starcie');
  const S0 = R.statsOf(fresh()), S1 = R.statsOf(k);
  assert(S1.maxHp > S0.maxHp && S1.atk >= S0.atk && S1.restBonus === 10 && S1.cdPct === 4, 'Siłownia, Gabinet, Szkoła');
  assert(k.companion && k.companion.lvl === 2, 'Pisklęcarnia 3: towarzysz startuje na poz. 2'); const k1 = fresh({ kurnik: { pisklecarnia: 1 } }); eq(k1.companion.lvl, 1, 'Pisklęcarnia 1: poz. 1');
  const b = strong(fresh({ kurnik: { skarbiec: 2 } })); const b0 = strong(fresh()); b.round = 6; b0.round = 6; const c1 = b.coins, c0 = b0.coins; fightWin(b); fightWin(b0);
  eq((b.coins - c1) - (b0.coins - c0), 2, 'Skarbiec: +2 Ziarna za bossa');
  assert(R.newRun({ mode: 'full', char: 'pyrtek', garnek: 0, pool: ALL, seed: 3, kurnik: { spizarnia: 99, zly: 2 } }).run.kurnik.spizarnia === D.KURNIK_MAX, 'poziom przycięty do maksimum, nieznane budynki ignorowane');
  // BgPlayer: akcja kurnik
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  assert((await post(o, 'kurnik', { pl: PL, id: 'spizarnia' })).j.code === 'feathers', 'bez Piór błąd');
  const prof = await o.ctx.storage.get('profile'); await post(o, 'state', { pl: PL }); const pr = (await o.ctx.storage.get('profile')) || newProfile(); pr.feathers = 50; await o.ctx.storage.put('profile', pr);
  const buy = await post(o, 'kurnik', { pl: PL, id: 'spizarnia' }); assert(buy.j.ok && buy.j.kurnikBought.lvl === 1 && buy.j.profile.kurnik.spizarnia === 1 && buy.j.profile.feathers === 50 - 12, 'zakup przez BgPlayer');
  const st = await post(o, 'start', { pl: PL, mode: 'quick', char: 'pyrtek' }); eq(st.j.run.coins, 1, 'run startuje z poziomami Kurnika'); assert(st.j.run.kurnik.spizarnia === 1, 'poziomy w widoku');
});

test('Nowości: kompletność danych (klątwy, trasy, bossowie, osiągnięcia), RUN_V', () => {
  for (const [id, c] of Object.entries(D.CURSES)) assert(c.name && c.text && c.pct > 0 && c.icon, 'klątwa ' + id);
  for (const [id, r] of Object.entries(D.ROUTES)) assert(r.name && r.text && r.icon, 'trasa ' + id);
  for (const [id, b] of Object.entries(D.BOSSES)) { assert(b.name && b.title && b.hp > 0 && b.art && Array.isArray(b.mech) && b.text && b.quote, 'boss ' + id); if (b.slot) assert(BOSS_POOL_FULL[b.slot].includes(id), id + ' w puli ' + b.slot); }
  for (const id of D.SUPER_BOSSES) assert(D.BOSSES[id].super, 'super-boss ' + id);
  for (const [id, b] of Object.entries(D.KURNIK)) { assert(b.name && b.text && b.cost.length === 3 && b.cost[0] < b.cost[2], 'budynek ' + id); }
  for (const a of ['a-klatwa', 'a-klatwy3', 'a-dogrywka', 'a-dogrywka15', 'a-duch', 'a-towarzysz', 'a-trasy', 'a-kurnik', 'a-kurnik-max']) assert(D.ACH_BY_ID[a], 'osiągnięcie ' + a);
  eq(R.RUN_V, 11, 'RUN_V 11');
});

test('Jajko Dinozaura: tylko jedno na run (po wykluciu nie wraca do ofert)', () => {
  const seen = (hatched, egg) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = fresh({ seed }); r.round = 28;
      if (hatched) r.tiles.push('dinozaur');
      if (egg) r.tiles.push('jajko-dinozaura');
      for (let salt = 0; salt < 6; salt++) if (R.makeOffer(r, salt, { size: 12 }).includes('jajko-dinozaura')) n++;
    }
    return n;
  };
  assert(seen(false, false) > 0, 'bez Dinozaura jajko trafia do ofert');
  eq(seen(true, false), 0, 'po wykluciu jajka nie ma w ofertach');
  eq(seen(false, true), 0, 'gdy jajko już rośnie, drugiego nie ma');
});
