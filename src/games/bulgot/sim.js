// Bulgot: silnik walki. Deterministyczny, w tickach po 100 ms; ten sam plik działa w przeglądarce (płynna walka na żywo)
// i na serwerze (powtórka walki z listy wejść gracza, żeby wynik nie dał się podrobić).
//
// Fight(setup).step(inputs) przesuwa walkę o jeden tick; inputs = numery slotów umiejętności użytych w tym ticku.
// Każdy tick zostawia w this.ev listę zdarzeń do animacji. runFight(setup, inputs) puszcza całą walkę naraz.
// Zasada: żadnego Math.random, Date ani funkcji trygonometrycznych.
import { makeRng } from './rng.js';
import { SKILLS, TILE_BY_ID, STATUS } from './data.js';
import { heroStats } from './stats.js';

export const MAX_TICKS = 900;      // 90 s
export const FURY_FROM = 450;      // po 45 s wrogowie wpadają w Furię
const fl = Math.floor;

export class Fight {
  constructor(setup) {
    this.setup = setup;
    this.rng = makeRng(setup.seed);
    this.tick = 0; this.ev = []; this.over = false; this.win = false; this.timeout = false;
    const h = setup.hero;
    this.loadout = h.loadout;
    this.off = -1; this.offUntil = 0;
    this.S = heroStats(this.loadout);
    this.hp = Math.min(h.hp, this.S.maxHp);
    this.acc = 0;                                         // naładowanie ataku bohatera (1000 = cios)
    this.skills = this.loadout.skills.map(s => ({ id: s.id, lvl: s.lvl, mut: s.mut || 0, cd: fl(SKILLS[s.id].cd * 15 / 100), blockedUntil: 0 }));   // start z 15% cooldownu (nie zabija w 1. ticku, a umiejętność jest gotowa po ok. 1 s)
    this.hasteUntil = 0; this.invulnUntil = 0; this.slowUntil = 0; this.critUntil = 0; this.kontraUntil = 0; this.blindUntil = 0; this.coinsWon = 0; this.bleedExtra = 0;
    this.nextEgg = this.S.egg || 0;
    this.revive = !!h.revive; this.revived = false; this.okUsed = false;
    this.uid = 0;
    this.enemies = setup.enemies.map(e => this.mk(e));
    this.burnDealt = 0; this.freezes = 0;
    if (this.S.startBurn || this.S.startFrost) for (const e of this.enemies) { if (this.S.startBurn) this.applyStatus(e, 'burn', this.S.startBurn); if (this.S.startFrost) this.applyStatus(e, 'frost', this.S.startFrost); }
    this.stolen = 0; this.dealt = 0; this.taken = 0; this.maxHit = 0; this.kills = 0; this.used = 0; this.lowest = this.hp;
  }

  mk(e) {
    const o = { ...e, uid: ++this.uid, idleUntil: e.idle || 0, maxHp: e.hp, baseArmor: e.armor, acc: 0, stunUntil: 0, windup: null, nextSpec: e.spec ? e.spec.every : 0,
      dead: false, aspdPct: 100, burn: 0, burnT: 0, frost: 0, frostT: 0, poison: 0, poisonT: 0, bleed: 0, bleedT: 0, frozenUntil: 0, resist: e.resist || null, p2: false, p3: false, shield: e.shield ? fl(e.hp * e.shield / 100) : 0, shieldHits: e.shieldHits || 0 };
    if (o.boss === 'brojler') o.nextSummon = 100;
    if (o.boss === 'skubarka') o.nextSkub = 1e9;
    if (o.boss === 'prezes') o.nextBlock = 1e9;
    return o;
  }

  alive() { return this.enemies.filter(e => !e.dead); }
  target() { return this.enemies.find(e => !e.dead) || null; }
  push(e) { e.t = this.tick; this.ev.push(e); }

  heroAspd() {
    let a = this.S.aspd;
    if (this.tick < this.hasteUntil) a = fl(a * 150 / 100);
    if (this.tick < this.slowUntil) a = fl(a * 80 / 100);
    return Math.max(10, a);
  }
  furyExtra() { return this.tick >= FURY_FROM ? 5 * fl((this.tick - FURY_FROM) / 10) : 0; }

