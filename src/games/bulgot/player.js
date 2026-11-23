// Bulgot: Durable Object „BgPlayer” (jeden na gracza, klucz = znormalizowany nick). Trzyma profil (odblokowania, wyniki)
// i aktywny run. Całą logikę gry liczy serwer: oferty, rerolle, zakupy, walki (powtórka z wejść gracza).
//
// Gracz przychodzi już sprawdzony przez Worker (index.js → playerFromToken): body.pl = { n, nick, avatar }.
// Klucze: „profile”, „run”. Trasy (POST): /state /start /pick /buy /reroll /rest /shop /bet /bonus /choose /pawn /redeem /upgrade /will /fightstart /fightfinish /abandon /history /analysis /skillorder /code /kurnik.
// Odpowiedź: { ok, profile, run, ...wynik akcji } albo { err, code } z kodem 400/409.
import { mix, hash } from './rng.js';
import { newRun, pickTile, reroll, buyOffer, rest, shopBuy, bet, bonusPick, choose, fightSetup, fightFinish, abandon, swapSkills, view, statsOf, pawn, redeem, upgrade, willOptions, ghostOf, RUN_V } from './rules.js';
import { newProfile, poolFor, evaluate, evaluateAchievements, onBossKill, onRunEnd, onNemesisBeaten, markSeen, publicProfile, kurnikBuy } from './profile.js';
import { MODES, CHARS, TILE_BY_ID, UNLOCK_BY_ID } from './data.js';

export class BgPlayer {
  constructor(ctx, env, now = () => Date.now()) { this.ctx = ctx; this.env = env; this.now = now; this.chain = Promise.resolve(); }

  // Żądania jednego gracza wykonują się po kolei (zapis stanu nie może się przeplatać).
  fetch(req) {
    const p = this.chain.then(() => this.handle(req));
    this.chain = p.catch(() => {});
    return p;
  }

  async handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const url = new URL(req.url);
    let b; try { b = await req.json(); } catch { return json({ err: 'Nieprawidłowe dane.' }, 400); }
    const pl = b && b.pl;
    if (!pl || typeof pl.n !== 'string') return json({ err: 'Zaloguj się nickiem.', code: 'player' }, 401);

