// Silnik rozgrywki: maszyna faz LOBBY → DEAL → NIGHT → DAY → VOTE → VERDICT → ELIM (→ AVENGER) → … → END.
// apply() przyjmuje akcję hosta lub gracza, waliduje ją i zmienia stan. tick() obsługuje upływ czasu.
// Wszystkie funkcje są czyste względem I/O: czas, losowość i generator tokenów przychodzą w ctx.
import { MIN_PLAYERS } from './balance.js';
import { canSeeRole, dealCurrent, dealDone, dealRoles, grantReveal, memorized, openEnvelope, skipInDeal } from './deal.js';
import { applyBounty, rollEvent } from './events.js';
import { issueRebind, join, removeFromLobby, rename, updateSettings, useRebind } from './lobby.js';
import { nightComplete, resolveNight, startNight, submitNight } from './night.js';
import { fail, GameError, getPlayer, living, stat } from './util.js';
import { checkWinner, finalize } from './victory.js';
import { castVote, closeVote, startVote, voteComplete } from './vote.js';

export { GameError, canSeeRole };

const LASTWORD_SECONDS = 20;
const SILENCE_SECONDS = 60;

// ---------- śmierć i koniec gry ----------

function kill(s, id, cause) {
  const p = getPlayer(s, id);
  if (!p || !p.alive) return;
  p.alive = false;
  p.cause = cause;
  p.diedRound = s.round;
  const masked = cause !== 'night' && s.day && s.day.event === 'masked';
  p.revealed = s.settings.revealRole && !masked;
  s.log.push({ round: s.round, kind: 'death', id, cause });
}

function finish(s, winner) {
  s.phase = 'end';
  s.winner = winner;
  s.endsAt = null; s.remaining = null; s.paused = false;
  s.night = null; s.vote = null; s.avenger = null;
  finalize(s);
}

// Zwraca true, jeśli gra się skończyła.
function settleWinner(s) {
  const w = checkWinner(s);
  if (w) { finish(s, w); return true; }
  return false;
}

// ---------- przejścia między fazami ----------

function startGame(s, ctx) {
  if (s.players.length < MIN_PLAYERS) fail(`Potrzeba co najmniej ${MIN_PLAYERS} graczy.`);
  dealRoles(s, ctx.rng);
  s.phase = 'deal';
  s.game++;
  s.round = 0;
  s.flags = {}; s.history = []; s.log = [];
  s.winner = null; s.mvp = null;
  s.night = s.day = s.vote = s.verdict = s.elim = s.avenger = null;
  s.endsAt = null; s.remaining = null; s.paused = false;
}

function endNight(s, ctx) {
  const report = resolveNight(s, ctx.rng);
  s.night = null;
  s.day = { report, event: null };      // maska nie dotyczy nocy
  if (report.killed) kill(s, report.killed, 'night');
  report.revealed = report.killed ? getPlayer(s, report.killed).revealed : false;
  if (settleWinner(s)) return;
  startDay(s, ctx, report);
}

function startDay(s, ctx, report) {
  const event = rollEvent(s, ctx.rng);
  if (event === 'bounty') applyBounty(s, ctx.rng);
  for (const p of living(s)) stat(p).survived++;
  s.phase = 'day';
  s.day = { report, event };
  s.elim = null; s.verdict = null;
  const secs = event === 'silence' ? SILENCE_SECONDS : s.settings.discussion;
  s.endsAt = ctx.now + secs * 1000;
}

function verdictDuration(result) {
  const rows = result.tallies.filter(t => t.count > 0).length + (result.skip ? 1 : 0);
  return 3600 + rows * 1300 + 3500;
}

function closeVoting(s, ctx) {
  const result = closeVote(s, ctx.rng, { double: s.day && s.day.event === 'double' });
  s.phase = 'verdict';
  s.verdict = result;
  s.vote = null;
  s.endsAt = ctx.now + verdictDuration(result);
}

function afterVerdict(s, ctx) {
  const r = s.verdict;
  if (r.outcome === 'runoff') return startVote(s, ctx.now, r.runoffIds, true);
  if (r.outcome === 'elim') return eliminate(s, ctx, r.eliminated, 'vote');
  s.verdict = null;
  startNight(s, ctx.now);
}

function eliminate(s, ctx, id, cause) {
  kill(s, id, cause);
  const lastword = s.day && s.day.event === 'lastword';
  s.phase = 'elim';
  s.elim = { id, cause, lastWords: lastword ? LASTWORD_SECONDS : null };
  s.verdict = null;
  s.endsAt = lastword ? ctx.now + LASTWORD_SECONDS * 1000 : null;
}