  heal(n) {
    if (n <= 0 || this.hp <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.S.maxHp, this.hp + n);
    if (this.hp > before) this.push({ k: 'heal', n: this.hp - before });
  }

  // ---------- uderzenia bohatera ----------
  heroHit(t, pct, canCrit, kind) {
    if (t.dead) return 0;
    if (t.immune) { this.push({ k: 'immune', to: t.uid }); return 0; }
    if (t.evade && this.rng.int(100) < t.evade) { this.push({ k: 'miss', to: t.uid }); return 0; }
    let raw = fl(this.S.atk * pct / 100);
    raw = fl(raw * (100 + this.S.dmg + (this.S.vsCold && (t.frost > 0 || this.tick < t.frozenUntil) ? this.S.vsCold : 0)) / 100);
    let crit = false;
    if (canCrit && (this.tick < this.critUntil || this.rng.int(100) < this.S.crit)) { crit = true; raw = fl(raw * this.S.critMult / 100); }
    let d = Math.max(1, fl(raw * 100 / (100 + Math.max(0, t.armor))));
    if (t.shieldHits > 0) { t.shieldHits--; this.push({ k: 'shield', to: t.uid }); return 0; }
    if (t.shield > 0) { const a = Math.min(t.shield, d); t.shield -= a; d -= a; this.push({ k: 'shieldhit', to: t.uid, d: a }); if (d <= 0) return a; }
    t.hp -= d; this.dealt += d; if (d > this.maxHit) this.maxHit = d;
    this.push({ k: 'hit', to: t.uid, d, crit, kind });
    if (this.S.shred && kind === 'atk' && this.rng.int(100) < this.S.shred && t.armor > 0) t.armor = Math.max(0, t.armor - Math.max(1, Math.ceil(t.baseArmor / 10)));
    if (kind === 'atk') {
      if (this.S.bleed) this.applyStatus(t, 'bleed', 1);
      if (this.frenzyBleed && this.tick < this.hasteUntil) this.applyStatus(t, 'bleed', 2);
      if (this.S.burnHit && this.rng.int(100) < this.S.burnHit) this.applyStatus(t, 'burn', 1);
      if (this.S.frostHit && this.rng.int(100) < this.S.frostHit) this.applyStatus(t, 'frost', 1);
      if (this.S.poisonHit && this.rng.int(100) < this.S.poisonHit) this.applyStatus(t, 'poison', 1);
    }
    if (t.hp <= 0) this.kill(t);
    return d;
  }