    const st = this.ctx.storage;
    const profile = (await st.get('profile')) || newProfile();
    profile.nick = pl.nick; profile.avatar = pl.avatar || 0;
    let run = (await st.get('run')) || null;
    const path = url.pathname.replace(/^\//, '');
    const extra = {};
    // Run zapisany w starej wersji reguł (np. przed szablonami pięter) jest unieważniany.
    if (run && run.v !== RUN_V) { run = null; await st.delete('run'); extra.voided = true; }
    let r = { ok: true };
    const wasOver = !run || run.phase === 'over';

    switch (path) {
      case 'state': extra.myGhost = await this.myGhost(pl); break;
      case 'start': {
        if (run && run.phase !== 'over') return json({ err: 'Masz już aktywny run.', code: 'active', ...this.out(profile, run) }, 409);
        const mode = b.mode, char = b.char, g = Number(b.garnek) | 0;
        if (!MODES[mode]) return json({ err: 'Nieznany tryb.', code: 'mode' }, 400);
        if (!CHARS[char] || !profile.chars.includes(char)) return json({ err: 'Ta postać jest jeszcze zablokowana.', code: 'char' }, 400);
        if (g < 0 || g > profile.garnek) return json({ err: 'Ten poziom Garnka jest jeszcze zablokowany.', code: 'garnek' }, 400);
        const seed = mix(Date.now() & 0x7fffffff, hash(pl.n), (crypto.getRandomValues(new Uint32Array(1)))[0]);
        // Testament Pyrtka działa w runie inną postacią niż ta, która go spisała (chyba że masz tylko jedną postać).
        const w = profile.will, useWill = !!(w && TILE_BY_ID[w.tile] && !(profile.chars.length > 1 && w.char === char));
        r = newRun({ mode, char, garnek: g, pool: poolFor(profile), seed, now: this.now(), nemesis: profile.nemesis || null, will: useWill ? w.tile : null, curses: Array.isArray(b.curses) ? b.curses.map(String) : [], kurnik: profile.kurnik || {} });
        if (r.ok) { run = r.run; if (useWill) profile.will = null; }
        break;
      }
      case 'pawn': r = need(run) || pawn(run, String(b.id || '')); break;
      case 'redeem': r = need(run) || redeem(run); break;
      case 'upgrade': r = need(run) || upgrade(run, String(b.id || '')); break;
      case 'will': {
        const opts = willOptions(run), i = Number(b.i);
        if (!opts) return json({ err: 'Teraz nie spiszesz testamentu.', code: 'phase', ...this.out(profile, run) }, 409);
        if (i !== -1 && !opts[i]) return json({ err: 'Nie ma takiego kafelka.', code: 'index', ...this.out(profile, run) }, 409);
        run.willDone = true;
        if (i >= 0) { profile.will = { tile: opts[i], char: run.char }; r = { ok: true, will: opts[i] }; }
        break;
      }
      case 'pick': {
        // Arena Duchów: duch (build innego gracza) pochodzi z BgRanks; bez niego pojawia się Odbicie gracza.
        const t = run && run.phase === 'offer' ? TILE_BY_ID[run.offer[Number(b.i)]] : null;
        const ctx = t && t.event === 'arena' ? { ghost: await this.fetchGhost(pl, run) } : {};
        r = need(run) || pickTile(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut), ctx);
        break;
      }
      case 'kurnik': {   // kupno poziomu budynku w Kurniku za Pióra
        r = kurnikBuy(profile, String(b.id || ''));
        if (r.ok) extra.kurnikBought = { id: r.id, lvl: r.lvl, cost: r.cost };
        break;
      }
      case 'reroll': r = need(run) || reroll(run); break;
      case 'rest': r = need(run) || rest(run); break;
      case 'buy': r = need(run) || buyOffer(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'shop': r = need(run) || shopBuy(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'bet': r = need(run) || bet(run, Number(b.amount)); break;
      case 'bonus': r = need(run) || bonusPick(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'choose': r = need(run) || choose(run, Number(b.i)); break;
      case 'fightstart': r = need(run) || fightSetup(run); break;
      case 'fightfinish': r = need(run) || fightFinish(run, Array.isArray(b.inputs) ? b.inputs : []); break;
      case 'abandon': r = need(run) || abandon(run); break;
      case 'skillorder': r = need(run) || swapSkills(run, Number(b.a), Number(b.b)); break;
      case 'code': {   // Hasło do ukrytej postaci (tylko z ekranu wyboru postaci). Hasło zna wyłącznie serwer.
        const word = String(b.text || '').trim().toLowerCase().slice(0, 40);
        if (word !== 'dzioby') return json({ err: 'To nie jest dobre hasło.', code: 'code', ...this.out(profile, run) }, 409);
        const u = UNLOCK_BY_ID['u-420'];
        if (!profile.unlocked.includes(u.id)) {
          profile.unlocked.push(u.id);
          if (!profile.chars.includes(u.target)) profile.chars.push(u.target);
          extra.unlocks = [{ id: u.id, kind: u.kind, target: u.target, text: u.text }];
        }
        break;
      }
      case 'history': break;
      case 'analysis': {   // „Wyślij do analizy”: kopia zakończonego runu (z dziennika historii) trafia do kolekcji w BgRanks
        const hist = (await st.get('history')) || [], h = hist.find(x => x.id === String(b.id || ''));
        if (!h) return json({ err: 'Nie znaleziono tego runu w historii.', code: 'none', ...this.out(profile, run) }, 409);
        if (!h.sent) {
          const tags = Array.isArray(b.tags) ? b.tags.slice(0, 6).map(t => String(t).slice(0, 24)) : [];
          const entry = { ...h, n: pl.n, note: String(b.note || '').slice(0, 300), tags, sentAt: this.now() };
          try {
            const res = await this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')).fetch('https://bg/analysis-put', { method: 'POST', body: JSON.stringify({ entry }) });
            if (!res.ok) throw new Error('put');
          } catch { return json({ err: 'Nie udało się wysłać. Spróbuj za chwilę.', code: 'send', ...this.out(profile, run) }, 409); }
          h.sent = true; await st.put('history', hist);
        }
        extra.sent = true; break;
      }
      default: return json({ err: 'Nie znaleziono.' }, 404);
    }
    if (r.err) return json({ err: r.err, code: r.code, ...this.out(profile, run) }, 409);

    // Skutki uboczne: odblokowania, boss, koniec runu, ranking.
    if (run && path !== 'state') {
      if (r.boss) onBossKill(profile, r.boss);
      if (r.bossVar && r.bossVar !== r.boss) onBossKill(profile, r.bossVar);   // wariant bossa liczy się też osobno (Księga)
      if (r.arena && r.arena.n && !r.arena.mirror) this.ghostResult(run, r.arena);
      if (r.nemesis) onNemesisBeaten(profile);
      markSeen(profile, run.tiles);
      const fresh = evaluate(profile, run);
      if (run.phase === 'over' && !wasOver) {
        const end = onRunEnd(profile, run);
        fresh.push(...evaluate(profile, run));
        extra.ach = evaluateAchievements(profile, run).map(a => ({ id: a.id, name: a.name, text: a.text, g: a.g, s: a.s, secret: !!a.secret }));
        extra.end = { ...end, score: run.score, rounds: run.done, ended: run.ended, endless: !!run.endless, deep: end.deep || 0 };
        await this.saveGhost(pl, run);
        await this.saveHistory(st, pl, run, path === 'abandon');
        if (run.done > 0 && this.env && this.env.BG_RANKS) {
          try {
            const res = await this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')).fetch('https://bg/submit', {
              method: 'POST', body: JSON.stringify({ mode: run.mode, entry: { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, score: run.score, rounds: run.done, win: run.ended === 'win', char: run.char, garnek: run.garnek, deep: end.deep || 0, at: this.now(), ...(path === 'abandon' ? {} : { fl: { round: run.round, died: run.ended !== 'win' && !run.endless } }) } }) });
            const rj = await res.json();
            extra.end.rank = rj.rank; extra.end.above = rj.above || null; extra.end.floor = rj.floor || null;
          } catch {}
        }
      }
      if (fresh.length) extra.unlocks = fresh.map(u => ({ id: u.id, kind: u.kind, target: u.target, text: u.text }));
    }
    if (path === 'history') extra.history = (await st.get('history')) || [];
    if (run && run.hatchedNow) { extra.hatched = run.hatchedNow; delete run.hatchedNow; }
    await st.put({ profile, ...(run ? { run } : {}) });
    const o = this.out(profile, run);
    const body = { ok: true, ...o, ...extra };
    if (r.setup) body.setup = r.setup;
    for (const k of ['healed', 'result', 'reward', 'boss', 'bonus', 'event', 'crate', 'bought', 'price', 'bet', 'won', 'tile', 'cost', 'left', 'badge', 'automat', 'chose', 'interest', 'doorCoins', 'grew', 'revealed', 'nemesis', 'pawned', 'redeemed', 'upgraded', 'loot', 'looted', 'dino', 'will', 'door', 'victory', 'compUp', 'arena', 'bossVar', 'route', 'companion']) if (r[k] !== undefined) body[k] = r[k];
    return json(body);
  }

