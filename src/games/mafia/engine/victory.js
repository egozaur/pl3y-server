// Warunki zwycięstwa, statystyki i MVP.
import { isMafia, living, stat } from './util.js';

export function checkWinner(s) {
  const alive = living(s);
  const mafia = alive.filter(isMafia).length;
  if (mafia === 0) return 'town';
  if (mafia >= alive.length - mafia) return 'mafia';
  return null;
}

// Punktacja MVP: liczy się trafność głosów i podejrzeń, skuteczność umiejętności i przetrwanie.
export function score(s, p) {
  const st = stat(p);
  const won = s.winner && ((s.winner === 'mafia') === isMafia(p));
  let pts = won ? 3 : 0;
  pts += st.survived * 0.5;
  if (isMafia(p)) {
    pts += st.kills * 1.5;
    pts += (st.votes - st.votesOnMafia) * 0.5;      // głosy na miasto
  } else {
    pts += st.votesOnMafia * 2 - (st.votes - st.votesOnMafia) * 0.5;
    pts += st.suspectsOnMafia;
    pts += st.saves * 3 + st.checksMafia * 2;
  }
  return Math.round(pts * 10) / 10;
}

export function finalize(s) {
  for (const p of s.players) {
    stat(p);
    p.revealed = true;
    p.score = score(s, p);
  }
  const ranked = s.players.filter(p => !p.left).slice().sort((a, b) => b.score - a.score || a.no - b.no);
  s.mvp = ranked.length ? ranked[0].id : null;
}
