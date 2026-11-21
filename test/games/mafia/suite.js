// Scenariusze silnika. Uruchamiane przez node:test (engine.test.js) i w przeglądarce (run.html).
import { MAX_PLAYERS, MIN_PLAYERS, presetFor, total, validateRoles } from '../../../src/games/mafia/engine/balance.js';
import { createState } from '../../../src/games/mafia/engine/lobby.js';
import { apply, joinRoom, rebindRoom, tick } from '../../../src/games/mafia/engine/machine.js';
import { checkWinner } from '../../../src/games/mafia/engine/victory.js';
import { viewForPlayer, viewForScreen } from '../../../src/games/mafia/engine/view.js';

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- narzędzia ----------
function assert(c, msg) { if (!c) throw new Error('Asercja: ' + (msg || '')); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function throws(fn, re, msg) {
  try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`${msg || 'throws'}: zły komunikat „${e.message}”`); return; }
  throw new Error((msg || 'throws') + ': brak wyjątku');
}
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mkCtx(seed = 1) {
  let n = 0;
  return { now: 1_000_000, rng: rngFrom(seed), token: () => 'tok' + (++n) + '_' + seed };
}
const H = { host: true };
const P = id => ({ pid: id });

function lobby(n, ctx = mkCtx()) {
  const s = createState('ABCDE', 'hosttok', ctx.now);
  const toks = [];
  for (let i = 0; i < n; i++) toks.push(joinRoom(s, 'Gracz' + (i + 1), ctx).token);
  return { s, ctx, toks };
}
// Gra z wymuszonymi rolami (po kolei dla p1..pn), wszyscy odebrali role, trwa noc 1.
function game(roles, ctx = mkCtx(), settings) {
  const { s, toks } = lobby(roles.length, ctx);
  if (settings) Object.assign(s.settings, settings);
  apply(s, H, { a: 'start' }, ctx);
  s.players.forEach((p, i) => { p.role = roles[i]; });
  for (const p of s.players) { apply(s, P(p.id), { a: 'open' }, ctx); apply(s, P(p.id), { a: 'memorized' }, ctx); }
  apply(s, H, { a: 'begin' }, ctx);
  return { s, ctx, toks };
}
const id = (s, no) => s.players[no - 1].id;
// Wszyscy żywi zatwierdzają noc; overrides: { no: payload }
function night(s, ctx, overrides = {}) {
  assert(s.phase === 'night', 'oczekiwano nocy, jest ' + s.phase);
  for (const p of s.players.filter(p => p.alive)) {
    const o = overrides[p.no];
    apply(s, P(p.id), { a: 'night', target: null, ...(o || {}), confirm: true }, ctx);
  }
}
function votes(s, ctx, map) { // map: { voterNo: targetNo | 'skip' }
  for (const [v, t] of Object.entries(map)) apply(s, P(id(s, +v)), { a: 'vote', target: t === 'skip' ? 'skip' : id(s, t) }, ctx);
}
function finishVote(s, ctx) { if (s.phase === 'vote') apply(s, H, { a: 'next' }, ctx); }
const next = (s, ctx) => apply(s, H, { a: 'next' }, ctx);

// Żadnych ról żywych/niezdemaskowanych w widoku ekranu i w widoku obcego gracza.
function assertNoLeak(s, viewerId) {
  const scr = viewForScreen(s, new Set(), 0);
  for (const p of scr.players) {
    const real = s.players.find(q => q.id === p.id);
    if (s.phase !== 'end' && !real.revealed) assert(p.role === undefined, 'wyciek roli na ekranie: ' + p.id);
  }
  assert(!('role' in scr) && !('task' in scr) && !('me' in scr), 'ekran ma dane prywatne');
  const txt = JSON.stringify(scr);
  assert(!txt.includes('"notes"') && !txt.includes('tok'), 'ekran ma notatki lub tokeny');
  if (viewerId) {
    const pv = viewForPlayer(s, viewerId, new Set());
    const t = JSON.stringify(pv);
    assert(!t.includes('tok'), 'tokeny w widoku gracza');
    for (const p of pv.players) {
      const real = s.players.find(q => q.id === p.id);
      if (s.phase !== 'end' && !real.revealed) assert(p.role === undefined, 'wyciek roli obcego gracza');
    }
  }
}

