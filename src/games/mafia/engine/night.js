// Noc: każdy żywy gracz ma zadanie na telefonie (żeby stukanie nie zdradzało ról), potem rozstrzygnięcie.
import { fail, getPlayer, isMafia, living, stat } from './util.js';

export function startNight(s, now) {
  s.phase = 'night';
  s.round++;
  s.night = { acts: {} };
  s.endsAt = now + s.settings.nightTime * 1000;
}

// Zadanie nocne gracza (albo null, gdy nie żyje).
export function nightTask(s, p) {
  if (!p || !p.alive || s.phase !== 'night') return null;
  const others = living(s).filter(q => q.id !== p.id).map(q => q.id);
  if (isMafia(p)) {
    return { kind: 'kill', targets: living(s).filter(q => !isMafia(q)).map(q => q.id) };
  }
  switch (p.role) {
    case 'doctor':
      return { kind: 'protect', targets: living(s).filter(q => q.id !== s.flags.lastProtected).map(q => q.id), blocked: s.flags.lastProtected || null };
    case 'detective':
      return { kind: 'check', targets: others };
    case 'journalist':
      if (!s.flags.journalistUsed) return { kind: 'compare', targets: others };
      return { kind: 'suspect', targets: others };
    default:
      return { kind: 'suspect', targets: others };
  }
}

export function submitNight(s, p, payload) {
  const task = nightTask(s, p);
  if (!task) fail('Teraz nie możesz działać.');
  const act = { kind: task.kind, target: null, targets: null, confirmed: !!payload.confirm };
  if (task.kind === 'compare') {
    const t = payload.targets;
    if (t === null || t === undefined) {
      // wstrzymanie się: umiejętność zostaje na kolejną noc
    } else {
      if (!Array.isArray(t) || t.length !== 2 || t[0] === t[1]) fail('Wybierz dwóch różnych graczy.');
      if (!t.every(id => task.targets.includes(id))) fail('Nieprawidłowy wybór.');
      act.targets = [t[0], t[1]];
    }
  } else {
    const t = payload.target ?? null;
    if (t !== null && !task.targets.includes(t)) {
      fail(task.kind === 'protect' && t === task.blocked ? 'Nie możesz chronić tej samej osoby dwie noce z rzędu.' : 'Nieprawidłowy wybór.');
    }
    act.target = t;
  }
  s.night.acts[p.id] = act;
}

export function nightProgress(s) {
  const alive = living(s);
  return { done: alive.filter(p => s.night.acts[p.id] && s.night.acts[p.id].confirmed).length, total: alive.length };
}
export const nightComplete = s => { const pr = nightProgress(s); return pr.done >= pr.total; };

// Wybór mafii: większość, przy remisie Don (jeśli żyje i wskazał jednego z remisujących), inaczej losowo.
export function mafiaTarget(s, rng) {
  const tally = new Map();
  let donPick = null;
  for (const p of living(s)) {
    if (!isMafia(p)) continue;
    const a = s.night.acts[p.id];
    if (!a || !a.target) continue;
    const t = getPlayer(s, a.target);
    if (!t || !t.alive || isMafia(t)) continue;
    tally.set(a.target, (tally.get(a.target) || 0) + 1);
    if (p.role === 'don') donPick = a.target;
  }
  if (!tally.size) return null;
  const max = Math.max(...tally.values());
  const top = [...tally.keys()].filter(k => tally.get(k) === max);
  if (top.length === 1) return top[0];
  if (donPick && top.includes(donPick)) return donPick;
  return top[Math.floor(rng() * top.length)];
}

// Rozstrzyga noc. Zwraca raport (publiczny) i zapisuje prywatne notatki. Śmierć wykonuje machine.js.
export function resolveNight(s, rng) {
  const acts = s.night.acts;
  const round = s.round;
  const target = mafiaTarget(s, rng);

  const doctor = living(s).find(p => p.role === 'doctor');
  const protect = doctor && acts[doctor.id] ? acts[doctor.id].target : null;
  s.flags.lastProtected = protect || null;

  const saved = !!target && target === protect;
  if (saved) stat(doctor).saves++;

  // Detektyw (Don raz ukrywa się automatycznie).
  const det = living(s).find(p => p.role === 'detective');
  if (det && acts[det.id] && acts[det.id].target) {
    const t = getPlayer(s, acts[det.id].target);
    let mafia = isMafia(t);
    if (t.role === 'don' && !s.flags.donHidden) { s.flags.donHidden = true; mafia = false; }
    if (mafia) stat(det).checksMafia++;
    det.notes.push({ round, kind: 'check', target: t.id, mafia });
  }

  // Dziennikarz: raz w grze, ta sama frakcja?
  const jour = living(s).find(p => p.role === 'journalist');
  if (jour && acts[jour.id] && acts[jour.id].targets) {
    const [a, b] = acts[jour.id].targets.map(id => getPlayer(s, id));
    s.flags.journalistUsed = true;
    jour.notes.push({ round, kind: 'compare', a: a.id, b: b.id, same: isMafia(a) === isMafia(b) });
  }

  // Podejrzenia (statystyki i MVP).
  for (const p of living(s)) {
    const a = acts[p.id];
    if (!a || a.kind !== 'suspect' || !a.target) continue;
    const st = stat(p);
    st.suspects++;
    if (isMafia(getPlayer(s, a.target))) st.suspectsOnMafia++;
  }

  const killed = target && !saved ? target : null;
  if (killed) for (const m of living(s)) if (isMafia(m)) stat(m).kills++;

  return { round, attacked: !!target, saved, killed };
}
