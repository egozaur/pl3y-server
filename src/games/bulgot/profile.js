// Bulgot: profil gracza (Księga Kurnika): odblokowania, liczniki, najlepsze wyniki, Temperatura Garnka.
// Czyste funkcje na obiekcie `profile`; zapis robi BgPlayer.
import { STARTER_TILES, UNLOCKS, UNLOCK_BY_ID, MODES, RULES, KURNIK, KURNIK_MAX, KURNIK_MIN_STAZ, STAZ, stazCost, stazTitle, LEVEL_REWARDS, REWARD_BY_ID, SHOP, SOUPS, SOUP_BY_ID, CURSES, CHARS, TILE_BY_ID } from './data.js';
import { nemesisName } from './rules.js';
import { evaluateAch, completion } from './achievements.js';
import { ACHIEVEMENTS } from './data.js';
import { makeRng, mix, hash } from './rng.js';

export function newProfile() {
  return { v: 1, chars: ['pyrtek'], tiles: [], garnek: 0, best: {}, counters: { runs: 0, wins: 0, fox: 0 }, bosses: {}, flags: {}, seen: [], unlocked: [], ach: [], clears: {}, feathers: 0, kurnik: {},
    xp: 0, talons: 0, lvlPending: [], buffs: {}, wardrobe: { owned: [], eq: {} }, soups: {}, daily: null, dstreak: { last: '', n: 0 } };
}

// ---------- Staż (poziom konta w tle) ----------
// Poziom z sumy Nadgodzin: koszt wejścia na poziom n to stazCost(n) (data.js).
export function stazLevel(xp) {
  let l = 0, left = xp | 0;
  while (left >= stazCost(l + 1)) { left -= stazCost(l + 1); l++; }
  return { level: l, into: left, need: stazCost(l + 1) };
}
// Nadgodziny za zakończony run (jak Pióra, z limitem i z premią z nagrody „Praca po godzinach”).
export function xpFor(r) {
  const win = r.ended === 'win', deep = r.endless && r.cleared != null ? Math.max(0, r.done - r.cleared) : 0;
  let x = r.done + (win ? STAZ.winBonus + STAZ.garnekBonus * (r.garnek | 0) : 0) + 2 * deep;
  x = Math.min(STAZ.xpCap, x);
  if (r.buffs && r.buffs.xpPct) x = Math.round(x * (1 + r.buffs.xpPct / 100));
  return Math.max(0, x);
}
const rewardOpts = (p, lvl) => { const rr = makeRng(mix(hash(p.nick || ''), lvl, hash('staz'))), ids = LEVEL_REWARDS.map(r => r.id), out = []; while (out.length < 2) { const k = rr.pick(ids); if (!out.includes(k)) out.push(k); } return out; };
// Dolicza Nadgodziny; każdy nowy poziom daje Talony i czeka na wybór nagrody. Zwraca { gain, level, ups }.
export function addXp(p, gain) {
  const before = stazLevel(p.xp | 0).level;
  p.xp = (p.xp | 0) + gain;
  const after = stazLevel(p.xp).level, ups = [];
  p.lvlPending = p.lvlPending || [];
  for (let l = before + 1; l <= after; l++) { p.talons = (p.talons | 0) + STAZ.talons; p.lvlPending.push({ lvl: l, opts: rewardOpts(p, l) }); ups.push(l); }
  return { gain, level: after, ups };
}
// Wybór nagrody za najstarszy oczekujący poziom: i = 0 albo 1.
export function levelChoose(p, i) {
  const q = p.lvlPending && p.lvlPending[0];
  if (!q) return { err: 'Nie masz nagrody do odebrania.', code: 'none' };
  const id = q.opts[i], rw = REWARD_BY_ID[id];
  if (!rw) return { err: 'Nie ma takiej nagrody.', code: 'index' };
  const v = rw.v(q.lvl); p.buffs = p.buffs || {};
  if (id === 'piora') p.feathers = (p.feathers | 0) + v;
  else if (id === 'talon') p.talons = (p.talons | 0) + v;
  else if (id === 'nadgodziny') p.buffs.xpPct = Math.min(100, (p.buffs.xpPct | 0) + v);
  else if (id === 'prowiant') p.buffs.coins = (p.buffs.coins | 0) + v;
  else if (id === 'bon') p.buffs.rerolls = (p.buffs.rerolls | 0) + v;
  p.lvlPending.shift();
  return { ok: true, reward: id, lvl: q.lvl, v };
}
// Premie z nagród pobierane na start zwykłego runu (jednorazowe).
export function takeBuffs(p) { const b = p.buffs || {}; p.buffs = {}; return { coins: b.coins | 0, rerolls: b.rerolls | 0, xpPct: b.xpPct | 0 }; }