// ---------- balans ----------
test('presety 5–16 sumują się i przechodzą walidację', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const c = presetFor(n);
    eq(total(c), n, 'suma ' + n);
    eq(validateRoles(c, n), null, 'walidacja ' + n);
    assert((c.don ? 1 : 0) === ((c.don + c.mafioso) >= 2 ? 1 : 0), 'don tylko przy 2+ mafii');
  }
  eq(presetFor(16).mafioso + presetFor(16).don, 5);
  eq(presetFor(12).journalist, 1);
});
test('walidacja zestawu CUSTOM', () => {
  assert(validateRoles({ mafioso: 0, citizen: 5 }, 5), 'brak mafii');
  assert(validateRoles({ mafioso: 3, citizen: 3 }, 6), 'mafia >= połowa');
  assert(validateRoles({ mafioso: 1, doctor: 2, citizen: 2 }, 5), 'dwóch lekarzy');
  assert(validateRoles({ mafioso: 1, citizen: 3 }, 5), 'zła suma');
  eq(validateRoles({ mafioso: 1, don: 1, citizen: 3 }, 5), null);
});

// ---------- lobby ----------
test('dołączanie, numeracja, duplikaty, limit i usuwanie', () => {
  const { s, ctx } = lobby(3);
  eq(s.players.map(p => p.no), [1, 2, 3]);
  throws(() => joinRoom(s, 'gracz1', ctx), /zajęty/);
  throws(() => joinRoom(s, 'x', ctx), /2 znaki/);
  apply(s, H, { a: 'kick', id: id(s, 2) }, ctx);
  eq(s.players.map(p => p.no), [1, 2]);
  eq(Object.keys(s.tokens).length, 2, 'token usuniętego skasowany');
  for (let i = 0; i < 14; i++) joinRoom(s, 'Nowy' + i, ctx);
  throws(() => joinRoom(s, 'Nadmiar', ctx), /pełny/);
});
test('start wymaga 5 graczy; po starcie nie można dołączyć', () => {
  const { s, ctx } = lobby(4);
  throws(() => apply(s, H, { a: 'start' }, ctx), /co najmniej 5/);
  joinRoom(s, 'Piąty', ctx);
  apply(s, H, { a: 'start' }, ctx);
  eq(s.phase, 'deal');
  throws(() => joinRoom(s, 'Szósty', ctx), /już trwa/);
});
test('ustawienia: tryby, CUSTOM, czas dyskusji', () => {
  const { s, ctx } = lobby(6);
  apply(s, H, { a: 'settings', patch: { mode: 'chaos', discussion: 90, expected: 6 } }, ctx);
  eq(s.settings.events, true);
  eq(s.settings.roles, presetFor(6));
  throws(() => apply(s, H, { a: 'settings', patch: { roles: { mafioso: 2, citizen: 4 } } }, ctx), /CUSTOM/);
  throws(() => apply(s, H, { a: 'settings', patch: { discussion: 77 } }, ctx), /czas/);
  apply(s, H, { a: 'settings', patch: { mode: 'custom', roles: { mafioso: 1, doctor: 1, citizen: 3 } } }, ctx);
  throws(() => apply(s, H, { a: 'start' }, ctx), /musi równać się/);
  apply(s, H, { a: 'settings', patch: { roles: { mafioso: 2, doctor: 1, citizen: 3 } } }, ctx);
  apply(s, H, { a: 'start' }, ctx);
  eq(s.players.filter(p => p.role === 'mafioso').length, 2);
});
test('gracz nie może wykonywać akcji gospodarza', () => {
  const { s, ctx } = lobby(5);
  throws(() => apply(s, P(id(s, 1)), { a: 'start' }, ctx), /Nieznana/);
  throws(() => apply(s, P(id(s, 1)), { a: 'kick', id: id(s, 2) }, ctx), /Nieznana/);
  throws(() => apply(s, P('p999'), { a: 'open' }, ctx), /Nie jesteś/);
  throws(() => apply(s, H, { a: '__proto__' }, ctx), /Nieznana/);
});