  // ---------- efekty statusowe ----------
  // Nakłada n stosów efektu (burn|frost|poison|bleed) na wroga. Zwraca true, jeśli coś nałożono.
  applyStatus(t, kind, n) {
    if (!t || t.dead || t.immune || n <= 0) return false;
    if (t.resist && t.resist.includes(kind)) { this.push({ k: 'resist', to: t.uid, s: kind }); return false; }
    const def = STATUS[kind], S = this.S;
    const until = this.tick + fl(def.dur * (100 + (S.stDur || 0)) / 100);
    if (kind === 'frost') {
      if (this.tick < t.frozenUntil) return false;
      t.frost += n; t.frostT = until;
      const need = Math.max(2, def.need - (S.frostNeed || 0));
      if (t.frost >= need) {
        t.frost = 0;
        let d = fl(def.freeze * (100 + (S.freezePct || 0)) / 100);
        if (t.boss) d = fl(d / 2);
        t.frozenUntil = this.tick + d; t.stunUntil = Math.max(t.stunUntil, t.frozenUntil);
        if (t.windup) { t.windup = null; t.nextSpec = t.frozenUntil + (t.spec ? t.spec.every : 0); this.push({ k: 'break', uid: t.uid }); }
        this.push({ k: 'freeze', uid: t.uid }); this.freezes++;
        if (S.shatter) for (const e of this.alive()) this.heroHit(e, S.shatter, false, 'shatter');
      }
      return true;
    }
    const max = def.max + (kind === 'bleed' ? (S.bleedMax || 0) + this.bleedExtra : kind === 'burn' ? (S.burnMax || 0) : 0);
    t[kind] = Math.min(max, t[kind] + n); t[kind + 'T'] = until;
    return true;
  }
  // Obrażenia jednego stosu na sekundę.
  dotPer(kind) {
    const S = this.S;
    if (kind === 'bleed') return S.bleed + fl(S.atk * STATUS.bleed.per / 100);
    const bonus = kind === 'burn' ? (S.burnPct || 0) : (S.poisonPct || 0);
    return Math.max(1, fl(S.atk * STATUS[kind].per * (100 + bonus) / 10000));
  }
  dots() {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.frost && this.tick > e.frostT) e.frost = 0;
      for (const kind of ['burn', 'poison', 'bleed']) {
        if (!e[kind] || e.dead) continue;
        if (this.tick > e[kind + 'T']) { e[kind] = 0; continue; }
        if (e.immune) continue;
        const d = e[kind] * this.dotPer(kind);
        e.hp -= d; this.dealt += d; if (kind === 'burn') this.burnDealt += d;
        this.push({ k: 'hit', to: e.uid, d, crit: false, kind });
        if (kind === 'burn' && this.S.burnHeal) this.heal(fl(e.burn * this.S.burnHeal / 10));
        if (e.hp <= 0) this.kill(e);
      }
      // Garnek Ciśnieniowy: wróg z 8+ stosami Oparzenia wybucha
      if (this.S.pressure && !e.dead && e.burn >= 8) {
        e.burn = 0; this.push({ k: 'boom', uid: e.uid });
        for (const x of this.alive()) this.heroHit(x, this.S.pressure, false, 'boom');
      }
    }
  }

  kill(t) {
    if (t.dead) return;
    t.dead = true; t.hp = 0; this.kills++;
    this.push({ k: 'kill', uid: t.uid });
    if (t.poison > 0) { const nx = this.enemies.find(e => !e.dead && !e.immune); if (nx) this.applyStatus(nx, 'poison', Math.max(1, fl(t.poison * (STATUS.poison.spread + (this.S.spreadPct || 0)) / 100))); }
    if (t.boss === 'brojler') for (const m of this.enemies) if (m.minion && !m.dead) { m.dead = true; m.hp = 0; this.push({ k: 'kill', uid: m.uid }); }
  }

  // ---------- umiejętności ----------
  useSkill(slot) {
    const s = this.skills[slot];
    if (!s || this.over || this.tick < s.cd || this.tick < s.blockedUntil) return false;
    const def = SKILLS[s.id], pw = s.lvl >= 2 ? 130 : 100, m = s.lvl >= 3 ? (s.mut || 1) : 0;
    s.cd = this.tick + fl((s.lvl >= 2 ? fl(def.cd * 80 / 100) : def.cd) * (100 - (this.S.cdPct || 0)) / 100);
    this.used++;
    this.push({ k: 'skill', slot, id: s.id, mut: m });
    const alive = this.alive(), P = x => fl(x * pw / 100), tick = this.tick;
    const stunAll = d => { for (const e of this.alive()) { e.stunUntil = Math.max(e.stunUntil, tick + d); if (e.windup) { e.windup = null; e.nextSpec = e.stunUntil + (e.spec ? e.spec.every : 0); this.push({ k: 'break', uid: e.uid }); } this.push({ k: 'stun', uid: e.uid }); } };
    switch (s.id) {
      case 'grad': {
        const n = m === 2 ? 9 : def.hits;
        for (let i = 0; i < n; i++) {
          const al = this.alive(); if (!al.length) break;
          const t = al[this.rng.int(al.length)];
          this.heroHit(t, P(def.pct), false, 'grad');
          if (m === 1) this.applyStatus(t, 'burn', 1);
        }
        break;
      }
      case 'pianie':
        stunAll(fl(P(def.dur) * (m === 2 ? 175 : 100) / 100));
        if (m === 1) for (const e of this.alive()) this.applyStatus(e, 'frost', 3);
        break;
      case 'granat': {
        const t = this.target(); if (!t) break;
        const rest = alive.filter(e => e !== t);
        this.heroHit(t, P(def.pct), false, 'granat');
        if (m === 1) for (const e of rest) this.heroHit(e, fl(P(def.pct) * 60 / 100), false, 'granat');
        if (m === 2) this.applyStatus(t, 'burn', 5);
        if (this.S.eggPoison) this.applyStatus(t, 'poison', this.S.eggPoison);
        break;
      }
      case 'dziobniecie': this.hasteUntil = tick + P(def.dur) * (m === 2 ? 2 : 1); this.frenzyBleed = m === 1; break;
      case 'unik': this.invulnUntil = Math.max(this.invulnUntil, tick + P(def.dur) * (m === 2 ? 2 : 1)); this.unikKontra = m === 1; break;
      case 'zagrzebanie':
        this.heal(fl(this.S.maxHp * P(m === 1 ? 50 : def.pct) / 100));
        if (m === 2) this.critUntil = tick + 40;
        break;
      case 'chlust':
        for (const e of alive) { this.heroHit(e, P(def.pct), false, 'chlust'); this.applyStatus(e, 'burn', m === 1 ? 6 : def.n); }
        if (m === 2) stunAll(10);
        break;
      case 'lodowy': {
        const t = this.target(); if (!t) break;
        this.heroHit(t, P(def.pct), false, 'lodowy');
        if (m === 1) this.applyStatus(t, 'frost', 99);
        else if (m === 2) for (const e of this.alive()) this.applyStatus(e, 'frost', def.n);
        else this.applyStatus(t, 'frost', def.n);
        break;
      }
      case 'zgnile': {
        const t = this.target(); if (!t) break;
        if (m === 1) for (const e of alive) this.applyStatus(e, 'poison', 4);
        else { this.applyStatus(t, 'poison', P(def.n * 10) / 10 | 0); for (const e of alive) if (e !== t) this.applyStatus(e, 'poison', 1); }
        if (m === 2) this.applyStatus(t, 'poison', t.poison);
        break;
      }
      case 'kontra': this.kontraUntil = tick + P(def.dur); this.kontraRed = m === 1 ? 75 : 50; this.kontraPct = P(m === 2 ? 250 : def.pct); break;
      case 'darcie':
        if (m === 1) this.bleedExtra = 2;
        for (const e of alive) { this.heroHit(e, P(def.pct), false, 'darcie'); this.applyStatus(e, 'bleed', m === 1 ? 3 : def.n); }
        if (m === 2) { const n = this.alive().reduce((a, e) => a + e.bleed, 0); this.heal(fl(this.S.maxHp * 3 * n / 100)); }
        break;
      case 'kapiel':
        this.blindUntil = tick + P(def.dur); this.blindPct = m === 1 ? 75 : def.pct;
        if (m === 2) stunAll(10);
        break;
      case 'premia': {
        const t = this.target(); if (!t) break;
        this.heroHit(t, P(m === 2 ? 300 : def.pct), false, 'premia');
        const cap = m === 1 ? 6 : 3, per = m === 1 ? 2 : 1;
        if (t.dead && this.coinsWon < cap) { const n = Math.min(per, cap - this.coinsWon); this.coinsWon += n; this.push({ k: 'coin', n }); }
        break;
      }
      case 'egzekucja': {
        const al = this.alive(); if (!al.length) break;
        const thr = m === 1 ? 50 : def.thr;
        const low = al.find(e => !e.immune && e.hp * 100 < e.maxHp * thr), t = low || this.target();
        this.heroHit(t, P(low ? def.exec : def.pct), false, 'egzekucja');
        if (m === 2 && t.dead) s.cd = tick + 1;
        break;
      }
    }
    return true;
  }

  // ---------- ataki wrogów ----------
  enemyHit(e, mult) {
    if (this.hp <= 0 || this.over) return;
    if (this.tick < this.invulnUntil) { this.push({ k: 'block', from: e.uid }); if (this.unikKontra) this.heroHit(e, 100, false, 'kontra'); return; }
    if (this.tick < this.blindUntil && this.rng.int(100) < this.blindPct) { this.push({ k: 'dodge', from: e.uid }); return; }
    if (this.S.evade && this.rng.int(100) < this.S.evade) { this.push({ k: 'dodge', from: e.uid }); return; }
    let pct = 100 + this.furyExtra();
    if (e.boss === 'prezes' && e.p3) pct += 2 * fl((this.tick - e.p3At) / 10);
    let raw = fl(e.atk * mult / 100);
    raw = fl(raw * pct / 100);
    let crit = false;
    if (e.crit && this.rng.int(100) < e.crit) { crit = true; raw = fl(raw * 150 / 100); }
    let d = Math.max(1, fl(raw * 100 / (100 + this.S.armor)));
    const kontra = this.tick < this.kontraUntil;
    if (kontra) d = Math.max(1, fl(d * (100 - this.kontraRed) / 100));
    this.hp -= d; this.taken += d; if (this.hp < this.lowest) this.lowest = Math.max(0, this.hp);
    this.push({ k: 'hurt', from: e.uid, d, crit });
    if (this.S.frostThorns && !e.dead) this.applyStatus(e, 'frost', this.S.frostThorns);
    if (e.steal && !this.S.noSteal && this.stolenBy(e) < e.steal.max) { this.stolen += e.steal.n; e.stole = (e.stole || 0) + e.steal.n; this.push({ k: 'steal', from: e.uid }); }
    if (e.slow) { this.slowUntil = this.tick + e.slow.ticks; }
    if (kontra && this.hp > 0) this.heroHit(e, this.kontraPct, false, 'kontra');
    if (this.hp > 0 && this.S.okrzyk && !this.okUsed && this.hp * 100 < this.S.maxHp * 20) { this.okUsed = true; this.invulnUntil = this.tick + 30; this.push({ k: 'okrzyk' }); }
    if (this.hp <= 0) this.heroDown();
  }
  stolenBy(e) { return e.stole || 0; }

  heroDown() {
    if (this.revive && !this.revived) {
      this.revived = true; this.hp = fl(this.S.maxHp * 40 / 100); this.push({ k: 'revive' });
      return;
    }
    this.hp = 0; this.over = true; this.win = false;
    this.push({ k: 'defeat' });
  }

  // ---------- fazy i zagrywki bossów ----------
  phases() {
    for (const e of this.enemies) {
      if (e.dead || !e.boss) continue;
      const pctHp = e.hp * 100 / e.maxHp;
      if (e.boss === 'brojler' && !e.p2 && pctHp < 50) { e.p2 = true; e.aspdPct = 130; this.push({ k: 'phase', uid: e.uid, n: 2 }); }
      if (e.boss === 'skubarka') {
        if (!e.p2 && pctHp < 40) { e.p2 = true; e.spec = { every: 100, windup: 20, mult: 300 }; e.nextSpec = this.tick + 50; this.push({ k: 'phase', uid: e.uid, n: 2 }); }
        if (!e.p3 && pctHp < 20) { e.p3 = true; e.nextSkub = this.tick + 20; this.push({ k: 'phase', uid: e.uid, n: 3 }); }
      }
      if (e.boss === 'prezes') {
        if (!e.p2 && pctHp < 66) { e.p2 = true; e.nextBlock = this.tick + 50; this.push({ k: 'phase', uid: e.uid, n: 2 }); }
        if (!e.p3 && pctHp < 33) { e.p3 = true; e.p3At = this.tick; this.push({ k: 'phase', uid: e.uid, n: 3 }); }
      }
    }
  }

  bossAct(e) {
    if (e.boss === 'brojler' && this.tick >= e.nextSummon) {
      e.nextSummon = this.tick + 150;
      const m = this.setup.minion;
      let n = this.enemies.filter(x => x.minion && !x.dead).length;
      for (let i = 0; i < 2 && n < 4 && m; i++, n++) {
        const o = this.mk({ ...m, minion: true });
        this.enemies.unshift(o);
        this.push({ k: 'summon', uid: o.uid });
      }
    }
    if (e.boss === 'skubarka' && this.tick >= e.nextSkub) {
      e.nextSkub = this.tick + 200;
      const cand = []; this.loadout.tiles.forEach((id, i) => { const t = TILE_BY_ID[id]; if (t && t.fx && i !== this.off) cand.push(i); });
      if (cand.length) {
        const idx = cand[this.rng.int(cand.length)];
        this.off = idx; this.offUntil = this.tick + 100;
        this.S = heroStats(this.loadout, { off: idx });
        this.hp = Math.min(this.hp, this.S.maxHp);
        this.push({ k: 'skubanie', tile: this.loadout.tiles[idx] });
      }
    }
    if (e.boss === 'prezes' && this.tick >= e.nextBlock) {
      e.nextBlock = this.tick + 150;
      if (this.skills.length) {
        const slot = this.rng.int(this.skills.length);
        this.skills[slot].blockedUntil = this.tick + 80;
        this.push({ k: 'blockslot', slot });
      }
    }
  }

  enemyAct(e) {
    if (this.tick < e.idleUntil) return;           // wróg jeszcze „wchodzi do walki” (Zebranie Zarządu: pierwsze 3 s Prezesa)
    if (this.tick < e.stunUntil) return;
    if (e.boss) this.bossAct(e);
    if (e.windup) {
      if (this.tick >= e.windup.end) { e.windup = null; e.nextSpec = this.tick + e.spec.every; this.enemyHit(e, e.spec.mult); }
      return;
    }
    if (e.spec && this.tick >= e.nextSpec) { e.windup = { end: this.tick + e.spec.windup }; this.push({ k: 'telegraph', uid: e.uid, end: e.windup.end }); return; }
    e.acc += fl(fl(e.aspd * e.aspdPct / 100) * (100 - Math.min(60, e.frost * (STATUS.frost.slow + (this.S.frostSlow || 0)))) / 100);
    while (e.acc >= 1000 && !this.over && !e.dead) { e.acc -= 1000; this.enemyHit(e, 100); }
  }

  // ---------- jeden tick ----------
  step(inputs = []) {
    if (this.over) return;
    this.ev = [];
    const t = this.tick;
    for (const s of inputs) this.useSkill(s);
    if (this.off >= 0 && t >= this.offUntil) { this.off = -1; this.S = heroStats(this.loadout); this.push({ k: 'skubanie-end' }); if (this.S.egg && !this.nextEgg) this.nextEgg = t + this.S.egg; }
    for (const e of this.enemies) if (e.boss === 'prezes') e.immune = this.enemies.some(g => g.guard && !g.dead);
    if (t === FURY_FROM) this.push({ k: 'fury' });

    if (t % 10 === 9) {
      this.heal(this.S.regen);
      this.dots();
    }
    if (this.S.egg && this.nextEgg && t >= this.nextEgg) {
      this.nextEgg = t + this.S.egg;
      const tg = this.target();
      if (tg) { this.push({ k: 'egg' }); this.heroHit(tg, 120, false, 'egg'); if (this.S.eggPoison) this.applyStatus(tg, 'poison', this.S.eggPoison); if (this.S.eggHeal) this.heal(fl(this.S.maxHp * this.S.eggHeal / 100)); }
    }
    // atak bohatera
    this.acc += this.heroAspd();
    while (this.acc >= 1000) {
      const tg = this.target();
      if (!tg) { this.acc = 1000; break; }
      this.acc -= 1000;
      this.push({ k: 'swing' });
      this.heroHit(tg, 100, true, 'atk');
    }
    this.phases();
    if (!this.enemies.some(e => !e.dead && !e.minion)) { this.over = true; this.win = true; this.push({ k: 'victory' }); this.tick++; return; }
    for (const e of this.enemies.slice()) { if (!e.dead && !this.over) this.enemyAct(e); }
    this.tick++;
    if (!this.over && this.tick >= MAX_TICKS) { this.over = true; this.win = false; this.timeout = true; this.push({ k: 'timeout' }); }
  }

  result() {
    const boss = this.setup.enemies.find(e => e.boss);
    return {
      win: this.win, ticks: this.tick, hp: Math.max(0, this.hp), maxHp: this.S.maxHp, timeout: this.timeout,
      usedRevive: this.revived, stolen: this.stolen, dealt: this.dealt, taken: this.taken, maxHit: this.maxHit,
      kills: this.kills, skillsUsed: this.used, coinsWon: this.coinsWon, burnDealt: this.burnDealt, freezes: this.freezes, lowest: this.lowest, boss: this.win && boss ? boss.boss : null,
    };
  }
}

// Cała walka naraz. inputs = [[tick, slot], ...]. Nieprawidłowe wpisy są pomijane.
export function runFight(setup, inputs = []) {
  const f = new Fight(setup);
  const by = new Map();
  let n = 0;
  for (const it of inputs) {
    if (!Array.isArray(it) || ++n > 400) continue;
    const [t, s] = it;
    if (!Number.isInteger(t) || !Number.isInteger(s) || t < 0 || t >= MAX_TICKS || s < 0 || s > 2) continue;
    if (!by.has(t)) by.set(t, []);
    by.get(t).push(s);
  }
  while (!f.over) f.step(by.get(f.tick) || []);
  return f.result();
}
