// Bulgot: liczenie statystyk bohatera z postaci i kafelków. Czysta funkcja, bez losowości.
// loadout = { char, tiles: [id...], skills: [{id,lvl}], coins, bonusAtk, noRegen }; opt.off = indeks kafelka wyłączonego (Skubanie).
import { CHARS, TILE_BY_ID, MILESTONES, MILESTONE_EVERY } from './data.js';

export function setCounts(tileIds) {
  const c = {};
  for (const id of tileIds) { const t = TILE_BY_ID[id]; if (!t) continue; for (const st of (t.sets || (t.set ? [t.set] : []))) c[st] = (c[st] || 0) + 1; }
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
  const sc = setCounts(ids);
  // progi statystyk (co 3 kopie)
  const cnt = {}; for (const id of ids) cnt[id] = (cnt[id] || 0) + 1;
  for (const [id, m] of Object.entries(MILESTONES)) { const n = Math.floor((cnt[id] || 0) / MILESTONE_EVERY); if (n) for (const f of m.fx) add(f.k, f.v * n); }

  // Przedmioty z logiką zależną od runu.
  if (has('worek-kukurydzy')) {
    const pct = 8 * Math.floor((loadout.coins || 0) / 10);
    add('atkPct', (sc.zbozowe || 0) >= 3 ? pct : Math.min(40, pct));
  }
  if (has('siewnik')) add('atkFlat', loadout.bonusAtk || 0);
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
  const regen = loadout.noRegen ? 0 : Math.floor((b.regen + (acc.regen || 0)) * (100 + all) / 100);

  return {
    maxHp, atk, aspd, armor, crit, evade, regen,
    critMult: b.critMult + (acc.critMult || 0),
    dmg: b.dmg + (acc.dmg || 0),
    luck: b.luck + (acc.luck || 0),
    egg: has('jajko-na-twardo') ? 60 : has('tykajace-jajo') ? ((sc.jajeczne || 0) >= 2 ? 60 : 80) : 0,   // co ile ticków wybucha Tykające Jajo
    eggAll: !!acc.eggAll, eggBurn: acc.eggBurn || 0, bleedStacks: acc.bleedStacks || 1, revivePct: acc.revivePct || 40, reviveBurn: acc.reviveBurn || 0,
    eggHeal: (sc.jajeczne || 0) >= 3 ? 3 : 0,
    bleed: acc.bleed || 0,
    // efekty statusowe: szansa nałożenia przy zwykłym ataku (%), moc i czas trwania
    bleedMax: acc.bleedMax || 0, burnHit: Math.min(100, acc.burnHit || 0), frostHit: Math.min(100, acc.frostHit || 0), poisonHit: Math.min(100, acc.poisonHit || 0),
    burnPct: acc.burnPct || 0, poisonPct: acc.poisonPct || 0, burnMax: acc.burnMax || 0, stDur: acc.stDur || 0, freezePct: acc.freezePct || 0,
    frostNeed: acc.frostNeed || 0, shatter: acc.shatter || 0, spreadPct: acc.spreadPct || 0, burnHeal: acc.burnHeal || 0,
    pressure: acc.pressure || 0, vsCold: acc.vsCold || 0, frostThorns: acc.frostThorns || 0, frostSlow: acc.frostSlow || 0, eggPoison: acc.eggPoison || 0,
    startBurn: acc.startBurn || 0, startFrost: acc.startFrost || 0, cdPct: Math.min(50, acc.cdPct || 0),
    // ekonomia (liczona w rules.js)
    freeReroll: acc.freeReroll || 0, noSteal: !!acc.noSteal, bossCoins: acc.bossCoins || 0, restDisc: acc.restDisc || 0, buyDisc: acc.buyDisc || 0, interest: acc.interest || 0,
    shred: acc.shred || 0,
    okrzyk: (sc.rambo || 0) >= 3,
    revive: has('gniazdo-zapasowe') || has('feniks-z-rosolu'),
    coinFlat: acc.coinFlat || 0,
    coinPct: acc.coinPct || 0,
    sets: sc,
  };
}