// ---------- rozdanie ----------
test('rozdanie po kolei, rola tylko u właściciela i tylko przy otwartej kopercie', () => {
  const { s, ctx } = lobby(6);
  apply(s, H, { a: 'start' }, ctx);
  const [a, b] = [id(s, 1), id(s, 2)];
  throws(() => apply(s, P(b), { a: 'open' }, ctx), /kolej/);
  assert(!viewForPlayer(s, a, null).role, 'rola przed otwarciem');
  apply(s, P(a), { a: 'open' }, ctx);
  assert(viewForPlayer(s, a, null).role, 'brak roli po otwarciu');
  assert(!viewForPlayer(s, b, null).role, 'rola u innego gracza');
  assertNoLeak(s, b);
  throws(() => apply(s, H, { a: 'begin' }, ctx), /Nie wszyscy/);
  apply(s, P(a), { a: 'memorized' }, ctx);
  assert(!viewForPlayer(s, a, null).role, 'rola po zapamiętaniu');
  throws(() => apply(s, P(a), { a: 'open' }, ctx), /zapieczętowana/);
  eq(viewForScreen(s, null, 0).deal.current, b);
  for (const p of s.players.slice(1)) { apply(s, P(p.id), { a: 'open' }, ctx); apply(s, P(p.id), { a: 'memorized' }, ctx); }
  apply(s, H, { a: 'begin' }, ctx);
  eq(s.phase, 'night');
});
test('ponowne wyświetlenie roli tylko po zgodzie gospodarza, jednorazowo', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'citizen', 'citizen', 'citizen']);
  const a = id(s, 3);
  throws(() => apply(s, P(a), { a: 'open' }, ctx), /zapieczętowana/);
  apply(s, H, { a: 'grant', id: a }, ctx);
  assert(!viewForPlayer(s, a, null).role, 'zgoda nie odsłania sama');
  assert(viewForPlayer(s, a, null).me.canOpen);
  apply(s, P(a), { a: 'open' }, ctx);
  eq(viewForPlayer(s, a, null).role.id, 'citizen');
  assertNoLeak(s, id(s, 1));
  apply(s, P(a), { a: 'memorized' }, ctx);
  throws(() => apply(s, P(a), { a: 'open' }, ctx), /zapieczętowana/);
});
test('mafia zna wspólników, miasto nie', () => {
  const { s, ctx } = lobby(7);
  apply(s, H, { a: 'start' }, ctx);
  s.players.forEach((p, i) => { p.role = ['don', 'mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen'][i]; });
  apply(s, P(id(s, 1)), { a: 'open' }, ctx);
  eq(viewForPlayer(s, id(s, 1), null).role.team, [{ id: id(s, 2), don: false }]);
  apply(s, P(id(s, 1)), { a: 'memorized' }, ctx);
  apply(s, P(id(s, 2)), { a: 'open' }, ctx);
  apply(s, P(id(s, 2)), { a: 'memorized' }, ctx);
  apply(s, P(id(s, 3)), { a: 'open' }, ctx);
  assert(!viewForPlayer(s, id(s, 3), null).role.team, 'detektyw zna mafię?');
});

