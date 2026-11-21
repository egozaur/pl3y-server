// Bulgot: Durable Object „BgPlayer” (jeden na gracza, klucz = znormalizowany nick). Trzyma profil (odblokowania, wyniki)
// i aktywny run. Całą logikę gry liczy serwer: oferty, rerolle, zakupy, walki (powtórka z wejść gracza).
//
// Gracz przychodzi już sprawdzony przez Worker (index.js → playerFromToken): body.pl = { n, nick, avatar }.
// Klucze: „profile”, „run”. Trasy (POST): /state /start /pick /reroll /shop /bet /bonus /fightstart /fightfinish /abandon.
// Odpowiedź: { ok, profile, run, ...wynik akcji } albo { err, code } z kodem 400/409.
import { mix, hash } from './rng.js';
import { newRun, pickTile, reroll, buyOffer, rest, shopBuy, bet, bonusPick, fightSetup, fightFinish, abandon, view, statsOf } from './rules.js';
import { newProfile, poolFor, evaluate, onBossKill, onRunEnd, markSeen, publicProfile } from './profile.js';
import { MODES, CHARS } from './data.js';

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
    let r = { ok: true };
    const wasOver = !run || run.phase === 'over';

    switch (path) {
      case 'state': break;
      case 'start': {
        if (run && run.phase !== 'over') return json({ err: 'Masz już aktywny run.', code: 'active', ...this.out(profile, run) }, 409);
        const mode = b.mode, char = b.char, g = Number(b.garnek) | 0;
        if (!MODES[mode]) return json({ err: 'Nieznany tryb.', code: 'mode' }, 400);
        if (!CHARS[char] || !profile.chars.includes(char)) return json({ err: 'Ta postać jest jeszcze zablokowana.', code: 'char' }, 400);
        if (g < 0 || g > profile.garnek) return json({ err: 'Ten poziom Garnka jest jeszcze zablokowany.', code: 'garnek' }, 400);
        const seed = mix(Date.now() & 0x7fffffff, hash(pl.n), (crypto.getRandomValues(new Uint32Array(1)))[0]);
        r = newRun({ mode, char, garnek: g, pool: poolFor(profile), seed, now: this.now() });
        if (r.ok) run = r.run;
        break;
      }
      case 'pick': r = need(run) || pickTile(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'reroll': r = need(run) || reroll(run); break;
      case 'rest': r = need(run) || rest(run); break;
      case 'buy': r = need(run) || buyOffer(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'shop': r = need(run) || shopBuy(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'bet': r = need(run) || bet(run, Number(b.amount)); break;
      case 'bonus': r = need(run) || bonusPick(run, Number(b.i), b.slot === undefined ? undefined : Number(b.slot), b.mut === undefined ? undefined : Number(b.mut)); break;
      case 'fightstart': r = need(run) || fightSetup(run); break;
      case 'fightfinish': r = need(run) || fightFinish(run, Array.isArray(b.inputs) ? b.inputs : []); break;
      case 'abandon': r = need(run) || abandon(run); break;
      case 'history': break;
      default: return json({ err: 'Nie znaleziono.' }, 404);
    }
    if (r.err) return json({ err: r.err, code: r.code, ...this.out(profile, run) }, 409);

    // Skutki uboczne: odblokowania, boss, koniec runu, ranking.
    if (run && path !== 'state') {
      if (r.boss) onBossKill(profile, r.boss);
      markSeen(profile, run.tiles);
      const fresh = evaluate(profile, run);
      if (run.phase === 'over' && !wasOver) {
        const end = onRunEnd(profile, run);
        fresh.push(...evaluate(profile, run));
        extra.end = { ...end, score: run.score, rounds: run.done, ended: run.ended };
        await this.saveHistory(st, pl, run, path === 'abandon');
        if (run.done > 0 && this.env && this.env.BG_RANKS) {
          try {
            const res = await this.env.BG_RANKS.get(this.env.BG_RANKS.idFromName('ranks')).fetch('https://bg/submit', {
              method: 'POST', body: JSON.stringify({ mode: run.mode, entry: { n: pl.n, nick: pl.nick, avatar: pl.avatar || 0, score: run.score, rounds: run.done, win: run.ended === 'win', char: run.char, garnek: run.garnek, at: this.now() } }) });
            extra.end.rank = (await res.json()).rank;
          } catch {}
        }
      }
      if (fresh.length) extra.unlocks = fresh.map(u => ({ id: u.id, kind: u.kind, target: u.target, text: u.text }));
    }
    if (path === 'history') extra.history = (await st.get('history')) || [];
    await st.put({ profile, ...(run ? { run } : {}) });
    const o = this.out(profile, run);
    const body = { ok: true, ...o, ...extra };
    if (r.setup) body.setup = r.setup;
    for (const k of ['healed', 'result', 'reward', 'boss', 'bonus', 'event', 'crate', 'bought', 'price', 'bet', 'won', 'tile', 'cost', 'left']) if (r[k] !== undefined) body[k] = r[k];
    return json(body);
  }

  // TESTOWA historia gier: pełny dziennik każdego zakończonego runu (ostatnie 30), do analizy balansu. Do usunięcia po testach.
  async saveHistory(st, pl, run, abandoned) {
    try {
      const hist = (await st.get('history')) || [];
      hist.push({ id: run.id, nick: pl.nick, started: run.started, ended: this.now(), mode: run.mode, char: run.char, garnek: run.garnek, outcome: run.ended, abandoned,
        floorsDone: run.done, endedOnRound: run.round, score: run.score, timeBonus: run.timeBonus, coinsLeft: run.coins, buys: run.stats.buys || 0, rerolls: run.stats.rerolls,
        tiles: run.tiles, skills: run.skills, finalStats: statsOf(run), log: run.log });
      while (hist.length > 30) hist.shift();
      await st.put('history', hist);
    } catch (e) {}
  }

  out(profile, run) { return { profile: publicProfile(profile), run: view(run) }; }
}

function need(run) { return run ? null : { err: 'Nie masz aktywnego runu.', code: 'norun' }; }