  // TESTOWA historia gier: pełny dziennik każdego zakończonego runu (ostatnie 30), do analizy balansu. Do usunięcia po testach.
  async saveHistory(st, pl, run, abandoned) {
    try {
      const hist = (await st.get('history')) || [];
      hist.push({ id: run.id, nick: pl.nick, started: run.started, ended: this.now(), mode: run.mode, char: run.char, garnek: run.garnek, outcome: run.ended, abandoned,
        v: run.v, floorsDone: run.done, endedOnRound: run.round, score: run.score, timeBonus: run.timeBonus, coinsLeft: run.coins, buys: run.stats.buys || 0, rerolls: run.stats.rerolls,
        tiles: run.tiles, skills: run.skills, finalStats: statsOf(run), log: run.log });
      while (hist.length > 30) hist.shift();
      await st.put('history', hist);
      // Automatyczna kopia do kolekcji analiz (bez klikania „Wyślij do analizy”); porzucone runy bez żadnego piętra pomijamy. Błąd nie psuje gry.
      if (run.done > 0 && this.env && this.env.BG_RANKS) {
        const entry = { ...hist[hist.length - 1], n: pl.n, note: '', tags: [], auto: true, sentAt: this.now() };
        try { await this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')).fetch('https://bg/analysis-put', { method: 'POST', body: JSON.stringify({ entry }) }); } catch (e) {}
      }
    } catch (e) {}
  }

  // ---------- Arena Duchów (BgRanks trzyma po jednym duchu na gracza i tryb) ----------
  ranks() { return this.env && this.env.BG_RANKS ? this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')) : null; }
  async fetchGhost(pl, run) {
    const R = this.ranks(); if (!R) return null;
    try {
      const res = await R.fetch('https://bg/ghost-pick', { method: 'POST', body: JSON.stringify({ n: pl.n, mode: run.mode, round: run.round, salt: mix(run.seed >>> 0, run.round, hash('ghost')) }) });
      const j = await res.json(); return j && j.ghost ? j.ghost : null;
    } catch { return null; }
  }
  async saveGhost(pl, run) {
    const R = this.ranks(), g = ghostOf(run); if (!R || !g) return;
    try { await R.fetch('https://bg/ghost-put', { method: 'POST', body: JSON.stringify({ n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, ghost: g, at: this.now() }) }); } catch {}
  }
  ghostResult(run, a) {
    const R = this.ranks(); if (!R) return;
    R.fetch('https://bg/ghost-result', { method: 'POST', body: JSON.stringify({ n: a.n, mode: run.mode, ghostWon: !a.won }) }).catch(() => {});
  }
  async myGhost(pl) {
    const R = this.ranks(); if (!R) return null;
    try { const res = await R.fetch('https://bg/ghost-get', { method: 'POST', body: JSON.stringify({ n: pl.n }) }); return (await res.json()).ghosts || null; } catch { return null; }
  }

  out(profile, run) { return { profile: publicProfile(profile), run: view(run) }; }
}

function need(run) { return run ? null : { err: 'Nie masz aktywnego runu.', code: 'norun' }; }