// ---------- noc ----------
test('mafia zabija, raport dnia, rola ujawniona', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  night(s, ctx, { 1: { target: id(s, 4) } });
  eq(s.phase, 'day');
  eq(s.day.report.killed, id(s, 4));
  assert(!s.players[3].alive);
  eq(viewForScreen(s, null, 0).players[3].role, 'citizen');
  assertNoLeak(s, id(s, 5));
});
test('lekarz ratuje cel; nie może chronić tej samej osoby dwa razy z rzędu', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  night(s, ctx, { 1: { target: id(s, 4) }, 3: { target: id(s, 4) } });
  eq(s.day.report, { round: 1, attacked: true, saved: true, killed: null, revealed: false });
  assert(s.players[3].alive);
  apply(s, H, { a: 'skipvote' }, ctx);
  throws(() => apply(s, P(id(s, 3)), { a: 'night', target: id(s, 4) }, ctx), /dwie noce/);
  apply(s, P(id(s, 3)), { a: 'night', target: id(s, 3) }, ctx); // siebie wolno
});
test('noc kończy się dopiero, gdy wszyscy zatwierdzą; timer też kończy noc', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  apply(s, P(id(s, 1)), { a: 'night', target: id(s, 4) }, ctx); // bez zatwierdzenia
  for (const no of [2, 3, 4, 5, 6]) apply(s, P(id(s, no)), { a: 'night', target: null, confirm: true }, ctx);
  eq(s.phase, 'night');
  eq(viewForScreen(s, null, 0).night, { done: 5, total: 6 });
  ctx.now = s.endsAt - 1; assert(!tick(s, ctx));
  ctx.now = s.endsAt; assert(tick(s, ctx));
  eq(s.phase, 'day');
  eq(s.day.report.killed, id(s, 4), 'niezatwierdzony wybór i tak się liczy po czasie');
});
test('mafia nie może celować w mafię; obywatel wskazuje podejrzanego, nie zabija', () => {
  const { s, ctx } = game(['don', 'mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  throws(() => apply(s, P(id(s, 1)), { a: 'night', target: id(s, 2) }, ctx), /Nieprawidłowy/);
  throws(() => apply(s, P(id(s, 5)), { a: 'night', target: id(s, 5) }, ctx), /Nieprawidłowy/);
  night(s, ctx, { 5: { target: id(s, 1) }, 1: { target: id(s, 6) }, 2: { target: id(s, 6) } });
  eq(s.day.report.killed, id(s, 6));
  eq(s.players[4].stats.suspectsOnMafia, 1);
});
test('remis w mafii rozstrzyga Don', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { s, ctx } = game(['don', 'mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen'], mkCtx(seed));
    night(s, ctx, { 1: { target: id(s, 5) }, 2: { target: id(s, 6) } });
    eq(s.day.report.killed, id(s, 5), 'seed ' + seed);
  }
});
test('Don raz ukrywa się przed detektywem', () => {
  const { s, ctx } = game(['don', 'mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  const det = s.players[2];
  night(s, ctx, { 3: { target: id(s, 1) } });
  eq(det.notes[0].mafia, false);
  apply(s, H, { a: 'skipvote' }, ctx);
  night(s, ctx, { 3: { target: id(s, 1) } });
  eq(det.notes[1].mafia, true);
  apply(s, H, { a: 'skipvote' }, ctx);
  night(s, ctx, { 3: { target: id(s, 2) } });
  eq(det.notes[2].mafia, true);
  // notatki detektywa widzi tylko detektyw
  assert(!JSON.stringify(viewForPlayer(s, id(s, 5), null)).includes('"check"'));
});
test('dziennikarz: raz w grze, ta sama frakcja', () => {
  const { s, ctx } = game(['mafioso', 'mafioso', 'detective', 'doctor', 'avenger', 'journalist', 'citizen', 'citizen', 'citizen', 'citizen', 'citizen', 'citizen']);
  const j = s.players[5];
  eq(viewForPlayer(s, j.id, null).task.kind, 'compare');
  throws(() => apply(s, P(j.id), { a: 'night', targets: [id(s, 1), id(s, 1)] }, ctx), /dwóch różnych/);
  night(s, ctx, { 6: { targets: [id(s, 1), id(s, 7)] } });
  eq(j.notes[0], { round: 1, kind: 'compare', a: id(s, 1), b: id(s, 7), same: false });
  apply(s, H, { a: 'skipvote' }, ctx);
  eq(viewForPlayer(s, j.id, null).task.kind, 'suspect', 'po użyciu tylko podejrzenia');
});
test('dziennikarz może się wstrzymać i zachować umiejętność', () => {
  const { s, ctx } = game(['mafioso', 'mafioso', 'detective', 'doctor', 'avenger', 'journalist', 'citizen', 'citizen', 'citizen', 'citizen', 'citizen', 'citizen']);
  night(s, ctx, {});
  apply(s, H, { a: 'skipvote' }, ctx);
  eq(viewForPlayer(s, id(s, 6), null).task.kind, 'compare');
});

// ---------- głosowanie ----------
function toVote(s, ctx) { if (s.phase === 'night') night(s, ctx); if (s.phase === 'day') next(s, ctx); }
test('głosowanie: większość eliminuje, głosy tajne do zamknięcia', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  toVote(s, ctx);
  eq(s.phase, 'vote');
  votes(s, ctx, { 2: 1, 3: 1 });
  const scr = viewForScreen(s, null, 0);
  eq(scr.vote.done, 2);
  assert(!JSON.stringify(scr.vote).includes('"target"'), 'cudze głosy widoczne przed końcem');
  eq(viewForPlayer(s, id(s, 4), null).ballot.choice, undefined, 'gracz widzi cudzy głos?');
  throws(() => votes(s, ctx, { 4: 4 }), /siebie/);
  votes(s, ctx, { 1: 2, 4: 1, 5: 'skip', 6: 1 });
  eq(s.phase, 'verdict');
  eq(s.verdict.outcome, 'elim');
  eq(s.verdict.eliminated, id(s, 1));
  next(s, ctx);
  eq(s.phase, 'elim');
  next(s, ctx);
  eq(s.phase, 'end');
  eq(s.winner, 'town');
});
test('remis → dogrywka → drugi remis: nikt nie odpada', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  toVote(s, ctx);
  votes(s, ctx, { 1: 4, 2: 4, 3: 5, 4: 5, 5: 'skip', 6: 'skip' });
  eq(s.verdict.outcome, 'none', 'skip >= top');
  apply(s, H, { a: 'next' }, ctx); // → noc
  toVote(s, ctx);
  votes(s, ctx, { 1: 4, 2: 4, 3: 5, 4: 5, 5: 6, 6: 1 });
  eq(s.verdict.outcome, 'runoff');
  eq(s.verdict.runoffIds.slice().sort(), [id(s, 4), id(s, 5)].sort());
  next(s, ctx);
  eq(s.phase, 'vote'); assert(s.vote.runoff);
  throws(() => votes(s, ctx, { 1: 6 }), /Nieprawidłowy/);
  votes(s, ctx, { 1: 4, 2: 4, 3: 5, 4: 5, 5: 4, 6: 5 });
  eq(s.verdict.outcome, 'none'); eq(s.verdict.reason, 'tie-again');
  next(s, ctx);
  eq(s.phase, 'night');
  eq(s.history.length, 3);
});
test('timer głosowania zamyka głosowanie; brak głosów → nikt nie odpada', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  toVote(s, ctx);
  ctx.now = s.endsAt; tick(s, ctx);
  eq(s.phase, 'verdict'); eq(s.verdict.outcome, 'none');
  ctx.now = s.endsAt; tick(s, ctx);
  eq(s.phase, 'night');
});
test('pominięcie głosowania przez gospodarza', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  night(s, ctx);
  apply(s, H, { a: 'skipvote' }, ctx);
  eq(s.phase, 'night'); eq(s.round, 2);
});
test('Mściciel strzela po eliminacji w głosowaniu i może zakończyć grę', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'avenger', 'citizen', 'citizen', 'citizen']);
  toVote(s, ctx);
  votes(s, ctx, { 1: 3, 2: 3, 4: 3, 5: 3, 6: 1, 3: 1 });
  next(s, ctx); eq(s.phase, 'elim');
  next(s, ctx); eq(s.phase, 'avenger');
  throws(() => apply(s, P(id(s, 4)), { a: 'avenge', target: id(s, 1) }, ctx), /nie możesz/);
  eq(viewForPlayer(s, id(s, 3), null).shot.targets.length, 5);
  apply(s, P(id(s, 3)), { a: 'avenge', target: id(s, 1) }, ctx);
  eq(s.phase, 'elim'); eq(s.elim.cause, 'avenger');
  next(s, ctx);
  eq(s.phase, 'end'); eq(s.winner, 'town');
});
test('Mściciel działa tylko po głosowaniu, nie po nocy; timer = rezygnacja', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'avenger', 'citizen', 'citizen', 'citizen', 'citizen']);
  night(s, ctx, { 1: { target: id(s, 3) } });
  eq(s.phase, 'day');
  const { s: s2, ctx: c2 } = game(['mafioso', 'detective', 'avenger', 'citizen', 'citizen', 'citizen', 'citizen']);
  toVote(s2, c2);
  votes(s2, c2, { 1: 3, 2: 3, 4: 3, 5: 3 }); finishVote(s2, c2);
  next(s2, c2); next(s2, c2); eq(s2.phase, 'avenger');
  c2.now = s2.endsAt; tick(s2, c2);
  eq(s2.phase, 'night'); assert(s2.flags.avengerUsed);
});

