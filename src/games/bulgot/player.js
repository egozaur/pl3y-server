// Bulgot: Durable Object „BgPlayer” (jeden na gracza, klucz = znormalizowany nick). Trzyma profil (odblokowania, wyniki)
// i aktywny run. Całą logikę gry liczy serwer: oferty, rerolle, zakupy, walki (powtórka z wejść gracza).
//
// Gracz przychodzi już sprawdzony przez Worker (index.js → playerFromToken): body.pl = { n, nick, avatar }.
// Klucze: „profile”, „run”. Trasy (POST): /state /start /pick /buy /reroll /rest /shop /bet /bonus /choose /pawn /redeem /upgrade /will /fightstart /fightfinish /abandon /history /analysis /skillorder /code /kurnik /levelchoice /shopbuy /wear (Staż i Sklepik) /casino (tryb kasynowy), /duel (pojedynek: op create|join|vote|state|leave), start z { daily: true } = Dyżur dnia, start z { duel: true } = bieg pojedynku.
// Odpowiedź: { ok, profile, run, ...wynik akcji } albo { err, code } z kodem 400/409.
import { mix, hash } from './rng.js';
import { newRun, pickTile, reroll, buyOffer, rest, shopBuy, bet, bonusPick, choose, fightSetup, fightFinish, abandon, endRun, swapSkills, view, statsOf, pawn, redeem, upgrade, willOptions, ghostOf, RUN_V } from './rules.js';
import { DUEL, duelSetDl, autoStep } from './duel.js';
import { newProfile, poolFor, evaluate, evaluateAchievements, onBossKill, onRunEnd, onNemesisBeaten, markSeen, publicProfile, kurnikBuy, kurnikOpen, kurnikGate, levelChoose, shopBuyItem, wearItem, takeBuffs, dailyKey, dailyOf, dailyView } from './profile.js';
import { MODES, CHARS, UNLOCKS, TILE_BY_ID, UNLOCK_BY_ID, STARTER_TILES, CASINO_REROLLS } from './data.js';

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
    kurnikGate(profile);   // jednorazowo: Kurnik od 20. poziomu Stażu, niżsi tracą ulepszenia (zapis na końcu żądania)
    let run = (await st.get('run')) || null;
    const path = url.pathname.replace(/^\//, '');
    const extra = {};
    // Run zapisany w starej wersji reguł (np. przed szablonami pięter) jest unieważniany.
    if (run && run.v !== RUN_V) { run = null; await st.delete('run'); extra.voided = true; }
    let r = { ok: true };
    const wasOver = !run || run.phase === 'over';
    // Pojedynek: po terminie serwer sam decyduje za gracza i rozlicza walkę (zapis od razu, żeby odpowiedź błędu też widziała nowy stan).
    if (run && run.duel && run.phase !== 'over' && this.duelTick(run)) { await st.put({ run }); await this.duelPublish(run, extra); }

    switch (path) {
      case 'state': extra.myGhost = await this.myGhost(pl); break;
      case 'start': {
        if (run && run.phase !== 'over') return json({ err: 'Masz już aktywny run.', code: 'active', ...this.out(profile, run) }, 409);
        if (b.duel) {   // Pojedynek dla 2 osób: konfiguracja i ziarno z BgRanks, ten sam run dla obu graczy, bez wpływu na profil
          const R = this.ranks(); if (!R) return json({ err: 'Pojedynek wymaga serwera.', code: 'duel' }, 409);
          const dp = { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0 };
          const g = await (await R.fetch('https://bg/duel-op', { method: 'POST', body: JSON.stringify({ op: 'start', pl: dp }) })).json();
          if (g.err) return json({ err: g.err, code: g.code || 'duel', ...(g.duel ? { duel: g.duel } : {}), ...this.out(profile, run) }, 409);
          r = newRun({ mode: DUEL.mode, char: g.cfg.char, garnek: g.cfg.garnek, pool: STARTER_TILES.slice(), seed: g.seed, now: this.now() });
          if (r.ok) { run = r.run; run.duel = { code: g.code, dl: 0, sk: '', dealt: 0, pl: dp }; duelSetDl(run, this.now()); }
          else await R.fetch('https://bg/duel-op', { method: 'POST', body: JSON.stringify({ op: 'report', pl: dp, prog: { over: true, ended: 'lose' } }) });
          break;
        }
        if (b.daily) {   // Dyżur dnia: ten sam run dla wszystkich, jedno podejście na dzień, bez premii i Kurnika
          const date = dailyKey(this.now()), d = dailyOf(date);
          if (profile.daily && profile.daily.date === date) return json({ err: 'Dzisiejszy dyżur już odbyty. Wróć jutro.', code: 'daily', ...this.out(profile, run) }, 409);
          r = newRun({ mode: d.mode, char: d.char, garnek: d.garnek, pool: STARTER_TILES.slice(), seed: d.seed, now: this.now(), curses: d.curses });
          if (r.ok) { run = r.run; run.daily = date; profile.daily = { date, status: 'active', used: true, score: 0, rounds: 0, win: false }; }
          break;
        }
        const mode = b.mode, char = b.char, g = Number(b.garnek) | 0;
        if (!MODES[mode]) return json({ err: 'Nieznany tryb.', code: 'mode' }, 400);
        if (!CHARS[char] || CHARS[char].retired || !profile.chars.includes(char)) return json({ err: 'Ta postać jest jeszcze zablokowana.', code: 'char' }, 400);
        if (g < 0 || g > profile.garnek) return json({ err: 'Ten poziom Garnka jest jeszcze zablokowany.', code: 'garnek' }, 400);
        const seed = mix(Date.now() & 0x7fffffff, hash(pl.n), (crypto.getRandomValues(new Uint32Array(1)))[0]);
        // Testament Pyrtka działa w runie inną postacią niż ta, która go spisała (chyba że masz tylko jedną postać).
        const w = profile.will, useWill = !!(w && TILE_BY_ID[w.tile] && !(profile.chars.length > 1 && w.char === char));
        r = newRun({ mode, char, garnek: g, pool: poolFor(profile), seed, now: this.now(), nemesis: profile.nemesis || null, will: useWill ? w.tile : null, curses: Array.isArray(b.curses) ? b.curses.map(String) : [], kurnik: kurnikOpen(profile) ? (profile.kurnik || {}) : {} });
        if (r.ok) {
          run = r.run; if (useWill) profile.will = null;
          const bf = takeBuffs(profile); run.buffs = bf;   // premie z nagród za poziom Stażu (jednorazowe)
          if (bf.coins) { run.coins += bf.coins; run.stats.maxCoins = Math.max(run.stats.maxCoins, run.coins); }
          if (bf.rerolls) run.freeLeft += bf.rerolls;
        }
        break;
      }
      case 'pawn': r = need(run) || pawn(run, String(b.id || '')); break;
      case 'redeem': r = need(run) || redeem(run); break;
      case 'upgrade': r = need(run) || upgrade(run, String(b.id || ''), b.hot === true || b.hot === 1); break;
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
        const ctx = t && t.event === 'arena' && !run.daily && !run.duel ?{ ghost: await this.fetchGhost(pl, run) } : {};
        r = need(run) || pickTile(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut), ctx);
        break;
      }
      case 'kurnik': {   // kupno poziomu budynku w Kurniku za Pióra
        r = kurnikBuy(profile, String(b.id || ''));
        if (r.ok) extra.kurnikBought = { id: r.id, lvl: r.lvl, cost: r.cost };
        break;
      }
      case 'levelchoice': {   // nagroda za poziom Stażu: wybór 1 z 2
        r = levelChoose(profile, Number(b.i));
        if (r.ok) extra.rewardTaken = { reward: r.reward, lvl: r.lvl, v: r.v };
        break;
      }
      case 'shopbuy': {   // Sklepik Zakładowy: kupno kosmetyku za Talony
        r = shopBuyItem(profile, String(b.id || ''));
        if (r.ok) extra.shopBought = { id: r.id, cost: r.cost };
        break;
      }
      case 'wear': r = wearItem(profile, String(b.id || ''), !!b.on); break;
      case 'reroll':
        r = need(run) || reroll(run);
        // Tryb kasynowy: 5 przetasowań na jednym piętrze odblokowuje pytanie (jednorazowo); domyślnie wyłączony do odpowiedzi gracza.
        if (r.ok && run.cur && run.cur.rerolls >= CASINO_REROLLS && !profile.casino) { profile.casino = { unlocked: true, on: false, asked: false }; extra.casinoAsk = true; }
        break;
      case 'casino': {   // włączenie i wyłączenie trybu kasynowego (tylko po odblokowaniu)
        const c = profile.casino;
        if (!c || !c.unlocked) return json({ err: 'Tryb kasynowy jest jeszcze zablokowany.', code: 'casino', ...this.out(profile, run) }, 409);
        c.on = !!b.on; c.asked = true;
        break;
      }
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
      case 'admin-grant': {   // tylko z Workera (nagłówek X-Admin-Key), nie z listy tras gracza: wszystkie postacie i palniki
        for (const id of Object.keys(CHARS)) if (!profile.chars.includes(id)) profile.chars.push(id);
        for (const u of UNLOCKS) if (u.kind === 'char' && !profile.unlocked.includes(u.id)) profile.unlocked.push(u.id);
        profile.garnek = 5;
        extra.granted = { chars: profile.chars.length, garnek: profile.garnek };
        break;
      }
      case 'duel': {   // Pojedynek: stan meczu trzyma BgRanks (utwórz, dołącz, głosuj, odczyt stanu, wyjdź)
        const op = String(b.op || '');
        if ((op === 'create' || op === 'join') && run && run.phase !== 'over' && !run.duel) return json({ err: 'Masz aktywny run. Dokończ go albo porzuć, zanim zaczniesz pojedynek.', code: 'active', ...this.out(profile, run) }, 409);
        const R = this.ranks(); if (!R) return json({ err: 'Pojedynek wymaga serwera.', code: 'duel', ...this.out(profile, run) }, 409);
        const res = await (await R.fetch('https://bg/duel-op', { method: 'POST', body: JSON.stringify({ op, code: b.code, vote: b.vote, pl: { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0 } }) })).json();
        if (res.err) return json({ err: res.err, code: res.code, ...(res.duel ? { duel: res.duel } : {}), ...this.out(profile, run) }, 409);
        extra.duel = res.duel; if (res.created) extra.created = true;
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
    if (run && run.duel) {   // Pojedynek: suma zadanych obrażeń, Prezes kończy run wygraną (bez Dogrywki), nowe okno czasu
      if (r.result) run.duel.dealt += r.result.dealt | 0;
      if (run.phase === 'victory') endRun(run, 'win');
      duelSetDl(run, this.now());
    }
    if (run && path !== 'state' && path !== 'duel' && !run.duel) {   // pojedynek nie wpływa na profil, odblokowania, ranking ani historię
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
        if (!run.daily) await this.saveGhost(pl, run, profile);
        await this.saveHistory(st, pl, run, path === 'abandon');
        if (run.daily && run.done > 0 && this.ranks()) {
          try {
            const res = await this.ranks().fetch('https://bg/daily-submit', { method: 'POST', body: JSON.stringify({ date: run.daily, entry: { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, score: run.score, rounds: run.done, win: run.ended === 'win', at: this.now(), ttl: (profile.wardrobe && profile.wardrobe.eq && profile.wardrobe.eq.title) || '' } }) });
            extra.end.rank = (await res.json()).rank;
          } catch {}
        }
        if (!run.daily && run.done > 0 && this.env && this.env.BG_RANKS) {
          try {
            const res = await this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')).fetch('https://bg/submit', {
              method: 'POST', body: JSON.stringify({ mode: run.mode, entry: { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, score: run.score, rounds: run.done, win: run.ended === 'win', char: run.char, garnek: run.garnek, deep: end.deep || 0, at: this.now(), ttl: (profile.wardrobe && profile.wardrobe.eq && profile.wardrobe.eq.title) || '', ...(path === 'abandon' ? {} : { fl: { round: run.round, died: run.ended !== 'win' && !run.endless } }) } }) });
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
    if (run && run.duel && path !== 'duel') await this.duelPublish(run, extra);
    const o = this.out(profile, run);
    const body = { ok: true, ...o, ...extra };
    if (r.setup) body.setup = r.setup;
    for (const k of ['reward', 'healed', 'result', 'reward', 'boss', 'bonus', 'event', 'crate', 'bought', 'price', 'bet', 'won', 'tile', 'cost', 'left', 'badge', 'automat', 'chose', 'interest', 'grew', 'revealed', 'nemesis', 'pawned', 'redeemed', 'upgraded', 'loot', 'looted', 'dino', 'will', 'victory', 'compUp', 'arena', 'extra', 'extraOffer', 'bossVar', 'route', 'companion', 'upkeep']) if (r[k] !== undefined) body[k] = r[k];
    return json(body);
  }

  // TESTOWA historia gier: pełny dziennik każdego zakończonego runu (ostatnie 30), do analizy balansu. Do usunięcia po testach.
  async saveHistory(st, pl, run, abandoned) {
    try {
      const hist = (await st.get('history')) || [];
      hist.push({ id: run.id, nick: pl.nick, started: run.started, ended: this.now(), mode: run.mode, char: run.char, garnek: run.garnek, outcome: run.ended, abandoned,
        v: run.v, floorsDone: run.done, endedOnRound: run.round, score: run.score, timeBonus: run.timeBonus, coinsLeft: run.coins, buys: run.stats.buys || 0, rerolls: run.stats.rerolls,
        tiles: run.tiles, skills: run.skills, finalStats: statsOf(run), log: run.log,
        // Pełny kontekst runu do analizy: Klątwy, Kurnik, trasy, towarzysz, Nemezis, Okólniki, wady, Odznaki, kafelki rosnące, statystyki runu.
        curses: run.curses || [], kurnik: run.kurnik || {}, routes: run.routes || [], companion: run.companion || null, nemesis: run.nemesis || null, killer: run.killer || null,
        decrees: run.decrees || [], flawed: run.flawed || [], badges: run.badges || [], grow: run.grow || {}, endless: !!run.endless, cleared: run.cleared === undefined ? null : run.cleared, runStats: run.stats || {} });
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
  async saveGhost(pl, run, profile) {
    const R = this.ranks(), g = ghostOf(run); if (!R || !g) return;
    if (profile && profile.wardrobe && profile.wardrobe.eq) g.wear = { ...profile.wardrobe.eq };   // duch pokazuje strój właściciela
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

  // ---------- Pojedynek: terminy i raportowanie ----------
  // Gdy termin minął, serwer wykonuje za gracza bezpieczne decyzje i rozlicza walkę bez wejść. Czas „wirtualny”: kolejne okna liczą się od poprzedniego terminu.
  duelTick(run) {
    const d = run.duel, now = this.now(); let ch = false, n = 0;
    while (d && run.phase !== 'over' && now > d.dl + DUEL.graceMs) {
      if (n++ > 300) { endRun(run, 'lose'); ch = true; break; }
      const virt = d.dl, out = autoStep(run);
      if (!out) { endRun(run, 'lose'); ch = true; break; }
      if (out.result) d.dealt += out.result.dealt | 0;
      if (run.phase === 'victory') endRun(run, 'win');
      duelSetDl(run, virt); ch = true;
    }
    return ch;
  }
  // Raport postępu do BgRanks (piętra, obrażenia, koniec) i budzik na najbliższy termin. Widok meczu trafia do odpowiedzi (extra.duel).
  async duelPublish(run, extra) {
    const d = run.duel, R = this.ranks(); if (!d || !R) return;
    const S = statsOf(run);
    const prog = { done: run.done | 0, dealt: d.dealt | 0, round: run.round | 0, hp: Math.round(100 * run.hp / Math.max(1, S.maxHp)), over: run.phase === 'over', ended: run.ended };
    try { const res = await (await R.fetch('https://bg/duel-op', { method: 'POST', body: JSON.stringify({ op: 'report', pl: d.pl, prog }) })).json(); if (extra && res.duel) extra.duel = res.duel; } catch {}
    if (run.phase !== 'over' && this.ctx.storage.setAlarm) { try { await this.ctx.storage.setAlarm(d.dl + DUEL.graceMs + 500); } catch {} }
  }
  // Budzik Durable Object: termin pojedynku minął, a gracz nic nie robi.
  alarm() {
    const p = this.chain.then(async () => {
      const st = this.ctx.storage, run = await st.get('run');
      if (!run || !run.duel || run.phase === 'over') return;
      if (this.duelTick(run)) await st.put({ run });
      await this.duelPublish(run);
    });
    this.chain = p.catch(() => {});
    return p;
  }

  out(profile, run) { return { profile: publicProfile(profile), run: view(run), daily: dailyView(profile, this.now()), duelRun: run && run.duel ? { code: run.duel.code, dl: run.duel.dl, dealt: run.duel.dealt, now: this.now() } : null }; }
}

function need(run) { return run ? null : { err: 'Nie masz aktywnego runu.', code: 'norun' }; }