function afterElim(s, ctx) {
  const e = s.elim;
  const p = getPlayer(s, e.id);
  if (e.cause === 'vote' && p.role === 'avenger' && !s.flags.avengerUsed && living(s).length > 0) {
    s.phase = 'avenger';
    s.avenger = { id: p.id };
    s.endsAt = ctx.now + s.settings.avengerTime * 1000;
    return;
  }
  s.elim = null;
  if (settleWinner(s)) return;
  startNight(s, ctx.now);
}

function avenge(s, ctx, target) {
  s.flags.avengerUsed = true;
  const shooter = s.avenger.id;
  s.avenger = null;
  if (target) {
    s.log.push({ round: s.round, kind: 'avenge', id: shooter, target });
    return eliminate(s, ctx, target, 'avenger');
  }
  s.elim = null;
  if (settleWinner(s)) return;
  startNight(s, ctx.now);
}

// Wymuszone przejście dalej (timer albo przycisk gospodarza).
function advance(s, ctx) {
  switch (s.phase) {
    case 'night': return endNight(s, ctx);
    case 'day': return startVote(s, ctx.now);
    case 'vote': return closeVoting(s, ctx);
    case 'verdict': return afterVerdict(s, ctx);
    case 'elim': return afterElim(s, ctx);
    case 'avenger': return avenge(s, ctx, null);
    default: fail('Nie ma czego przyspieszać.');
  }
}

// Automatyczne przejścia po akcjach (wszyscy zatwierdzili noc / oddali głos).
function settle(s, ctx) {
  if (s.paused) return;
  if (s.phase === 'night' && nightComplete(s)) endNight(s, ctx);
  else if (s.phase === 'vote' && voteComplete(s)) closeVoting(s, ctx);
}

// Usunięcie gracza w trakcie gry: „opuścił grę”, bez ujawniania roli.
function leaveGame(s, ctx, id) {
  const p = getPlayer(s, id);
  if (!p) fail('Nie ma takiego gracza.');
  if (p.left) return;
  p.left = true;
  p.alive = false;
  p.revealed = false;
  p.diedRound = s.round;
  p.cause = 'left';
  for (const [t, pid] of Object.entries(s.tokens)) if (pid === id) delete s.tokens[t];
  if (s.rebind && s.rebind.playerId === id) s.rebind = null;
  s.log.push({ round: s.round, kind: 'left', id });
  if (s.phase === 'deal') { skipInDeal(s, id); return; }
  if (s.night) delete s.night.acts[id];
  if (s.vote) {
    delete s.vote.ballots[id];
    for (const [v, t] of Object.entries(s.vote.ballots)) if (t === id) delete s.vote.ballots[v];
    s.vote.candidates = s.vote.candidates.filter(c => c !== id);
  }
  if (s.phase === 'avenger' && s.avenger && s.avenger.id === id) return avenge(s, ctx, null);
  if (s.phase !== 'end' && settleWinner(s)) return;
  settle(s, ctx);
}

// ---------- akcje ----------

