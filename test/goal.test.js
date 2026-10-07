import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoal, winModel, paceOf, absLabel } from '../src/engine/goal.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 6, 12);
// Oro II 37 LP = 3*400 + 2*100 + 37
const q = (abs, extra = {}) => ({ current: { abs }, avgWin: 21, avgLoss: -19, points: [{ t: NOW - DAY, abs: abs - 21, win: null }, { t: NOW - 3600_000, abs, win: true }], ...extra });
const games = (n, wins, { queueId = 420, spanDays = 14 } = {}) =>
  Array.from({ length: n }, (_, i) => ({ gameId: i, queueId, win: i < wins, remake: false, date: NOW - ((i + 0.5) / n) * spanDays * DAY }));

test('absLabel: LP absolutos a texto', () => {
  assert.equal(absLabel(1437), 'Oro II · 37 LP');
  assert.equal(absLabel(1600), 'Platino IV · 0 LP');
  assert.equal(absLabel(2850), 'Maestro+ · 50 LP');
});

test('winModel mezcla las recientes con la temporada y no se fía de pocas partidas', () => {
  const m = winModel(games(5, 5), { wins: 500, losses: 500 });
  assert.ok(m.mean > 0.5 && m.mean < 0.6, `5 de 5 no debe disparar el winrate (${m.mean})`);
  assert.equal(winModel([], null).mean, 0.5);
});

test('paceOf: partidas de la cola por día en los últimos 14 días', () => {
  const p = paceOf([...games(7, 4), ...games(3, 1, { queueId: 450 })], 420, NOW);
  assert.equal(p.games, 7);
  assert.equal(Math.round(p.perDay * 10) / 10, 0.5);
  assert.equal(paceOf([], 420, NOW), null);
});

test('buildGoal: estimación coherente y reproducible', () => {
  const goal = { queue: 'solo', tier: 'PLATINUM', division: 'IV', deadline: NOW + 27 * DAY, startAbs: 1414, createdAt: NOW - DAY };
  const opts = { games: games(28, 16), season: { wins: 391, losses: 369 }, now: NOW, sims: 800 };
  const a = buildGoal(goal, q(1437), opts);
  const b = buildGoal(goal, q(1437), opts);
  assert.deepEqual(a.games, b.games, 'misma entrada, misma cifra');
  assert.equal(a.need, 163);
  assert.ok(a.games.p20 <= a.games.p50, 'percentiles ordenados');
  assert.ok(a.onTimeProb >= 0 && a.onTimeProb <= 100);
  assert.equal(a.model.paceGames, 28);
  assert.equal(a.gamesAvail, 54);
  // Plan: recta de 1414 (hace 1 día) a 1600 (dentro de 27)
  assert.equal(a.plan.now, Math.round(1414 + 186 / 28));
  assert.equal(a.plan.diff, 1437 - a.plan.now);
  assert.ok(a.plan.milestone.t >= NOW && a.plan.milestone.t <= NOW + 7 * DAY);
  // Banda: empieza en tus LP de hoy y se abre
  const cone = a.chart.cone;
  assert.equal(cone[0].p50, 1437);
  assert.ok(cone.at(-1).p80 - cone.at(-1).p20 > 0);
  assert.equal(a.chart.hist[0].t, NOW - DAY, 'la línea real empieza cuando te pusiste el objetivo');
});

test('buildGoal: con más ritmo, más probabilidad de llegar a tiempo', () => {
  const goal = { queue: 'solo', tier: 'PLATINUM', division: 'IV', deadline: NOW + 20 * DAY, startAbs: 1437, createdAt: NOW };
  const slow = buildGoal(goal, q(1437), { games: games(7, 4), season: { wins: 60, losses: 50 }, now: NOW, sims: 800 });
  const fast = buildGoal(goal, q(1437), { games: games(56, 32), season: { wins: 60, losses: 50 }, now: NOW, sims: 800 });
  assert.ok(fast.onTimeProb > slow.onTimeProb, `${fast.onTimeProb} > ${slow.onTimeProb}`);
});

test('buildGoal: perdiendo de media no promete partidas', () => {
  const goal = { queue: 'solo', tier: 'PLATINUM', division: 'IV', startAbs: 1437, createdAt: NOW };
  const g = buildGoal(goal, q(1437), { games: games(30, 9), season: { wins: 300, losses: 400 }, now: NOW, sims: 800 });
  assert.equal(g.games, null);
  assert.ok(g.reachProb < 50);
  assert.equal(g.plan, undefined, 'sin fecha límite no hay plan');
});

test('buildGoal: sin LP apuntados lo indica y objetivo cumplido no simula', () => {
  const goal = { queue: 'solo', tier: 'PLATINUM', division: 'IV', startAbs: 1400, createdAt: NOW };
  const g = buildGoal(goal, q(1437, { avgWin: null, avgLoss: null }), { games: games(10, 5), now: NOW, sims: 200 });
  assert.equal(g.model.lpKnown, false);
  const done = buildGoal({ ...goal, tier: 'GOLD', division: 'II' }, q(1437), { now: NOW });
  assert.equal(done.done, true);
  assert.equal(done.model, undefined);
  assert.equal(buildGoal(goal, null).noData, true);
});
