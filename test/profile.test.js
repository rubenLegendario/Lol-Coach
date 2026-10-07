import { fakeLcu } from './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile } from '../src/engine/profile.js';

const PUUID = 'p1';
let id = 1000;
// Partida tal como la da el historial del cliente (participants[0] = el jugador)
const match = ({ queueId = 420, champ = 202, win = true, mins = 30, mapId = 11, ago = 0 } = {}) => ({
  gameId: ++id,
  queueId,
  mapId,
  gameDuration: mins * 60,
  gameCreation: Date.now() - ago * 3600_000,
  participants: [{
    participantId: 1,
    championId: champ,
    spell1Id: 4,
    spell2Id: 7,
    timeline: { lane: 'BOTTOM', role: 'CARRY' },
    stats: { win, kills: 5, deaths: 3, assists: 6, totalMinionsKilled: 200, neutralMinionsKilled: 10, visionScore: 15, totalDamageDealtToChampions: 18000, goldEarned: 12000 },
  }],
});

const history = [
  match({ queueId: 420, champ: 202 }),
  match({ queueId: 420, champ: 202, win: false }),
  match({ queueId: 420, champ: 51 }),
  match({ queueId: 440, champ: 29 }),
  match({ queueId: 450, champ: 99, mapId: 12 }),
  match({ queueId: 420, champ: 202, mins: 3 }), // remake
];
const lcu = fakeLcu({
  [`/lol-ranked/v1/ranked-stats/${PUUID}`]: { queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II', leaguePoints: 37, wins: 10, losses: 9 } } },
  [`/lol-match-history/v1/products/lol/${PUUID}/matches`]: { games: { games: history } },
});

test('sin filtro: clasificatorias de la Grieta y sin remakes', async () => {
  const p = await buildProfile(lcu, PUUID);
  assert.equal(p.summary.games, 4); // 3 de Solo/Dúo + 1 Flex
  assert.equal(p.filter.queue, 'auto');
});

test('filtro Solo/Dúo', async () => {
  const p = await buildProfile(lcu, PUUID, { queue: 'solo' });
  assert.equal(p.summary.games, 3);
  assert.ok(p.recent.every((g) => g.queueId === 420));
});

test('filtro ARAM', async () => {
  const p = await buildProfile(lcu, PUUID, { queue: 'aram' });
  assert.equal(p.summary.games, 1);
});

test('filtro por campeón dentro de la cola', async () => {
  const p = await buildProfile(lcu, PUUID, { queue: 'solo', champ: 202 });
  assert.equal(p.summary.games, 2);
  assert.equal(p.summary.wins, 1);
});

test('un filtro de cola desconocido vuelve a "auto"', async () => {
  const p = await buildProfile(lcu, PUUID, { queue: 'nope' });
  assert.equal(p.filter.queue, 'auto');
});

test('la sesión de hoy usa siempre las partidas sin filtrar', async () => {
  const p = await buildProfile(lcu, PUUID, { queue: 'aram' });
  assert.equal(p.recentAll.length, history.length);
});

test('añade la última partida de un amigo aunque el historial de Riot no la tenga aún', async () => {
  const extra = { ...match({ queueId: 420, champ: 54 }), participantIdentities: [{ participantId: 1, player: { puuid: PUUID } }] };
  const l2 = fakeLcu({
    [`/lol-ranked/v1/ranked-stats/${PUUID}`]: null,
    [`/lol-match-history/v1/products/lol/${PUUID}/matches`]: { games: { games: history } },
    [`/lol-match-history/v1/games/${extra.gameId}`]: extra,
  });
  const p = await buildProfile(l2, PUUID, { queue: 'all', extraGameIds: [extra.gameId] });
  assert.equal(p.recent[0].gameId, extra.gameId);
});
