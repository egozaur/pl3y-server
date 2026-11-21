// Tryb CHAOS: losowe wydarzenie na początku dnia (wyłączone w CLASSIC).
import { isMafia, living, shuffle } from './util.js';

export const EVENTS = {
  silence:  { name: 'Cisza nocna',          desc: 'Dyskusja trwa dziś tylko 60 sekund.' },
  lastword: { name: 'Ostatnie słowo',       desc: 'Wyeliminowany dziś gracz ma 20 sekund na ostatnią wypowiedź.' },
  double:   { name: 'Podwójne podejrzenie', desc: 'Dwie osoby z największą liczbą głosów trafią pod dodatkowe głosowanie.' },
  masked:   { name: 'Zamaskowany',          desc: 'Rola osoby wyeliminowanej dziś nie zostanie ujawniona.' },
  bounty:   { name: 'Nagroda detektywa',    desc: 'Detektyw otrzymuje dodatkową, poufną wskazówkę.' },
};
export const EVENT_CHANCE = 0.6;

export function rollEvent(s, rng) {
  if (!s.settings.events) return null;
  if (rng() >= EVENT_CHANCE) return null;
  const det = living(s).find(p => p.role === 'detective');
  const pool = Object.keys(EVENTS).filter(k => k !== 'bounty' || det);
  return pool[Math.floor(rng() * pool.length)];
}

// NAGRODA DETEKTYWA: trzech żywych graczy (bez detektywa), wśród których jest co najmniej jeden członek mafii.
export function applyBounty(s, rng) {
  const det = living(s).find(p => p.role === 'detective');
  if (!det) return;
  const others = living(s).filter(p => p !== det);
  const mafia = others.filter(isMafia);
  if (!mafia.length) return;
  const m = mafia[Math.floor(rng() * mafia.length)];
  const rest = shuffle(others.filter(p => p !== m), rng).slice(0, 2);
  const trio = shuffle([m, ...rest], rng).map(p => p.id);
  det.notes.push({ round: s.round, kind: 'bounty', targets: trio });
}

export const eventInfo = id => (id && EVENTS[id] ? { id, ...EVENTS[id] } : null);
