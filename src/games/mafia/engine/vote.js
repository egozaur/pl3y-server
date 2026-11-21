// Głosowanie: tajne do zamknięcia, dogrywka przy remisie, możliwość wstrzymania się (SKIP).
import { fail, getPlayer, isMafia, living, stat } from './util.js';

export const SKIP = 'skip';

export function startVote(s, now, candidates, runoff) {
  s.phase = 'vote';
  s.vote = { candidates: candidates || living(s).map(p => p.id), runoff: !!runoff, ballots: {} };
  s.verdict = null;
  s.endsAt = now + s.settings.voteTime * 1000;
}

export function voteOptions(s, p) {
  if (s.phase !== 'vote' || !p || !p.alive) return null;
  return s.vote.candidates.filter(id => id !== p.id);
}

export function castVote(s, p, target) {
  const opts = voteOptions(s, p);
  if (!opts) fail('Teraz nie możesz głosować.');
  if (target !== SKIP && !opts.includes(target)) fail(target === p.id ? 'Nie możesz głosować na siebie.' : 'Nieprawidłowy głos.');
  s.vote.ballots[p.id] = target;
}

export function voteProgress(s) {
  const alive = living(s);
  return { done: alive.filter(p => s.vote.ballots[p.id] !== undefined).length, total: alive.length };
}
export const voteComplete = s => { const pr = voteProgress(s); return pr.done >= pr.total; };

// Zamyka głosowanie i wylicza wynik. outcome: 'elim' | 'runoff' | 'none'.
export function closeVote(s, rng, opts = {}) {
  const v = s.vote;
  const tally = Object.fromEntries(v.candidates.map(id => [id, 0]));
  let skip = 0;
  const ballots = [];
  for (const p of living(s)) {
    const b = v.ballots[p.id];
    if (b === undefined) continue;
    ballots.push({ voter: p.id, target: b });
    if (b === SKIP) { skip++; continue; }
    if (!(b in tally)) continue;
    tally[b]++;
    const st = stat(p);
    st.votes++;
    if (isMafia(getPlayer(s, b))) st.votesOnMafia++;
    stat(getPlayer(s, b)).votedAgainst++;
  }
  const tallies = Object.entries(tally).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  const top = tallies.length ? tallies[0].count : 0;
  let outcome = 'none', eliminated = null, runoffIds = null, reason = 'nobody';

  if (top === 0) reason = 'nobody';
  else if (skip >= top) reason = 'skip';
  else {
    const leaders = tallies.filter(t => t.count === top).map(t => t.id);
    if (opts.double && !v.runoff) {
      // PODWÓJNE PODEJRZENIE: dwie osoby z największą liczbą głosów idą do dodatkowego głosowania.
      const withVotes = tallies.filter(t => t.count > 0);
      if (withVotes.length >= 2) {
        // Remis na szczycie: do dogrywki idą wszyscy remisujący. Jeden lider: dobieramy drugie miejsce (remis losujemy).
        const pool = leaders.slice();
        if (pool.length < 2) {
          const second = withVotes.filter(t => t.count === withVotes[1].count).map(t => t.id);
          pool.push(second[Math.floor(rng() * second.length)]);
        }
        outcome = 'runoff'; runoffIds = pool; reason = 'double';
      } else { outcome = 'elim'; eliminated = leaders[0]; reason = 'majority'; }
    } else if (leaders.length === 1) { outcome = 'elim'; eliminated = leaders[0]; reason = 'majority'; }
    else if (!v.runoff) { outcome = 'runoff'; runoffIds = leaders; reason = 'tie'; }
    else reason = 'tie-again';
  }

  const result = { round: s.round, runoff: v.runoff, tallies, skip, ballots, outcome, eliminated, runoffIds, reason };
  s.history.push(result);
  return result;
}