// ---------- zwycięstwo ----------
test('mafia wygrywa przy parytecie', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen']);
  night(s, ctx, { 1: { target: id(s, 4) } });            // 1 mafia vs 3
  toVote(s, ctx);
  votes(s, ctx, { 1: 2, 2: 3, 3: 2, 5: 2 });             // eliminacja detektywa → 1 vs 2
  next(s, ctx); next(s, ctx);
  eq(s.phase, 'night');
  night(s, ctx, { 1: { target: id(s, 5) } });           // 1 vs 1
  eq(s.phase, 'end'); eq(s.winner, 'mafia');
  assert(s.mvp, 'MVP');
  const v = viewForScreen(s, null, 0);
  assert(v.players.every(p => p.role), 'na końcu wszystkie role jawne');
  assert(v.end.stats.length === 5);
});
test('checkWinner', () => {
  const s = { players: [{ alive: true, role: 'mafioso' }, { alive: true, role: 'citizen' }, { alive: true, role: 'citizen' }] };
  eq(checkWinner(s), null);
  s.players[2].alive = false; eq(checkWinner(s), 'mafia');
  s.players[0].alive = false; s.players[2].alive = true; eq(checkWinner(s), 'town');
});

// ---------- pauza, usuwanie, rebind, rewanż ----------
test('pauza zamraża licznik i blokuje ruchy', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  const left = s.endsAt - ctx.now;
  apply(s, H, { a: 'pause' }, ctx);
  ctx.now += 10 * 60 * 1000;
  assert(!tick(s, ctx));
  throws(() => apply(s, P(id(s, 1)), { a: 'night', target: id(s, 4) }, ctx), /zatrzymana/);
  apply(s, H, { a: 'resume' }, ctx);
  eq(s.endsAt - ctx.now, left);
});
test('usunięcie gracza w trakcie gry: opuścił, bez ujawnienia roli, sprawdza zwycięstwo', () => {
  const { s, ctx, toks } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  apply(s, H, { a: 'kick', id: id(s, 4) }, ctx);
  assert(s.players[3].left && !s.players[3].alive);
  eq(viewForScreen(s, null, 0).players[3].role, undefined);
  assert(!(toks[3] in s.tokens), 'token usuniętego nieważny');
  throws(() => apply(s, P(id(s, 4)), { a: 'night', target: null }, ctx), /Nie jesteś/);
  night(s, ctx);
  eq(s.phase, 'day');
  apply(s, H, { a: 'kick', id: id(s, 1) }, ctx);
  eq(s.phase, 'end'); eq(s.winner, 'town');
});
test('kod rebind: jednorazowy, wygasa, unieważnia stary telefon', () => {
  const { s, ctx, toks } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  const { rebind } = apply(s, H, { a: 'rebind', id: id(s, 2) }, ctx);
  throws(() => rebindRoom(s, 'zly', ctx), /nieważny/);
  const r = rebindRoom(s, rebind.token, ctx);
  eq(r.player.id, id(s, 2));
  assert(!(toks[1] in s.tokens), 'stary token nadal działa');
  eq(s.tokens[r.token], id(s, 2));
  throws(() => rebindRoom(s, rebind.token, ctx), /nieważny/, 'drugie użycie');
  const { rebind: rb2 } = apply(s, H, { a: 'rebind', id: id(s, 3) }, ctx);
  ctx.now += 6 * 60 * 1000;
  throws(() => rebindRoom(s, rb2.token, ctx), /nieważny/, 'wygasły');
});
test('rewanż: te same osoby, nowe losowanie', () => {
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  apply(s, H, { a: 'kick', id: id(s, 1) }, ctx);
  eq(s.phase, 'end');
  apply(s, H, { a: 'rematch' }, ctx);
  eq(s.phase, 'lobby'); eq(s.players.length, 5);
  assert(s.players.every(p => p.alive && !p.role));
  eq(s.players.map(p => p.no), [1, 2, 3, 4, 5]);
  apply(s, H, { a: 'start' }, ctx);
  eq(s.game, 2);
});

