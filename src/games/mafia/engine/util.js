import { isMafiaRole } from './roles.js';

export class GameError extends Error {}
export const fail = msg => { throw new GameError(msg); };

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export const getPlayer = (s, id) => s.players.find(p => p.id === id) || null;
export const living = s => s.players.filter(p => p.alive);
export const isMafia = p => !!p && isMafiaRole(p.role);
export const pad = n => String(n).padStart(2, '0');

export function requireAlive(s, id) {
  const p = getPlayer(s, id);
  if (!p || !p.alive) fail('Ten gracz nie bierze już udziału w grze.');
  return p;
}

export function stat(p) {
  return p.stats || (p.stats = {
    votes: 0, votesOnMafia: 0, suspects: 0, suspectsOnMafia: 0,
    kills: 0, saves: 0, checksMafia: 0, survived: 0, votedAgainst: 0,
  });
}