// ---------- Sklepik Zakładowy ----------
export function shopBuyItem(p, id) {
  const it = SHOP[id]; p.wardrobe = p.wardrobe || { owned: [], eq: {} };
  if (!it) return { err: 'Nie ma takiego towaru.', code: 'index' };
  if (p.wardrobe.owned.includes(id)) return { err: 'Już to masz.', code: 'owned' };
  if ((p.talons | 0) < it.cost) return { err: 'Za mało Talonów: potrzebujesz ' + it.cost + '.', code: 'talons' };
  p.talons -= it.cost; p.wardrobe.owned.push(id); p.wardrobe.eq[it.slot] = id;   // kupione od razu zakładasz
  return { ok: true, id, cost: it.cost };
}
export function wearItem(p, id, on) {
  const it = SHOP[id]; p.wardrobe = p.wardrobe || { owned: [], eq: {} };
  if (!it || !p.wardrobe.owned.includes(id)) return { err: 'Tego nie masz.', code: 'owned' };
  if (on) p.wardrobe.eq[it.slot] = id; else if (p.wardrobe.eq[it.slot] === id) delete p.wardrobe.eq[it.slot];
  return { ok: true, id, on: !!on };
}

// ---------- Księga Rosołów ----------
// Rosół z zakończonego (wygranego) runu: pierwszy pasujący przepis wg kolejności w SOUPS.
export function soupOf(r) {
  if (r.ended !== 'win') return null;
  const st = r.stats || {}, deep = r.endless && r.cleared != null ? Math.max(0, r.done - r.cleared) : 0;
  const tags = {};
  for (const id of r.tiles || []) { const t = TILE_BY_ID[id]; if (t && t.tags) for (const g of t.tags) tags[g] = (tags[g] || 0) + 1; }
  const top = Object.entries(tags).filter(([g]) => SOUPS.some(s => s.tag === g)).sort((a, b) => b[1] - a[1])[0];
  const CHK = {
    nieskonczony: () => deep >= 5, piekielny: () => (r.garnek | 0) >= 4, zakazany: () => (r.curses || []).length >= 2, 'ostatniego-tchu': () => !!st.lowWin,
    'bez-skazy': () => !!st.bossFlawless, rozrzutnika: () => (st.buys | 0) >= 10, skapca: () => (r.coins | 0) >= 60, kompana: () => !!r.companion && r.companion.lvl >= 3,
  };
  for (const s of SOUPS) {
    if (s.kind === 'special' && CHK[s.id] && CHK[s.id]()) return s.id;
    if (s.kind === 'tag' && top && top[1] >= 4 && top[0] === s.tag) return s.id;
    if (s.kind === 'char' && s.char === r.char) return s.id;
  }
  return 'domowy';
}
export function recordSoup(p, id, score) {
  p.soups = p.soups || {};
  const e = p.soups[id] || (p.soups[id] = { n: 0, best: 0 }), isNew = e.n === 0;
  e.n++; if (score > e.best) e.best = score;
  return { id, isNew, n: e.n };
}

// ---------- Dyżur dnia ----------
// Wspólny dla wszystkich run dnia: ten sam tryb, postać, ziarno, startowa pula kafelków i jedna Klątwa. Jedno podejście na dzień.
export const dailyKey = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(now));
export function dailyOf(date) {
  const seed = hash('dyzur:' + date) >>> 0, rr = makeRng(mix(seed, 7)), ids = Object.keys(CURSES).filter(c => c !== 'zakaz-wymian');
  return { date, seed, mode: 'quick', char: 'pyrtek', garnek: 0, curses: [rr.pick(ids)] };
}
export const dailyYesterday = date => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
// Widok dla klienta: dzisiejszy dyżur i stan gracza (czy już był, wynik, seria).
export function dailyView(p, now) {
  const date = dailyKey(now), d = dailyOf(date), mine = p.daily && p.daily.date === date ? p.daily : null;
  const streak = p.dstreak && (p.dstreak.last === date || p.dstreak.last === dailyYesterday(date)) ? p.dstreak.n : 0;
  return { date, mode: d.mode, char: d.char, curses: d.curses, used: !!mine, active: !!(mine && mine.status === 'active'), score: mine ? mine.score | 0 : 0, rounds: mine ? mine.rounds | 0 : 0, win: !!(mine && mine.win), streak };
}
// Koniec dyżuru: wynik, seria dni i Talony. Zwraca { talons, streak }.
export function onDailyEnd(p, r) {
  const date = r.daily, win = r.ended === 'win';
  p.daily = { date, status: 'done', used: true, score: r.score | 0, rounds: r.done | 0, win };
  p.dstreak = p.dstreak || { last: '', n: 0 };
  p.dstreak.n = p.dstreak.last === dailyYesterday(date) ? p.dstreak.n + 1 : (p.dstreak.last === date ? p.dstreak.n : 1);
  p.dstreak.last = date;
  const talons = (r.done > 0 ? 1 : 0) + (win ? 2 : 0) + (p.dstreak.n >= 7 ? 2 : p.dstreak.n >= 3 ? 1 : 0);
  p.talons = (p.talons | 0) + talons;
  return { talons, streak: p.dstreak.n };
}

