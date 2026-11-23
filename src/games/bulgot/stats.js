// Bulgot: liczenie statystyk bohatera z postaci i kafelków. Czysta funkcja, bez losowości.
// loadout = { char, tiles: [id...], skills: [{id,lvl}], coins, bonusAtk, noRegen, grow: {id: n}, flawed: [{id, flaw, on}], decree, companion: {id,lvl}, kurnik: {budynek: poziom}, curses: [id] };
// opt.off = indeks kafelka wyłączonego (Skubanie).
import { CHARS, TILES, TILE_BY_ID, MILESTONES, MILESTONE_EVERY, BADGES, FLAWS, RULES, COMPANIONS, SET_LINKS } from './data.js';

// Okólnik „Wyjazd Integracyjny”: każdy zaczęty zestaw liczy się o 1 sztukę więcej.
export function setCounts(tileIds, decree) {
  const c = {};
  for (const id of tileIds) { const t = TILE_BY_ID[id]; if (!t) continue; for (const st of (t.sets || (t.set ? [t.set] : []))) c[st] = (c[st] || 0) + 1; }
  if (decree === 'integracja') for (const k of Object.keys(c)) c[k]++;
  return c;
}

// Znaczniki żywiołów z przedmiotów (każda sztuka) i umiejętności (każda raz): { ogien: 3, lod: 1, ... }.
let SKILL_TAGS = null;
export function elemCounts(tileIds, skills) {
  if (!SKILL_TAGS) { SKILL_TAGS = {}; for (const t of TILES) if (t.type === 'skill' && t.skill) SKILL_TAGS[t.skill] = t.tags || []; }
  const c = {};
  for (const id of tileIds) { const t = TILE_BY_ID[id]; if (t) for (const g of (t.tags || [])) c[g] = (c[g] || 0) + 1; }
  for (const s of (skills || [])) for (const g of (SKILL_TAGS[s.id] || [])) c[g] = (c[g] || 0) + 1;
  return c;
}
// Stan powiązań zestawów i żywiołów (SET_LINKS): met = oba warunki spełnione, fixed = konflikt zdjęty mediatorem, on = działa.
export function activeLinks(tileIds, skills, sc) {
  const ec = elemCounts(tileIds, skills);
  const cnt = k => (k.startsWith('set:') ? sc[k.slice(4)] : ec[k.slice(4)]) || 0;
  return SET_LINKS.map(L => {
    const na = cnt(L.a), nb = cnt(L.b), met = na >= L.need && nb >= L.need;
    const fixed = met && L.kind === 'conflict' && (L.fix || []).some(f => tileIds.includes(f));
    return { id: L.id, kind: L.kind, na, nb, met, fixed, on: met && !fixed };
  });
}

