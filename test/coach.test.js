import { fakeLcu } from './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoach, pickCoachGames } from '../src/engine/profile.js';

let id = 5000;
const DAY = 24 * 3600_000;
// Partida del historial del cliente
const lcuGame = ({ queueId = 420, mins = 30, mapId = 11, ago = 0 } = {}) => ({ gameId: ++id, queueId, mapId, gameDuration: mins * 60, gameCreation: Date.now() - ago * DAY, participants: [{ stats: {} }] });
// Fila archivada (formato de gameRow)
const row = ({ queueId = 420, mins = 30, sr = true, ago = 0, secs = true } = {}) => ({ gameId: ++id, queueId, sr, ranked: queueId === 420 || queueId === 440, ...(secs ? { secs: mins * 60 } : {}), duration: mins, date: Date.now() - ago * DAY });

test('pickCoachGames junta historial y archivo sin duplicados y por fecha', () => {
  const hist = [lcuGame({ ago: 1 }), lcuGame({ ago: 3 })];
  const arch = [
    { ...row({ ago: 1 }), gameId: hist[0].gameId }, // repetida
    row({ ago: 2 }),
    row({ ago: 5, secs: false }), // fila antigua sin "secs"
    row({ ago: 4, mins: 10 }), // demasiado corta
    row({ ago: 6, sr: false, queueId: 450 }), // ARAM
  ];
  const { games, ranked } = pickCoachGames(hist, arch);
  assert.equal(ranked, true);
  assert.equal(games.length, 4);
  assert.equal(new Set(games.map((g) => g.gameId)).size, 4);
  assert.deepEqual(games.map((g) => g.date), [...games.map((g) => g.date)].sort((a, b) => b - a));
});

test('pickCoachGames: clasificatorias si hay 4 o más, si no todas las de la Grieta; máximo 20', () => {
  const few = pickCoachGames([lcuGame({ queueId: 420 }), lcuGame({ queueId: 400 }), lcuGame({ queueId: 430 })], []);
  assert.equal(few.ranked, false);
  assert.equal(few.games.length, 3);
  const many = pickCoachGames([], Array.from({ length: 30 }, (_, i) => row({ ago: i, queueId: i % 3 ? 420 : 400 })));
  assert.equal(many.ranked, true);
  assert.equal(many.games.length, 20);
  assert.ok(many.games.every((g) => g.queueId === 420));
});

// Análisis falso con lo que usa buildCoach
const fakeAnalysis = (gameId, { early = 60, mid = 50, late = null } = {}) => ({
  gameId, win: true, champ: { key: 202, name: 'Jhin' }, stats: { kda: '5/3/6', csMin: 7 },
  grades: { early: early == null ? null : { score: early }, mid: mid == null ? null : { score: mid }, late: late == null ? null : { score: late }, overall: { score: 55 } },
  improve: [{ title: 'Mueres pronto', tip: 'x', detail: 'y', severity: 2 }], strengths: [], deaths: [],
});

test('buildCoach completa con las partidas archivadas y dice si son clasificatorias', async () => {
  const PUUID = 'coach1';
  const hist = [lcuGame({ ago: 0 }), lcuGame({ ago: 1 })];
  const arch = Array.from({ length: 14 }, (_, i) => row({ ago: i + 2 }));
  const lcu = fakeLcu({ [`/lol-match-history/v1/products/lol/${PUUID}/matches`]: { games: { games: hist } } });
  const seen = [];
  const analyze = async (_lcu, gameId, _p, opts) => { seen.push({ gameId, opts }); return fakeAnalysis(gameId); };
  const c = await buildCoach(lcu, PUUID, { archived: arch, analyze });
  assert.equal(seen.length, 16);
  assert.equal(c.analyzed, 10);
  assert.equal(c.analyzedBefore, 6);
  assert.equal(c.queueLabel, 'clasificatorias');
  assert.equal(seen[0].gameId, hist[0].gameId);
  assert.equal(seen[0].opts.other, false);
});

test('buildCoach: sin nota de fase con menos de 2 partidas, y "peor fase" pide 3', async () => {
  const PUUID = 'coach2';
  const hist = [lcuGame({ queueId: 400 }), lcuGame({ queueId: 400, ago: 1 }), lcuGame({ queueId: 400, ago: 2 })];
  const lcu = fakeLcu({ [`/lol-match-history/v1/products/lol/${PUUID}/matches`]: { games: { games: hist } } });
  let i = 0;
  // Solo la primera llega al final; la fase de mitad la tienen las 3, la de líneas solo 2
  const analyze = async (_l, gameId) => fakeAnalysis(gameId, { early: i < 2 ? 80 : null, mid: 40, late: i++ === 0 ? 70 : null });
  const c = await buildCoach(lcu, PUUID, { record: false, other: true, analyze });
  assert.equal(c.queueLabel, 'partidas de la Grieta');
  const ph = Object.fromEntries(c.phases.map((p) => [p.key, p]));
  assert.equal(ph.late.games, 1);
  assert.equal(ph.late.score, null);
  assert.equal(ph.late.grade, null);
  assert.equal(ph.early.score, 80);
  assert.equal(ph.mid.score, 40);
  assert.equal(c.weakestPhase, null); // solo "mid" llega a 3 partidas
});