// Pula kafelków dostępnych w nowym runie.
export const poolFor = p => [...STARTER_TILES, ...p.tiles];

// Warunki odblokowań. p = profil, r = bieżący run (może być null).
const CHECKS = {
  'u-kwoka': p => !!p.flags.winFull,
  'u-kaczor': (p, r) => !!r && r.stats.riskPicks >= 5,
  'u-indor': p => !!p.flags.winQuick,
  'u-420': (p, r) => !!r && (r.stats.earned || 0) >= RULES.u420,   // Zjarany Kurczak: łącznie zdobyte Ziarna w jednym runie
  'u-barista': (p, r) => !!r && !!r.stats.v2 && r.stats.fastWin !== undefined && r.stats.fastWin < 10,
  'u-ges': (p, r) => !!r && r.stats.maxCoins >= 200,
  'u-lodziarz': (p, r) => !!r && (r.stats.freezes || 0) >= 8,
  'u-pielegniarka': (p, r) => !!r && !!r.stats.lowWin,
  'u-rzeznik': p => (p.bosses.skubarka || 0) > 0,
  'u-wrozka': (p, r) => !!r && (r.stats.badges || 0) >= 3,
  'u-stazysta': p => p.counters.runs - p.counters.wins >= 5,
  'u-mutant': (p, r) => !!r && (r.stats.muts || 0) >= 3,
  'u-dino': (p, r) => !!r && !!r.stats.dino,
  'u-gigachad': (p, r) => !!r && r.stats.maxHit >= 100,
  'u-jajeczko': p => p.counters.runs >= 10,
  'u-krypto': (p, r) => !!r && r.stats.maxCoins >= 150,
  'u-alkoholik': p => p.counters.runs - p.counters.wins >= 10,
  'u-wegan': p => !!p.flags.winQuick && !!p.flags.winFull,
  'u-baba': (p, r) => !!r && r.stats.maxCoins >= 80,
  'u-influencer': (p, r) => !!r && (r.stats.badges || 0) >= 5,
  'u-skibidi': (p, r) => !!r && (r.stats.skillUses || 0) >= 100,
  'u-emeryt': (p, r) => !!r && r.mode === 'full' && r.stats.maxRound >= 15,
  'u-sigma': (p, r) => !!r && r.stats.bossKills.length >= 3,
  'u-sanepid': p => (p.bosses.brojler || 0) > 0,
  'u-wanda': (p, r) => !!r && !!r.stats.hatched && r.stats.hatched.length > 0,
  'u-zwiazkowiec': (p, r) => !!r && (r.stats.chains || 0) >= 1,
  'u-pacyfista': (p, r) => !!r && (r.stats.skillUses || 0) >= 60,
  'u-koniczyna': (p, r) => !!r && r.stats.maxCoins >= 100,
  'u-unik': p => (p.bosses.brojler || 0) > 0,
  'u-zagrzebanie': (p, r) => !!r && r.stats.lowWin,
  'u-gniazdo': (p, r) => !!r && r.mode === 'full' && r.stats.maxRound >= 10,
  'u-siewnik': p => !!p.flags.winQuick,
  'u-okulary': (p, r) => !!r && r.stats.maxHit >= 150,
  'u-szklane': p => p.counters.fox >= 3,
  'u-skrzynka': p => p.counters.runs >= 5,
  'u-pasza': p => (p.bosses.skubarka || 0) > 0,
  'u-hazard': p => !!p.flags.loseRich,
  'u-garnek': (p, r) => !!r && (r.stats.maxBurn || 0) >= 250,
  'u-szron': (p, r) => !!r && (r.stats.freezes || 0) >= 8,
  'u-premiakw': (p, r) => !!r && !!r.stats.richBoss,
  'u-kontrakt': (p, r) => !!r && (r.stats.badges || 0) >= 3,
  'u-kontra': (p, r) => !!r && !!r.stats.tankWin,
  'u-premia': (p, r) => !!r && r.stats.maxCoins >= 40,
  'u-egzekucja': (p, r) => !!r && (r.stats.muts || 0) > 0,
};

