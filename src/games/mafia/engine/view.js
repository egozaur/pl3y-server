// Projekcje stanu: JEDYNE miejsce, w którym decyduje się, co trafia do klientów.
// Ekran (i gospodarz) dostają tylko fakty publiczne. Gracz dodatkowo dostaje własne, prywatne dane.
import { canSeeRole, dealCurrent } from './deal.js';
import { eventInfo } from './events.js';
import { nightProgress, nightTask } from './night.js';
import { roleCard } from './roles.js';
import { getPlayer, isMafia } from './util.js';
import { voteOptions, voteProgress } from './vote.js';

function publicView(s, online) {
  const end = s.phase === 'end';
  const v = {
    code: s.code, rev: s.rev, phase: s.phase, paused: s.paused,
    endsAt: s.endsAt, remaining: s.remaining, round: s.round, game: s.game,
    settings: {
      mode: s.settings.mode, expected: s.settings.expected, discussion: s.settings.discussion,
      revealRole: s.settings.revealRole, events: s.settings.events, roles: s.settings.roles,
    },
    roleCounts: s.phase === 'lobby' ? null : s.roleCounts || null,
    players: s.players.map(p => ({
      id: p.id, no: p.no, name: p.name, alive: p.alive, left: p.left,
      online: online ? online.has(p.id) : false,
      ready: s.phase === 'deal' ? p.ready : undefined,
      role: p.revealed ? p.role : undefined,
      cause: p.alive ? undefined : p.cause,
      diedRound: p.alive ? undefined : p.diedRound,
    })),
    deal: s.phase === 'deal' ? { current: dealCurrent(s), opened: s.deal.opened } : null,
    night: s.phase === 'night' ? nightProgress(s) : null,
    day: s.day && ['day', 'vote', 'verdict', 'elim', 'avenger'].includes(s.phase)
      ? { report: s.day.report, event: eventInfo(s.day.event) } : null,
    vote: s.phase === 'vote' ? {
      candidates: s.vote.candidates, runoff: s.vote.runoff,
      voted: Object.keys(s.vote.ballots), ...voteProgress(s),
    } : null,
    verdict: s.phase === 'verdict' ? s.verdict : null,
    elim: s.phase === 'elim' ? s.elim : null,
    avenger: s.phase === 'avenger' ? { id: s.avenger.id } : null,
    history: s.history,
    winner: s.winner,
    end: end ? {
      mvp: s.mvp,
      stats: s.players.filter(p => !p.left).map(p => ({ id: p.id, role: p.role, score: p.score, stats: p.stats })),
    } : null,
  };
  return v;
}

export function viewForScreen(s, online, now) {
  const v = publicView(s, online);
  v.host = {
    rebind: s.rebind && s.rebind.exp > now ? { playerId: s.rebind.playerId, token: s.rebind.token, exp: s.rebind.exp } : null,
    grants: s.players.filter(p => p.grant || p.grantOpen).map(p => p.id),
  };
  return v;
}

export function viewForPlayer(s, pid, online) {
  const v = publicView(s, online);
  const p = getPlayer(s, pid);
  if (!p) return v;
  const inDealTurn = s.phase === 'deal' && dealCurrent(s) === p.id;
  const showRole = canSeeRole(s, p);
  v.me = {
    id: p.id, no: p.no, name: p.name, alive: p.alive, left: p.left, ready: p.ready,
    turn: inDealTurn,
    canOpen: (inDealTurn && !s.deal.opened) || (!!p.grant && !p.grantOpen),
    roleOpen: showRole,
    notes: p.notes || [],
  };
  if (showRole) {
    v.role = roleCard(p.role);
    if (isMafia(p)) {
      v.role.team = s.players.filter(q => q !== p && isMafia(q) && !q.left).map(q => ({ id: q.id, don: q.role === 'don' }));
    }
  }
  if (s.phase === 'night' && !s.paused) {
    const t = nightTask(s, p);
    if (t) {
      const act = s.night.acts[p.id];
      t.choice = act ? (t.kind === 'compare' ? act.targets : act.target) : undefined;
      t.confirmed = !!(act && act.confirmed);
      if (t.kind === 'kill') {
        t.partners = s.players.filter(q => q !== p && q.alive && isMafia(q)).map(q => {
          const a = s.night.acts[q.id];
          return { id: q.id, don: q.role === 'don', target: a ? a.target : null, confirmed: !!(a && a.confirmed) };
        });
        t.don = p.role === 'don';
      }
      v.task = t;
    }
  }
  if (s.phase === 'vote') {
    const opts = voteOptions(s, p);
    if (opts) v.ballot = { options: opts, choice: s.vote.ballots[p.id] };
  }
  if (s.phase === 'avenger' && s.avenger.id === p.id) {
    v.shot = { targets: s.players.filter(q => q.alive).map(q => q.id) };
  }
  return v;
}
