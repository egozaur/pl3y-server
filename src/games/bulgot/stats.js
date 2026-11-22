// Bulgot: liczenie statystyk bohatera z postaci i kafelków. Czysta funkcja, bez losowości.
// loadout = { char, tiles: [id...], skills: [{id,lvl}], coins, bonusAtk, noRegen, grow: {id: n}, flawed: [{id, flaw, on}], decree };
// opt.off = indeks kafelka wyłączonego (Skubanie).
import { CHARS, TILE_BY_ID, MILESTONES, MILESTONE_EVERY, BADGES, FLAWS, RULES } from './data.js';

// Okólnik „Wyjazd Integracyjny”: każdy zaczęty zestaw liczy się o 1 sztukę więcej.
export function setCounts(tileIds, decree) {
  const c = {};
  for (const id of tileIds) { const t = TILE_BY_ID[id]; if (!t) continue; for (const st of (t.sets || (t.set ? [t.set] : []))) c[st] = (c[st] || 0) + 1; }
  if (decree === 'integracja') for (const k of Object.keys(c)) c[k]++;
  return c;
}

export function heroStats(loadout, opt = {}) {
  const ch = CHARS[loadout.char] || CHARS.pyrtek, b = ch.base;
  const acc = {};
  const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
  for (const f of ch.fx) add(f.k, f.v);
  const ids = loadout.tiles.filter((_, i) => i !== opt.off);
  const has = id => ids.includes(id);
  for (const id of ids) { const t = TILE_BY_ID[id]; if (t && t.fx) for (const f of t.fx) add(f.k, f.v); }
  for (const b of (loadout.badges || [])) { const d = BADGES[b]; if (d) for (const f of d.fx) add(f.k, f.v); }
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
  if ((sc.rambo || 0) >= 2) add('atkPct', 20);
  if ((sc.zbozowe || 0) >= 2) add('coinPct', 10);
  const rs = sc.rosolowe || 0, chl = sc.chlodnicze || 0, kp = sc.korpo || 0;
  if (rs >= 2) add('burnPct', 25);
  if (rs >= 3) add('burnHit', 100);
  if (rs >= 4) add('startBurn', 3);
  if (chl >= 2) add('frostSlow', 4);
  if (chl >= 3) add('shatter', 80);
  if (chl >= 4) add('startFrost', 2);
  if (kp >= 2) add('restDisc', 2);
  if (kp >= 3) add('buyDisc', 25);
  if (kp >= 4) add('interest', 10);

  const all = acc.allPct || 0;
  const atk = Math.floor((b.atk + (acc.atkFlat || 0)) * (100 + (acc.atkPct || 0) + all) / 100);
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
    egg: has('jajko-na-twardo') ? 60 : has('tykajace-jajo') ? ((sc.jajeczne || 0) >= 2 ? 60 : 80) : 0,   // co ile ticków wybucha Tykające Jajo
    eggAll: !!acc.eggAll, eggBurn: acc.eggBurn || 0, bleedStacks: acc.bleedStacks || 1, revivePct: acc.revivePct || 40, reviveBurn: acc.reviveBurn || 0,
    eggHeal: (sc.jajeczne || 0) >= 3 ? 3 : 0,
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
    freeReroll: acc.freeReroll || 0, noSteal: !!acc.noSteal, bossCoins: acc.bossCoins || 0, restDisc: acc.restDisc || 0, buyDisc: acc.buyDisc || 0, interest: acc.interest || 0,
    shred: acc.shred || 0,
    // Etap 2: nowe efekty przedmiotów (sim.js)
    burnSpread: acc.burnSpread || 0, burnArmor: acc.burnArmor || 0, vsBurn: acc.vsBurn || 0, frostWeak: Math.min(75, acc.frostWeak || 0), firstFrost: acc.firstFrost || 0,
    surprise: acc.surprise || 0, cleave: Math.min(100, acc.cleave || 0), scare: acc.scare || 0, double: Math.min(100, acc.double || 0), medkit: acc.medkit || 0, skillReset: Math.min(60, acc.skillReset || 0),
    // wady (Wadliwa Partia)
    selfBurn: acc.selfBurn || 0, restHalf: !!acc.restHalf, furyBlast: acc.furyBlast || 0,
    okrzyk: (sc.rambo || 0) >= 3,
    revive: has('gniazdo-zapasowe') || has('feniks-z-rosolu'),
    coinFlat: acc.coinFlat || 0,
    coinPct: acc.coinPct || 0,
    sets: sc,
  };
}