// Sprawdza wszystkie odblokowania; zwraca listę świeżo odblokowanych wpisów UNLOCKS.
export function evaluate(p, r) {
  const fresh = [];
  if (r && r.stats.hatched) for (const id of r.stats.hatched) { p.recipes = p.recipes || []; if (!p.recipes.includes(id)) p.recipes.push(id); }
  if (r && r.stats.reactions) for (const id of r.stats.reactions) { p.reactions = p.reactions || []; if (!p.reactions.includes(id)) p.reactions.push(id); }
  for (const u of UNLOCKS) {
    if (p.unlocked.includes(u.id)) continue;
    const ok = CHECKS[u.id];
    if (u.kind === 'char' && CHARS[u.target] && CHARS[u.target].retired) continue;   // wycofane postacie nie odblokowują się już
    if (ok && ok(p, r)) {
      p.unlocked.push(u.id);
      if (u.kind === 'char' && !p.chars.includes(u.target)) p.chars.push(u.target);
      if (u.kind === 'tile' && !p.tiles.includes(u.target)) p.tiles.push(u.target);
      fresh.push(u);
    }
  }
  return fresh;
}

// Pokonany Nemezis znika z profilu.
export function onNemesisBeaten(p) { p.nemesis = null; p.counters.nemesisKills = (p.counters.nemesisKills || 0) + 1; }

// Wywoływane po rozstrzygnięciu walki z bossem.
export function onBossKill(p, bossId) { p.bosses[bossId] = (p.bosses[bossId] || 0) + 1; }

// Kurnik jest otwarty od 20. poziomu Stażu; wcześniej gracz widzi budynki, ale nic nie kupuje i nic nie działa.
export const kurnikOpen = p => stazLevel(p.xp | 0).level >= KURNIK_MIN_STAZ;
// Jednorazowa bramka (przy wczytaniu profilu): kto nie dobił do 20. poziomu, traci dotychczasowe ulepszenia (Pióra zostają, bez zwrotu).
// Kopia w `kurnikLegacy` jest tylko zapasem na wypadek zmiany decyzji; żaden kod jej nie czyta. Zwraca true, gdy profil się zmienił.
export function kurnikGate(p) {
  p.flags = p.flags || {};
  if (p.flags.kurnikGate) return false;
  p.flags.kurnikGate = true;
  if (!kurnikOpen(p) && Object.keys(p.kurnik || {}).some(k => (p.kurnik[k] | 0) > 0)) { p.kurnikLegacy = p.kurnik; p.kurnik = {}; if (p.counters) p.counters.kurnikBuys = 0; }
  return true;
}
// Kupno kolejnego poziomu budynku za Pióra. Zwraca { ok, id, lvl, cost } albo { err, code }.
export function kurnikBuy(p, id) {
  const B = KURNIK[id];
  if (!B) return { err: 'Nie ma takiego budynku.', code: 'index' };
  if (!kurnikOpen(p)) return { err: 'Kurnik odblokuje się na ' + KURNIK_MIN_STAZ + '. poziomie Stażu.', code: 'locked' };
  p.kurnik = p.kurnik || {};
  const lvl = p.kurnik[id] | 0;
  if (lvl >= KURNIK_MAX) return { err: 'Ten budynek ma już maksymalny poziom.', code: 'max' };
  const cost = B.cost[lvl];
  if ((p.feathers | 0) < cost) return { err: 'Za mało Piór: potrzebujesz ' + cost + '.', code: 'feathers' };
  p.feathers -= cost; p.kurnik[id] = lvl + 1;
  p.counters.kurnikBuys = (p.counters.kurnikBuys || 0) + 1;
  return { ok: true, id, lvl: lvl + 1, cost };
}