// ---------- CHAOS ----------
function chaosGame(event, roles) {
  const r = game(roles || ['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen', 'citizen'], mkCtx(3), { events: true, mode: 'chaos' });
  r.s.settings.events = false;   // sterujemy wydarzeniem ręcznie
  night(r.s, r.ctx);
  r.s.day.event = event;
  return r;
}
test('CHAOS: zamaskowany ukrywa rolę wyeliminowanego', () => {
  const { s, ctx } = chaosGame('masked');
  next(s, ctx);
  votes(s, ctx, { 1: 4, 2: 4, 3: 4, 5: 4 }); finishVote(s, ctx);
  next(s, ctx);
  eq(s.phase, 'elim');
  eq(viewForScreen(s, null, 0).players[3].role, undefined);
});
test('CHAOS: podwójne podejrzenie → dogrywka dwóch osób', () => {
  const { s, ctx } = chaosGame('double');
  next(s, ctx);
  votes(s, ctx, { 1: 4, 2: 4, 3: 4, 5: 1, 6: 4, 7: 4 }); finishVote(s, ctx);
  eq(s.verdict.outcome, 'runoff');
  eq(s.verdict.runoffIds.slice().sort(), [id(s, 1), id(s, 4)].sort());
});
test('CHAOS: ostatnie słowo = 20 s i automatyczne przejście', () => {
  const { s, ctx } = chaosGame('lastword');
  next(s, ctx);
  votes(s, ctx, { 1: 4, 2: 4, 3: 4, 5: 4 }); finishVote(s, ctx);
  next(s, ctx);
  eq(s.elim.lastWords, 20);
  ctx.now = s.endsAt; tick(s, ctx);
  eq(s.phase, 'night');
});
test('CHAOS: losowanie wydarzeń, cisza nocna, nagroda detektywa', () => {
  let seen = new Set();
  for (let seed = 1; seed < 80; seed++) {
    const ctx = mkCtx(seed);
    const { s } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen', 'citizen'], ctx, { events: true });
    night(s, ctx);
    const ev = s.day.event;
    if (!ev) continue;
    seen.add(ev);
    if (ev === 'silence') eq(s.endsAt - ctx.now, 60000);
    if (ev === 'bounty') {
      const note = s.players[1].notes.find(n => n.kind === 'bounty');
      assert(note && note.targets.length === 3 && note.targets.includes(id(s, 1)), 'wskazówka zawiera mafię');
      assert(!note.targets.includes(id(s, 2)), 'bez detektywa');
    }
  }
  eq([...seen].sort(), ['bounty', 'double', 'lastword', 'masked', 'silence']);
  const { s, ctx } = game(['mafioso', 'detective', 'doctor', 'citizen', 'citizen', 'citizen']);
  night(s, ctx);
  eq(s.day.event, null, 'CLASSIC bez wydarzeń');
});