export function heroStats(loadout, opt = {}) {
  const ch = CHARS[loadout.char] || CHARS.pyrtek, b = ch.base;
  const acc = {};
  const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
  for (const f of ch.fx) add(f.k, f.v);
  if (ch.perFloor) add('allPct', Math.min(ch.perFloorMax || 60, ch.perFloor * (loadout.floors || 0)));   // Kurczak Stażysta: rośnie z każdym wygranym piętrem
  const ids = loadout.tiles.filter((_, i) => i !== opt.off);
  const has = id => ids.includes(id);
  for (const id of ids) { const t = TILE_BY_ID[id]; if (t && t.fx) for (const f of t.fx) add(f.k, f.v); }
  for (const b of (loadout.badges || [])) { const d = BADGES[b]; if (d) for (const f of d.fx) add(f.k, f.v); }
  // Towarzysz (stałe premie poziomu), Kurnik (trwałe ulepszenia) i Klątwa „Kruche Kości”.
  const co = loadout.companion && COMPANIONS[loadout.companion.id];
  if (co) for (const f of (co.lv[Math.min(3, Math.max(1, loadout.companion.lvl | 0)) - 1].fx || [])) add(f.k, f.v);
  const ku = loadout.kurnik || {};
  if (ku.silownia) { add('hpPct', ku.silownia); add('atkPct', ku.silownia); }
  if (ku.gabinet) add('restBonus', 5 * ku.gabinet);
  if (ku.szkola) add('cdPct', 4 * ku.szkola);
  if ((loadout.curses || []).includes('kruche-kosci')) add('hpPct', -25);
  // Wadliwa Partia: kafelek z wadą ma o flawBoost% mocniejsze dodatnie efekty; wada działa dopiero po ujawnieniu (on).
  for (const w of (loadout.flawed || [])) {
    if (!has(w.id)) continue;
    const t = TILE_BY_ID[w.id];
    if (t && t.fx) for (const f of t.fx) if (f.v > 0) add(f.k, Math.max(1, Math.floor(f.v * RULES.flawBoost / 100)));
    if (w.on && FLAWS[w.flaw]) for (const f of FLAWS[w.flaw].fx) add(f.k, f.v);
  }
  // Kafelki rosnące (licznik w loadout.grow).
  const gr = id => Math.min(TILE_BY_ID[id].grow.max, (loadout.grow || {})[id] || 0);
  if (has('pierze-weterana')) add('atkPct', TILE_BY_ID['pierze-weterana'].grow.per * gr('pierze-weterana'));
  if (has('trofeum-z-pior')) add('hpFlat', TILE_BY_ID['trofeum-z-pior'].grow.per * gr('trofeum-z-pior'));
  if (has('skarbonka-piskleca')) add('coinFlat', 1 + gr('skarbonka-piskleca'));
  const sc = setCounts(ids, loadout.decree);
  // progi statystyk (co 3 kopie)
  const cnt = {}; for (const id of ids) cnt[id] = (cnt[id] || 0) + 1;
  for (const [id, m] of Object.entries(MILESTONES)) { const n = Math.floor((cnt[id] || 0) / MILESTONE_EVERY); if (n) for (const f of m.fx) add(f.k, f.v * n); }

  // Przedmioty z logiką zależną od runu.
  if (has('worek-kukurydzy')) {
    const pct = 8 * Math.floor((loadout.coins || 0) / 10);
    add('atkPct', (sc.zbozowe || 0) >= 3 ? pct : Math.min(40, pct));
  }
  if (has('siewnik')) add('atkFlat', loadout.bonusAtk || 0);
  if (has('kura-nioska')) add('coinFlat', Math.min(4, sc.jajeczne || 0));   // Kura Nioska: +1 Ziarno za każdy przedmiot Jajeczny (maks. 4)
  // Powiązania zestawów i żywiołów (SET_LINKS): konflikty i synergie.
  const lk = {}; for (const l of activeLinks(ids, loadout.skills, sc)) if (l.on) lk[l.id] = true;
  let rs = sc.rosolowe || 0, chl = sc.chlodnicze || 0;
  const kp = sc.korpo || 0, rb = sc.rambo || 0, zb = sc.zbozowe || 0, je = sc.jajeczne || 0;
  if (lk['ogien-lod']) { rs = Math.min(rs, 3); chl = Math.min(chl, 3); add('szokMult', 100); }   // Ogień kontra Lód: bez progów 4 i 6
  if (lk['rambo-korpo']) add('atkPct', -10);
  if (lk['ogien-jajo']) add('eggBurn', 1);
  if (lk['trucizna-krew']) add('feverPlus', 20);
  if (lk['lod-krew']) add('brittleCut', 10);
  if (lk['zboze-jajo']) add('coinFlat', 1);
  if (lk['zboze-rambo']) add('armor', Math.min(15, Math.floor((loadout.coins || 0) / 10)));
  if (lk['ogien-krew']) add('burnBleed', 25);
  if (rb >= 2) add('atkPct', 20);
  if (zb >= 2) add('coinPct', 10);
  if (rs >= 2) add('burnPct', 25);
  if (rs >= 3) add('burnHit', 100);
  if (rs >= 4) add('startBurn', 3);
  if (chl >= 2) add('frostSlow', 4);
  if (chl >= 3) add('shatter', 80);
  if (chl >= 4) add('startFrost', 2);
  if (kp >= 2) add('restDisc', 2);
  if (kp >= 3) add('buyDisc', 25);
  if (kp >= 4) add('interest', 10);
  // progi 4 i 6 pozostałych zestawów oraz Nadwyżka (każda sztuka ponad 4)
  if (zb >= 4 && has('siewnik')) add('atkFlat', loadout.bonusAtk || 0);
  if (zb >= 6) add('hpPct', Math.min(30, 2 * Math.floor((loadout.coins || 0) / 10)));
  if (rb >= 4) { add('crit', 10); add('okrzykN', 1); }
  if (rb >= 6) add('volley', 1);
  if (je >= 6) add('coinFlat', 2);
  if (rs >= 6) { add('burnPct', 50); add('burnMax', 3); }
  if (chl >= 6) add('vsCold', 25);
  if (kp >= 6) { add('cdPct', 15); add('interestPlus', 3); }
  const xs = n => Math.max(0, n - 4);
  add('coinPct', 3 * xs(zb)); add('dmg', 2 * xs(rb)); add('coinFlat', Math.min(3, xs(je)));
  add('burnPct', 3 * xs(rs)); add('startFrost', Math.min(3, xs(chl))); add('freeReroll', Math.floor(xs(kp) / 2));
  const eggBase = has('jajko-na-twardo') ? 60 : has('tykajace-jajo') ? (je >= 2 ? 60 : 80) : 0;
  let egg = eggBase;
  if (egg && je >= 4) egg = Math.floor(egg * 75 / 100);
  if (egg && lk['jajo-lod']) egg = Math.floor(egg * 120 / 100);

  const all = acc.allPct || 0;
  const atk = Math.round((b.atk + (acc.atkFlat || 0)) * (100 + (acc.atkPct || 0) + all) / 100);   // zaokrąglenie: małe premie procentowe nie giną przy niskim Ataku
  const maxHp = Math.max(1, Math.floor((b.hp + (acc.hpFlat || 0)) * (100 + (acc.hpPct || 0) + all) / 100));
  const aspd = Math.max(20, Math.floor(b.aspd * (100 + (acc.aspdPct || 0) + all) / 100));
  const armor = Math.max(0, Math.floor((b.armor + (acc.armor || 0)) * (100 + all) / 100));
  const crit = Math.min(100, Math.floor((b.crit + (acc.crit || 0)) * (100 + all) / 100));
  const evade = Math.min(75, Math.floor((b.evade + (acc.evade || 0)) * (100 + all) / 100));
  const regen = Math.floor(Math.floor((b.regen + (acc.regen || 0)) * (100 + all) / 100) * (loadout.noRegen ? 50 : 100) / 100);   // Garnek 5: regeneracja o połowę słabsza

  return {
    maxHp, atk, aspd, armor, crit, evade, regen,
    critMult: b.critMult + (acc.critMult || 0),
    dmg: b.dmg + (acc.dmg || 0),
    luck: b.luck + (acc.luck || 0),
    egg,   // co ile ticków wybucha Tykające Jajo
    eggAll: !!acc.eggAll, eggBurn: acc.eggBurn || 0, bleedStacks: acc.bleedStacks || 1, revivePct: acc.revivePct || 40, reviveBurn: acc.reviveBurn || 0,
    eggHeal: je >= 6 ? 6 : je >= 3 ? 3 : 0,
    smoke: acc.smoke || 0,   // Zjarany Kurczak: co tyle ticków Chmura Dymu (0 = brak)
    bleed: acc.bleed || 0,
    // efekty statusowe: szansa nałożenia przy zwykłym ataku (%), moc i czas trwania
    bleedMax: acc.bleedMax || 0, burnHit: Math.min(100, acc.burnHit || 0), frostHit: Math.min(100, acc.frostHit || 0), poisonHit: Math.min(100, acc.poisonHit || 0),
    burnPct: acc.burnPct || 0, poisonPct: acc.poisonPct || 0, burnMax: acc.burnMax || 0, stDur: acc.stDur || 0, freezePct: acc.freezePct || 0,
    frostNeed: acc.frostNeed || 0, shatter: acc.shatter || 0, spreadPct: acc.spreadPct || 0, burnHeal: acc.burnHeal || 0,
    pressure: acc.pressure || 0, vsCold: acc.vsCold || 0, frostThorns: acc.frostThorns || 0, frostSlow: acc.frostSlow || 0, eggPoison: acc.eggPoison || 0,
    firstReady: !!acc.firstReady, overtime: acc.overtime || 0, healBonus: acc.healBonus || 0, critBleed: acc.critBleed || 0, restBonus: acc.restBonus || 0, parasol: acc.parasol || 0,
    startBurn: acc.startBurn || 0, startFrost: acc.startFrost || 0, cdPct: Math.min(50, acc.cdPct || 0),
    // ekonomia (liczona w rules.js)
    freeReroll: acc.freeReroll || 0, noSteal: !!acc.noSteal, bossCoins: acc.bossCoins || 0, restDisc: acc.restDisc || 0, buyDisc: acc.buyDisc || 0, interest: lk['zboze-korpo'] ? Math.floor((acc.interest || 0) / 2) : (acc.interest || 0),
    shred: acc.shred || 0,
    // Etap 2: nowe efekty przedmiotów (sim.js)
    burnSpread: acc.burnSpread || 0, burnArmor: acc.burnArmor || 0, vsBurn: acc.vsBurn || 0, frostWeak: Math.min(75, acc.frostWeak || 0), firstFrost: acc.firstFrost || 0,
    allStatus: acc.allStatus || 0, alphaCd: Math.min(70, acc.alphaCd || 0), planB: !!acc.planB, skillCrit: !!acc.skillCrit, bigInterest: acc.bigInterest || 0,
    surprise: acc.surprise || 0, cleave: Math.min(100, acc.cleave || 0), scare: acc.scare || 0, double: Math.min(100, acc.double || 0), medkit: acc.medkit || 0, skillReset: Math.min(60, acc.skillReset || 0),
    // wady (Wadliwa Partia)
    selfBurn: acc.selfBurn || 0, restHalf: !!acc.restHalf, furyBlast: acc.furyBlast || 0,
    okrzyk: rb >= 3, okrzykN: 1 + (acc.okrzykN || 0), volley: !!acc.volley,
    szokMult: acc.szokMult || 0, feverPlus: acc.feverPlus || 0, brittleCut: acc.brittleCut || 0, burnBleed: acc.burnBleed || 0, interestPlus: acc.interestPlus || 0,
    revive: has('gniazdo-zapasowe') || has('feniks-z-rosolu'),
    coinFlat: acc.coinFlat || 0,
    coinPct: acc.coinPct || 0,
    sets: sc, links: lk,
  };
}