// Koniec runu: liczniki, najlepszy wynik, kolejny poziom Garnka, Pióra do Kurnika. Zwraca { newBest, garnekUnlocked, feathers }.
export function onRunEnd(p, r) {
  p.counters.runs++;
  if (r.stats.fox) p.counters.fox++;
  const win = r.ended === 'win';
  if (win) {
    p.counters.wins++;
    if (r.mode === 'full') p.flags.winFull = true;
    if (r.mode === 'quick') p.flags.winQuick = true;
    if (!r.daily) { p.clears = p.clears || {}; p.clears[r.mode + ':' + r.char + ':' + (r.garnek | 0)] = true; }
  } else if (r.coins > 30) p.flags.loseRich = true;
  // Awans Wroga: wróg, który zakończył run, zostaje Nemezis (a Nemezis, który wygrał znowu, awansuje wyżej).
  if (!win && r.killer && !r.daily) {
    if (r.killer.nemesis && p.nemesis) { p.nemesis.lvl = (p.nemesis.lvl || 1) + 1; p.counters.nemesisWins = (p.counters.nemesisWins || 0) + 1; }
    else if (r.killer.next) p.nemesis = r.killer.next;
  }
  let garnekUnlocked = false;
  if (win && !r.daily && r.garnek === p.garnek && p.garnek < 5) { p.garnek++; garnekUnlocked = true; }
  const prev = p.best[r.mode];
  const newBest = !r.daily && r.done > 0 && (!prev || r.score > prev.score);
  if (newBest) p.best[r.mode] = { score: r.score, rounds: r.done, win, char: r.char, garnek: r.garnek };
  for (const id of r.tiles) if (!p.seen.includes(id)) p.seen.push(id);
  // Pióra: ukończone piętra + premia za wygraną (z palnikiem) + piętra Dogrywki.
  const deep = r.endless && r.cleared != null ? Math.max(0, r.done - r.cleared) : 0;
  const feathers = r.done + (win ? RULES.featherWin + RULES.featherGarnek * (r.garnek | 0) : 0) + RULES.featherEndless * deep;
  p.feathers = (p.feathers | 0) + feathers; p.counters.feathers = (p.counters.feathers || 0) + feathers;
  if (deep > (p.counters.deepest || 0)) p.counters.deepest = deep;
  const staz = addXp(p, xpFor(r));   // Staż: Nadgodziny za run
  const sid = soupOf(r), soup = sid ? recordSoup(p, sid, r.score | 0) : null;   // Księga Rosołów
  const daily = r.daily ? onDailyEnd(p, r) : null;
  return { newBest, garnekUnlocked, feathers, deep, prevBest: prev ? prev.score : 0, staz, soup, daily };
}

// Osiągnięcia sprawdzane po zakończeniu runu (profil już zaktualizowany przez onRunEnd). Zwraca świeżo zdobyte.
export const evaluateAchievements = (p, r) => evaluateAch(p, r);

export function markSeen(p, ids) { for (const id of ids) if (!p.seen.includes(id)) p.seen.push(id); }

// Publiczny widok profilu (dla klienta).
export function publicProfile(p) {
  return {
    nick: p.nick, avatar: p.avatar || 0, chars: p.chars, tiles: p.tiles, garnek: p.garnek, best: p.best,
    counters: p.counters, bosses: p.bosses, seen: p.seen, unlocked: p.unlocked, ach: p.ach || [], clears: p.clears || {}, completion: completion(p), recipes: p.recipes || [], reactions: p.reactions || [],
    nemesis: p.nemesis ? { ...p.nemesis, name: nemesisName(p.nemesis) } : null, feathers: p.feathers | 0, kurnik: p.kurnik || {}, kurnikOpen: kurnikOpen(p), kurnikNeed: KURNIK_MIN_STAZ,
    staz: { ...stazLevel(p.xp | 0), xp: p.xp | 0, title: stazTitle(stazLevel(p.xp | 0).level), talons: p.talons | 0 },
    lvlPending: p.lvlPending && p.lvlPending[0] ? { lvl: p.lvlPending[0].lvl, opts: p.lvlPending[0].opts, left: p.lvlPending.length } : null,
    wardrobe: p.wardrobe || { owned: [], eq: {} }, buffs: p.buffs || {}, soups: p.soups || {}, casino: p.casino || null,
    // Ukryte odblokowania (secret) nie zdradzają warunku, dopóki gracz ich nie zdobędzie.
    locks: UNLOCKS.filter(u => !p.unlocked.includes(u.id)).map(u => ({ id: u.id, kind: u.kind, target: u.target, secret: !!u.secret, text: u.secret ? '???' : u.text })),
    modes: Object.keys(MODES),
  };
}
