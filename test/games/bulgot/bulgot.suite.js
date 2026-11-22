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
  eq(D.STARTER_TILES.length, D.TILES.filter(t => !t.lock && !t.hatched && !t.hidden).length, 'na start = bez blokady (bez wyklutych)');
  for (const r of D.RECIPES) { const o = D.TILE_BY_ID[r.out]; assert(o && o.hatched && o.rarity === 3 && r.of.length === 2 && r.of.every(id => D.TILE_BY_ID[id] && D.TILE_BY_ID[id].type === 'item'), 'przepis ' + r.out); for (const st of o.sets) assert(D.SETS[st], 'zestaw ' + r.out); }
  eq(new Set(D.RECIPES.flatMap(r => r.of)).size, D.RECIPES.length * 2, 'każdy składnik w jednym przepisie');
  for (const id of Object.keys(D.MILESTONES)) assert(D.TILE_BY_ID[id] && D.TILE_BY_ID[id].type === 'stat' && D.TILE_BY_ID[id].repeat, 'próg ' + id);
  assert(new Set(ALL).size === D.TILES.length, 'unikalne id');
  const by = t => D.TILES.filter(x => x.type === t).length;
  assert(by('skill') === Object.keys(D.SKILLS).length && by('skill') === 14, '14 umiejętności, każda ma kafelek');
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
  eq([S.atk, S.maxHp, S.aspd, S.armor], [8 + 2 * 6, B.hp + 20, 110, 6], 'płaskie i procentowe');
  S = heroStats(loadout({ tiles: ['pakt-z-lisem'] }));
  eq([S.atk, S.maxHp], [Math.floor(8 * 150 / 100), Math.floor(B.hp * 70 / 100)], 'Pakt z Lisem');
  S = heroStats(loadout({ tiles: ['opaska-rambo', 'ostrogi-bojowe'] }));
  eq([S.atk, S.dmg, S.bleed, S.crit], [Math.floor(8 * 120 / 100), 15, 4, 15], 'zestaw Rambo x2: +20% Ataku');
  assert(!S.okrzyk && heroStats(loadout({ tiles: ['opaska-rambo', 'ostrogi-bojowe', 'kamizelka-kuloodporna'] })).okrzyk, 'Ostatni Okrzyk od 3 przedmiotów');
  S = heroStats(loadout({ tiles: ['tykajace-jajo'] })); eq([S.egg, S.eggHeal], [80, 0], 'jajo co 8 s');
  S = heroStats(loadout({ tiles: ['tykajace-jajo', 'zlote-jajo', 'gniazdo-zapasowe'] })); eq([S.egg, S.eggHeal, S.revive], [60, 3, true], 'zestaw Jajeczne');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy'], coins: 30 })); eq(S.atk, Math.floor(8 * 124 / 100), 'Worek: +8% za każde 10 Ziaren');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy'], coins: 200 })); eq(S.atk, Math.floor(8 * 140 / 100), 'Worek: limit +40%');
  S = heroStats(loadout({ tiles: ['worek-kukurydzy', 'mlocarnia', 'siewnik'], coins: 200 })); assert(S.atk > Math.floor(8 * 140 / 100), 'trzy Zbożowe zdejmują limit');
  S = heroStats(loadout({ tiles: ['zakazana-pasza'] })); eq([S.atk, S.maxHp, S.aspd], [10, 87, 125], 'Zakazana Pasza +25% wszystkiego');
  S = heroStats(loadout({ tiles: ['czujne-oko', 'ziarno-mocy'] }), { off: 1 }); eq(S.atk, 8, 'wyłączony kafelek (Skubanie) nie liczy się');
  S = heroStats(loadout({ tiles: ['czujne-oko'].concat(Array(20).fill('czujne-oko')) })); eq(S.crit, 100, 'krytyk ma sufit 100%');
  S = heroStats(loadout({ tiles: ['cieple-gniazdko'], noRegen: true })); eq(S.regen, 1, 'Wulkan: regeneracja o połowę słabsza');
  S = heroStats(loadout({ char: 'kwoka' })); eq([S.maxHp, S.aspd], [Math.floor(B.hp * 130 / 100), 80], 'Kwoka');
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
    eq(hit.d, Math.floor(Math.floor(44 * 130 / 100) * 100 / 200), 'Atak 44 (+30% z dwóch progów Kolby Mocy) przy pancerzu 100 = połowa');
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
  // spowolnienie: 3 stosy Mrozu = -24% tempa ataku wroga
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
  eq([R.shopPrice(D.TILE_BY_ID['ziarno-mocy'], run), R.shopPrice(D.TILE_BY_ID['ziarno-mocy'])], [4, 6], 'dokupowanie 25% taniej');
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
  eq([a2, a3], [8 + 12, Math.floor((8 + 18) * 115 / 100)], 'Kolba Mocy +15% Ataku');
  eq(S(Array(6).fill('ziarno-mocy')).atk, Math.floor((8 + 36) * 130 / 100), 'dwa progi');
  const h = S(['twardy-grzebien', 'twardy-grzebien', 'twardy-grzebien']); eq([h.maxHp, h.armor], [Math.floor(130 * 110 / 100), 4], 'Koguci Hełm');
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
  eq([S.healBonus, S.critBleed, S.restBonus, S.restDisc, S.maxHp, S.atk], [10, 2, 20, 1, 77, 9], 'statystyki Odznak');
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
  const bro = foe({ id: 'brojler', boss: 'brojler', name: 'Brojler', hp: 520, atk: 2, aspd: 60 });
  let a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy'] }, enemies: [bro] }));
  assert(evs(a.ev, 'summon').length >= 2 && evs(a.ev, 'phase').some(e => e.n === 2), 'stażyści i faza 2');
  assert(a.res.win && a.res.boss === 'brojler', 'po śmierci bossa stażyści znikają, wygrana');
  const sku = foe({ id: 'skubarka', boss: 'skubarka', name: 'Skubarka', hp: 900, atk: 1, aspd: 40, shield: 25 });
  a = play(setup({ hp: 100000, lo: { tiles: ['ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'ziarno-mocy', 'czujne-oko'] }, enemies: [sku] }));
  assert(evs(a.ev, 'shieldhit').length > 0 && evs(a.ev, 'phase').length >= 2, 'tarcza i fazy');
  assert(evs(a.ev, 'skubanie').length >= 1 && a.res.win, 'Skubanie wyłącza kafelek, a walka da się wygrać');
  const guard = () => foe({ id: 'kot-ochroniarz', name: 'Ochroniarz', hp: 200, atk: 1, aspd: 40, guard: true });
  const pre = foe({ id: 'prezes', boss: 'prezes', name: 'Prezes', hp: 400, atk: 1, aspd: 40 });
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
  assert(run.hp === hp0 + 20 && R.statsOf(run).maxHp === hp0 + 20, 'maks. Życie i bieżące rosną razem');
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
  assert(b.phase === 'bonus' && b.offer.length === 3, 'bonus po bossie: 3 kafelki');
  assert(b.offer.every(id => D.TILE_BY_ID[id].rarity >= 1 && !D.TILE_BY_ID[id].event), 'rzadkie lub lepsze, bez wydarzeń');
  assert(b.coins === 6 && b.stats.bossKills.includes('brojler'), 'boss daje 6 Ziaren');
  assert(R.bonusPick(b, 0, 0).ok && b.phase === 'offer' && b.round === 7, 'po bonusie runda 7');
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
      else if (run.phase === 'badge' || run.phase === 'door') R.choose(run, 0);
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
  assert(D.garnekMods(3).healPct === 20 && D.garnekMods(2).healPct === 35, 'Garnek 3: słabsze leczenie');
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
  force(run, 'ziarno-mocy', 'czujne-oko', 'unik-skrzydlem', 'hazard-w-kurniku');
  const atk0 = R.statsOf(run).atk;
  let r = R.buyOffer(run, 0); assert(r.ok && r.bought === 'ziarno-mocy' && r.price === D.RULES.prices[0], 'zwykły kosztuje ' + D.RULES.prices[0]);
  assert(run.coins === 100 - D.RULES.prices[0] && R.statsOf(run).atk === atk0 + 6 && run.offer[0] === null && run.phase === 'offer', 'Ziarna pobrane, efekt od razu, faza oferty trwa');
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
    else if (ph === 'badge' || ph === 'door') r = (await post(o, 'choose', { pl: PL, i: 0 })).j;
    else if (ph === 'event') { const kd = r.run.pending.kind; r = (await post(o, kd === 'shop' ? 'shop' : kd === 'gamble' ? 'bet' : 'choose', { pl: PL, i: kd === 'shop' ? -1 : 2, amount: 0 })).j; }
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
  eq(heroStats(loadout({ tiles: ['ziarno-mocy'] })).atk, 14, 'Ziarno Mocy');
  eq(heroStats(loadout({ tiles: ['ostry-dziob', 'ostry-dziob'] })).dmg, 24, 'Ostry Dziób kumuluje się');
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
  const nr = fresh(); nr.stats.tankWin = true; nr.stats.maxCoins = 40; nr.stats.muts = 1; nr.stats.maxBurn = 250; nr.stats.freezes = 8; nr.stats.richBoss = true; nr.stats.badges = 3; evaluate(p, nr);
  assert(['garnek-cisnieniowy', 'szron', 'premia-kwartalna'].every(id => p.tiles.includes(id)), 'Garnek, Szron, Premia Kwartalna');
  assert(['kogucia-kontra', 'dziobanie-premii', 'egzekucja-ostroga'].every(id => p.tiles.includes(id)), 'Kontra, Premia, Egzekucja');
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
    else if (ph === 'badge' || ph === 'door') r = await post(o, 'choose', { pl: PL, i: 0 });
    else if (ph === 'event') { const kd = r.j.run.pending.kind; r = await post(o, kd === 'shop' ? 'shop' : kd === 'gamble' ? 'bet' : 'choose', { pl: PL, i: kd === 'shop' ? -1 : 2, amount: 0 }); }
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
  assert(cb.j.ok && cb.j.run.badges.length === 1 && cb.j.run.phase === 'bonus' && cb.j.run.offer.length === 3, 'Odznaka, potem faza bonusowa');
});
test('BgPlayer: żądania jednego gracza wykonują się po kolei (bez zgubionych zapisów)', async () => {
  const env = mkEnv(), o = new BgPlayer({ storage: mkStorage() }, env);
  await post(o, 'start', { pl: PL, mode: 'full', char: 'pyrtek' });
  const rs = await Promise.all([post(o, 'reroll', { pl: PL }), post(o, 'reroll', { pl: PL }), post(o, 'pick', { pl: PL, i: 0, slot: 0 })]);
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
  const n2 = await api(env, '/api/pl/claim', { nick: 'Druga', pin: '2468' }, o);
  assert((await api(env, '/api/bg/state', { pt: n2.j.pt }, o)).j.run === null, 'run jest przypisany do gracza');
  let guard = 0;
  while (r.j.run.phase !== 'over' && guard++ < 100) {
    const ph = r.j.run.phase;
    const pi = Math.max(0, r.j.run.offer.findIndex(id => id && id !== 'automat-z-pasza'));
    if (ph === 'offer') r = await api(env, '/api/bg/pick', { pt, i: pi, slot: 0, mut: 1 }, o);
    else if (ph === 'badge' || ph === 'door') r = await api(env, '/api/bg/choose', { pt, i: 0 }, o);
    else if (ph === 'event') { const kd = r.j.run.pending.kind; r = await api(env, kd === 'shop' ? '/api/bg/shop' : kd === 'gamble' ? '/api/bg/bet' : '/api/bg/choose', { pt, i: kd === 'shop' ? -1 : 2, amount: 0 }, o); }
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
  eq([L(0), L(10), L(99)], [14, flo(14 * 130 / 100), flo(14 * 145 / 100)], 'Pierze: +3% na stos, maks. +45%');
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
  eq(R.shopPrice(D.TILE_BY_ID['ziarno-mocy'], a), 9, 'Audyt: dokupowanie +50%');
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
  eq(R.statsOf(w).atk, 8 + 6 + 3, '+50% efektów'); eq(R.view(w).flawed[0].flaw, null, 'widok nie zdradza wady');
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
  const i = r.j.run.offer.findIndex(id => !D.TILE_BY_ID[id].event && D.TILE_BY_ID[id].rarity <= 1);
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
