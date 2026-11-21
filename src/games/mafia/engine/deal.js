// Tajne rozdawanie ról: losowanie i kolejne odsłony „TERAZ GRACZ 01”.
import { presetFor, validateRoles } from './balance.js';
import { ROLE_ORDER } from './roles.js';
import { fail, getPlayer, shuffle } from './util.js';

export function rolesForGame(s) {
  const n = s.players.length;
  const counts = s.settings.mode === 'custom' ? s.settings.roles : presetFor(n);
  const err = validateRoles(counts, n);
  if (err) fail(err);
  return counts;
}

export function dealRoles(s, rng) {
  const counts = rolesForGame(s);
  const bag = [];
  for (const r of ROLE_ORDER) for (let i = 0; i < (counts[r] | 0); i++) bag.push(r);
  const roles = shuffle(bag, rng);
  s.players.forEach((p, i) => {
    Object.assign(p, { role: roles[i], alive: true, left: false, ready: false, grant: false, revealed: false, notes: [], stats: null, seen: [] });
  });
  s.roleCounts = { ...counts };
  s.deal = { order: s.players.map(p => p.id), idx: 0, opened: false };
}

export const dealCurrent = s => (s.deal && s.deal.idx < s.deal.order.length ? s.deal.order[s.deal.idx] : null);
export const dealDone = s => !!s.deal && dealCurrent(s) === null;

function advanceDeal(s) {
  const d = s.deal;
  d.opened = false;
  d.idx++;
  while (d.idx < d.order.length) {
    const p = getPlayer(s, d.order[d.idx]);
    if (p && !p.left && !p.ready) break;
    d.idx++;
  }
}

// Czy telefon gracza pokazuje teraz rolę?
export function canSeeRole(s, p) {
  if (!p || !p.role) return false;
  if (s.phase === 'deal' && dealCurrent(s) === p.id && s.deal.opened) return true;
  return !!p.grantOpen;
}

export function openEnvelope(s, p) {
  if (s.phase === 'deal' && dealCurrent(s) === p.id) { s.deal.opened = true; return; }
  if (p.grant) { p.grant = false; p.grantOpen = true; return; }
  fail(s.phase === 'deal' && !p.ready ? 'Poczekaj na swoją kolej.' : 'Twoja tożsamość jest zapieczętowana. Ponowny podgląd musi zatwierdzić gospodarz.');
}

export function memorized(s, p) {
  if (s.phase === 'deal' && dealCurrent(s) === p.id && s.deal.opened) {
    p.ready = true;
    advanceDeal(s);
    return;
  }
  if (p.grantOpen) { p.grantOpen = false; return; }
  fail('Nie masz otwartej koperty.');
}

// Gospodarz pozwala graczowi raz jeszcze zobaczyć swoją rolę (rola trafia tylko na telefon gracza).
export function grantReveal(s, id) {
  const p = getPlayer(s, id);
  if (!p || !p.role) fail('Ten gracz nie ma jeszcze roli.');
  if (p.left) fail('Ten gracz opuścił grę.');
  if (s.phase === 'deal' && !p.ready) fail('Ten gracz jeszcze nie odebrał roli.');
  p.grant = true;
}

// Usunięty w trakcie rozdania: pomijamy jego kolejkę.
export function skipInDeal(s, id) {
  if (dealCurrent(s) === id) advanceDeal(s);
}
