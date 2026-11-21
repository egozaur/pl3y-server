// Automatyczny balans ról i walidacja zestawów CUSTOM.
import { ROLE_ORDER } from './roles.js';

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 16;

// gracze: [mafia, detektyw, lekarz, mściciel, dziennikarz, obywatele]
const TABLE = {
  5:  [1, 1, 0, 0, 0, 3],
  6:  [1, 1, 1, 0, 0, 3],
  7:  [2, 1, 1, 0, 0, 3],
  8:  [2, 1, 1, 0, 0, 4],
  9:  [2, 1, 1, 0, 0, 5],
  10: [3, 1, 1, 0, 0, 5],
  11: [3, 1, 1, 1, 0, 5],
  12: [3, 1, 1, 1, 1, 5],
  13: [4, 1, 1, 1, 1, 5],
  14: [4, 1, 1, 1, 1, 6],
  15: [4, 1, 1, 1, 1, 7],
  16: [5, 1, 1, 1, 1, 7],
};

export function presetFor(n) {
  const row = TABLE[Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n))];
  const [mafia, detective, doctor, avenger, journalist, citizen] = row;
  const don = mafia >= 2 ? 1 : 0;
  return { don, mafioso: mafia - don, detective, doctor, avenger, journalist, citizen };
}

export const total = counts => ROLE_ORDER.reduce((s, r) => s + (counts[r] | 0), 0);
export const mafiaCount = counts => (counts.don | 0) + (counts.mafioso | 0);

// Zwraca komunikat błędu albo null.
export function validateRoles(counts, n) {
  if (!counts || typeof counts !== 'object') return 'Brak zestawu ról.';
  for (const r of ROLE_ORDER) {
    const v = counts[r] ?? 0;
    if (!Number.isInteger(v) || v < 0 || v > MAX_PLAYERS) return 'Nieprawidłowa liczba ról.';
  }
  for (const r of ['don', 'detective', 'doctor', 'avenger', 'journalist']) {
    if ((counts[r] | 0) > 1) return 'Role specjalne mogą wystąpić najwyżej raz.';
  }
  const m = mafiaCount(counts);
  if (m < 1) return 'Potrzebny jest co najmniej jeden członek mafii.';
  if (total(counts) !== n) return `Liczba ról (${total(counts)}) musi równać się liczbie graczy (${n}).`;
  if (m * 2 >= n) return 'Mafia musi być w mniejszości, inaczej wygrywa od razu.';
  return null;
}

export function normalizeCounts(counts) {
  const out = {};
  for (const r of ROLE_ORDER) out[r] = Math.max(0, Math.min(MAX_PLAYERS, parseInt(counts?.[r], 10) || 0));
  return out;
}