const HOST = {
  settings(s, ctx, a) { updateSettings(s, a.patch || {}); },
  kick(s, ctx, a) {
    if (s.phase === 'lobby') removeFromLobby(s, a.id);
    else leaveGame(s, ctx, a.id);
  },
  start(s, ctx) {
    if (s.phase !== 'lobby') fail('Gra już trwa.');
    startGame(s, ctx);
  },
  begin(s, ctx) {
    if (s.phase !== 'deal') fail('To nie jest etap rozdawania ról.');
    if (!dealDone(s)) fail('Nie wszyscy gracze poznali swoje role.');
    if (settleWinner(s)) return;
    startNight(s, ctx.now);
  },
  grant(s, ctx, a) {
    if (s.phase === 'lobby') fail('Role nie zostały jeszcze rozdane.');
    grantReveal(s, a.id);
  },
  rebind(s, ctx, a) {
    return { rebind: issueRebind(s, a.id, ctx.token(), ctx.now) };
  },
  pause(s, ctx) {
    if (s.paused) return;
    if (s.phase === 'lobby' || s.phase === 'end') fail('Nie ma czego pauzować.');
    s.paused = true;
    s.remaining = s.endsAt ? Math.max(0, s.endsAt - ctx.now) : null;
    s.endsAt = null;
  },
  resume(s, ctx) {
    if (!s.paused) return;
    s.paused = false;
    s.endsAt = s.remaining !== null ? ctx.now + s.remaining : null;
    s.remaining = null;
    settle(s, ctx);
  },
  next(s, ctx) {
    if (s.paused) fail('Gra jest zatrzymana.');
    advance(s, ctx);
  },
  extend(s, ctx) {
    if (s.paused || !s.endsAt) fail('Brak aktywnego licznika.');
    s.endsAt += 30 * 1000;
  },
  skipvote(s, ctx) {
    if (s.paused) fail('Gra jest zatrzymana.');
    if (s.phase !== 'day' && s.phase !== 'vote') fail('Głosowanie można pominąć tylko w dzień.');
    s.history.push({ round: s.round, runoff: !!(s.vote && s.vote.runoff), tallies: [], skip: 0, ballots: [], outcome: 'none', eliminated: null, reason: 'skipped' });
    s.vote = null;
    startNight(s, ctx.now);
  },
  rematch(s) {
    if (s.phase !== 'end' && s.phase !== 'deal') fail('Rewanż jest dostępny po zakończeniu gry.');
    s.phase = 'lobby';
    s.players = s.players.filter(p => !p.left);
    for (const p of s.players) Object.assign(p, { role: null, alive: true, left: false, ready: false, grant: false, grantOpen: false, revealed: false, notes: [], stats: null, score: undefined, cause: undefined, diedRound: undefined });
    s.players.forEach((p, i) => { p.no = i + 1; });
    s.round = 0; s.deal = s.night = s.day = s.vote = s.verdict = s.elim = s.avenger = null;
    s.winner = null; s.mvp = null; s.endsAt = null; s.remaining = null; s.paused = false;
    s.flags = {}; s.history = []; s.log = [];
  },
};

const PLAYER = {
  rename(s, ctx, p, a) { rename(s, p.id, a.name); },
  open(s, ctx, p) { openEnvelope(s, p); },
  memorized(s, ctx, p) { memorized(s, p); },
  night(s, ctx, p, a) {
    if (s.paused) fail('Gra jest zatrzymana.');
    submitNight(s, p, a);
  },
  vote(s, ctx, p, a) {
    if (s.paused) fail('Gra jest zatrzymana.');
    castVote(s, p, a.target);
  },
  avenge(s, ctx, p, a) {
    if (s.paused) fail('Gra jest zatrzymana.');
    if (s.phase !== 'avenger' || !s.avenger || s.avenger.id !== p.id) fail('Teraz nie możesz tego zrobić.');
    const t = a.target ?? null;
    if (t !== null) {
      const q = getPlayer(s, t);
      if (!q || !q.alive) fail('Nieprawidłowy cel.');
    }
    avenge(s, ctx, t);
  },
};

// actor: { host: true } albo { pid }. Zwraca dodatkowe dane dla nadawcy (np. kod rebind) albo undefined.
// Rzuca GameError przy niedozwolonym ruchu; stan może być wtedy częściowo nietknięty — wywołujący pracuje na kopii.
export function apply(s, actor, action, ctx) {
  if (!action || typeof action.a !== 'string') fail('Nieznana akcja.');
  let out;
  if (actor.host) {
    const fn = Object.hasOwn(HOST, action.a) ? HOST[action.a] : null;
    if (!fn) fail('Nieznana akcja.');
    out = fn(s, ctx, action);
  } else {
    const p = getPlayer(s, actor.pid);
    if (!p || p.left) fail('Nie jesteś już w tej grze.');
    const fn = Object.hasOwn(PLAYER, action.a) ? PLAYER[action.a] : null;
    if (!fn) fail('Nieznana akcja.');
    out = fn(s, ctx, p, action);
  }
  settle(s, ctx);
  s.rev++;
  s.touchedAt = ctx.now;
  return out;
}

// Upływ czasu. Zwraca true, jeśli stan się zmienił.
export function tick(s, ctx) {
  if (s.paused || !s.endsAt || ctx.now < s.endsAt) return false;
  s.endsAt = null;
  advance(s, ctx);
  settle(s, ctx);
  s.rev++;
  return true;
}

export function joinRoom(s, name, ctx) {
  const token = ctx.token();
  const p = join(s, name, token);
  s.rev++;
  s.touchedAt = ctx.now;
  return { token, player: p };
}

export function rebindRoom(s, code, ctx) {
  const token = ctx.token();
  const p = useRebind(s, code, token, ctx.now);
  s.rev++;
  return { token, player: p };
}

export { dealCurrent };
