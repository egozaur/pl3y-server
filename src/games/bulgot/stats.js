// Bulgot: liczenie statystyk bohatera z postaci i kafelków. Czysta funkcja, bez losowości.
// loadout = { char, tiles: [id...], skills: [{id,lvl}], coins, bonusAtk, noRegen }; opt.off = indeks kafelka wyłączonego (Skubanie).
import { CHARS, TILE_BY_ID } from './data.js';

export function setCounts(tileIds) {
  const c = {};
  for (const id of tileIds) { const t = TILE_BY_ID[id]; if (t && t.set) c[t.set] = (c[t.set] || 0) + 1; }
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

  // Przedmioty z logiką zależną od runu.
  if (has('worek-kukurydzy')) {
    const pct = 8 * Math.floor((loadout.coins || 0) / 10);
    add('atkPct', (sc.zbozowe || 0) >= 3 ? pct : Math.min(40, pct));
  }
  if (has('siewnik')) add('atkFlat', loadout.bonusAtk || 0);
  if ((sc.rambo || 0) >= 2) add('atkPct', 20);
  if ((sc.zbozowe || 0) >= 2) add('coinPct', 10);

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
    egg: has('tykajace-jajo') ? ((sc.jajeczne || 0) >= 2 ? 60 : 80) : 0,   // co ile ticków wybucha Tykające Jajo
    eggHeal: (sc.jajeczne || 0) >= 3 ? 3 : 0,
    bleed: acc.bleed || 0,
    shred: acc.shred || 0,
    okrzyk: (sc.rambo || 0) >= 3,
    revive: has('gniazdo-zapasowe'),
    coinFlat: acc.coinFlat || 0,
    coinPct: acc.coinPct || 0,
    sets: sc,
  };
}