// ---------- symulacja ----------
test('symulacja: 600 losowych gier 5–16 graczy kończy się bez błędów i wycieków', () => {
  let wins = { town: 0, mafia: 0 };
  for (let g = 0; g < 600; g++) {
    const n = MIN_PLAYERS + (g % (MAX_PLAYERS - MIN_PLAYERS + 1));
    const ctx = mkCtx(1000 + g);
    const R = ctx.rng;
    const { s } = lobby(n, ctx);
    if (g % 3 === 1) apply(s, H, { a: 'settings', patch: { mode: 'chaos' } }, ctx);
    apply(s, H, { a: 'start' }, ctx);
    for (const p of s.players) { apply(s, P(p.id), { a: 'open' }, ctx); apply(s, P(p.id), { a: 'memorized' }, ctx); }
    apply(s, H, { a: 'begin' }, ctx);
    let steps = 0;
    while (s.phase !== 'end') {
      if (++steps > 2000) throw new Error('gra się nie kończy, faza ' + s.phase);
      const watcher = s.players[Math.floor(R() * s.players.length)].id;
      if (steps % 7 === 0) assertNoLeak(s, watcher);
      const r = R();
      if (r < 0.02) { apply(s, H, { a: 'pause' }, ctx); apply(s, H, { a: 'resume' }, ctx); continue; }
      if (r < 0.03 && s.players.filter(p => p.alive).length > 3) {
        const alive = s.players.filter(p => p.alive);
        apply(s, H, { a: 'kick', id: alive[Math.floor(R() * alive.length)].id }, ctx);
        continue;
      }
      if (r < 0.10 && s.endsAt) { ctx.now = s.endsAt; tick(s, ctx); continue; }
      if (s.phase === 'night') {
        const alive = s.players.filter(p => p.alive);
        const p = alive[Math.floor(R() * alive.length)];
        const t = viewForPlayer(s, p.id, null).task;
        const pickT = () => (R() < 0.15 || !t.targets.length ? null : t.targets[Math.floor(R() * t.targets.length)]);
        const payload = t.kind === 'compare'
          ? { targets: R() < 0.5 && t.targets.length >= 2 ? t.targets.slice(0, 2) : null }
          : { target: pickT() };
        apply(s, P(p.id), { a: 'night', ...payload, confirm: R() < 0.8 }, ctx);
      } else if (s.phase === 'vote') {
        const alive = s.players.filter(p => p.alive);
        const p = alive[Math.floor(R() * alive.length)];
        const opts = viewForPlayer(s, p.id, null).ballot.options;
        apply(s, P(p.id), { a: 'vote', target: R() < 0.1 || !opts.length ? 'skip' : opts[Math.floor(R() * opts.length)] }, ctx);
      } else if (s.phase === 'avenger') {
        const sh = viewForPlayer(s, s.avenger.id, null).shot;
        apply(s, P(s.avenger.id), { a: 'avenge', target: R() < 0.2 ? null : sh.targets[Math.floor(R() * sh.targets.length)] }, ctx);
      } else if (s.phase === 'day' && R() < 0.05) {
        apply(s, H, { a: 'skipvote' }, ctx);
      } else {
        apply(s, H, { a: 'next' }, ctx);
      }
      // niezmienniki
      const w = checkWinner(s);
      if (w && s.phase !== 'end' && s.phase !== 'elim' && s.phase !== 'avenger') throw new Error('zwycięzca ' + w + ' a gra trwa w fazie ' + s.phase);
    }
    wins[s.winner]++;
    assertNoLeak(s);
  }
  assert(wins.town > 0 && wins.mafia > 0, 'obie strony wygrywają: ' + JSON.stringify(wins));
});
