// Lobby i zarządzanie graczami: dołączanie, numeracja, usuwanie, ustawienia, ponowne powiązanie telefonu.
import { MAX_PLAYERS, MIN_PLAYERS, normalizeCounts, presetFor } from './balance.js';
import { fail, getPlayer } from './util.js';

export const DISCUSSION = [90, 180, 300];
export const MODES = ['classic', 'chaos', 'custom'];
export const REBIND_TTL = 5 * 60 * 1000;

export function createState(code, hostToken, now) {
  return {
    v: 1, code, rev: 0, createdAt: now, touchedAt: now,
    hostToken,
    tokens: {},            // playerToken -> playerId (tylko serwer)
    rebind: null,          // { token, playerId, exp }
    nextId: 1,
    settings: {
      mode: 'classic', expected: 8, discussion: 180,
      nightTime: 60, voteTime: 60, avengerTime: 30,
      revealRole: true, events: false, roles: presetFor(8),
    },
    players: [],
    phase: 'lobby', paused: false, endsAt: null, remaining: null,
    round: 0, game: 0,
    deal: null, night: null, day: null, vote: null, verdict: null, elim: null, avenger: null,
    flags: {}, history: [], log: [], winner: null, mvp: null,
  };
}

const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);

export function renumber(s) {
  s.players.forEach((p, i) => { p.no = i + 1; });
}

export function join(s, name, token) {
  if (s.phase !== 'lobby') fail('Gra już trwa. Poproś gospodarza o kod QR dla Twojego miejsca.');
  const nm = cleanName(name);
  if (nm.length < 2) fail('Pseudonim musi mieć co najmniej 2 znaki.');
  if (s.players.length >= MAX_PLAYERS) fail(`Pokój jest pełny (maks. ${MAX_PLAYERS} graczy).`);
  if (s.players.some(p => p.name.toLowerCase() === nm.toLowerCase())) fail('Ten pseudonim jest już zajęty.');
  const p = { id: 'p' + s.nextId++, no: 0, name: nm, alive: true, left: false, role: null, ready: false, grant: false, revealed: false, notes: [], stats: null, seen: [] };
  s.players.push(p);
  renumber(s);
  s.tokens[token] = p.id;
  return p;
}

function dropTokens(s, id) {
  for (const [t, pid] of Object.entries(s.tokens)) if (pid === id) delete s.tokens[t];
  if (s.rebind && s.rebind.playerId === id) s.rebind = null;
}

// Usunięcie w lobby kasuje gracza. W trakcie gry oznacza go jako „opuścił grę”; tym zajmuje się machine.js.
export function removeFromLobby(s, id) {
  if (!getPlayer(s, id)) fail('Nie ma takiego gracza.');
  s.players = s.players.filter(p => p.id !== id);
  dropTokens(s, id);
  renumber(s);
}

export function rename(s, id, name) {
  const p = getPlayer(s, id);
  if (!p) fail('Nie ma takiego gracza.');
  if (s.phase !== 'lobby') fail('Pseudonim można zmienić tylko w lobby.');
  const nm = cleanName(name);
  if (nm.length < 2) fail('Pseudonim musi mieć co najmniej 2 znaki.');
  if (s.players.some(q => q !== p && q.name.toLowerCase() === nm.toLowerCase())) fail('Ten pseudonim jest już zajęty.');
  p.name = nm;
}

export function updateSettings(s, patch) {
  if (s.phase !== 'lobby') fail('Ustawienia można zmieniać tylko przed rozpoczęciem gry.');
  const st = s.settings;
  if (patch.mode !== undefined) {
    if (!MODES.includes(patch.mode)) fail('Nieznany tryb gry.');
    st.mode = patch.mode;
    st.events = patch.mode === 'chaos' ? true : patch.mode === 'classic' ? false : st.events;
  }
  if (patch.expected !== undefined) {
    const n = parseInt(patch.expected, 10);
    if (!(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) fail(`Liczba graczy: ${MIN_PLAYERS}–${MAX_PLAYERS}.`);
    st.expected = n;
  }
  if (patch.discussion !== undefined) {
    const d = parseInt(patch.discussion, 10);
    if (!DISCUSSION.includes(d)) fail('Nieprawidłowy czas dyskusji.');
    st.discussion = d;
  }
  if (patch.revealRole !== undefined) st.revealRole = !!patch.revealRole;
  if (patch.events !== undefined && st.mode === 'custom') st.events = !!patch.events;
  if (patch.roles !== undefined) {
    if (st.mode !== 'custom') fail('Role ręcznie ustawia się w trybie CUSTOM.');
    st.roles = normalizeCounts(patch.roles);
  }
  if (st.mode !== 'custom') st.roles = presetFor(st.expected);
}

// Jednorazowy kod do (ponownego) powiązania telefonu z miejscem gracza.
export function issueRebind(s, id, token, now) {
  const p = getPlayer(s, id);
  if (!p) fail('Nie ma takiego gracza.');
  if (p.left) fail('Ten gracz opuścił grę.');
  s.rebind = { token, playerId: id, exp: now + REBIND_TTL };
  return s.rebind;
}

export function useRebind(s, token, newToken, now) {
  const rb = s.rebind;
  if (!rb || rb.token !== token || rb.exp < now) fail('Ten kod jest nieważny albo został już użyty.');
  const p = getPlayer(s, rb.playerId);
  s.rebind = null;
  if (!p || p.left) fail('Ten gracz opuścił grę.');
  dropTokens(s, p.id);      // stary telefon traci dostęp
  s.tokens[newToken] = p.id;
  return p;
}
