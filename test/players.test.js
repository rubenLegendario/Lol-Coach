import { fakeLcu } from './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoutPlayer, champLineText } from '../src/players.js';

// Partida del historial del cliente (formato de /lol-match-history) con un solo participante: el jugador
const game = (id, champ, [k, d, a], win, queueId = 420) => ({
  gameId: id, mapId: 11, queueId, gameDuration: 1800, gameCreation: 1e12 + id,
  participants: [{ championId: champ, timeline: { lane: 'BOTTOM', role: 'CARRY' }, stats: { win, kills: k, deaths: d, assists: a } }],
});

function lcuWith(puuid, games, mastery = []) {
  return fakeLcu({
    [`/lol-ranked/v1/ranked-stats/${puuid}`]: { queueMap: {} },
    [`/lol-match-history/v1/products/lol/${puuid}/matches`]: { games: { games } },
    [`/lol-champion-mastery/v1/${puuid}/champion-mastery`]: mastery,
  });
}

test('KDA con el campeón: solo con las partidas con ese campeón', async () => {
  const games = [
    game(1, 202, [10, 2, 5], true), // Jhin
    game(2, 202, [2, 4, 3], false), // Jhin
    game(3, 51, [0, 10, 0], false), // otro campeón: no cuenta
    game(4, 51, [1, 1, 1], true),
    game(5, 51, [1, 1, 1], true),
  ];
  const sc = await scoutPlayer(lcuWith('p1', games), 'p1', 202);
  assert.equal(sc.champGames, 2);
  assert.equal(sc.champWinRate, 0.5);
  assert.equal(sc.champKda, (10 + 5 + 2 + 3) / (2 + 4));
  assert.equal(sc.sampleGames, 5);
  assert.equal(sc.sampleRanked, true);
});

test('sin partidas con el campeón no hay KDA con él', async () => {
  const sc = await scoutPlayer(lcuWith('p2', [game(1, 51, [5, 0, 5], true)]), 'p2', 202);
  assert.equal(sc.champGames, 0);
  assert.equal(sc.champKda, null);
});

test('sin muertes, el KDA con el campeón es kills + asistencias', async () => {
  const sc = await scoutPlayer(lcuWith('p3', [game(1, 202, [4, 0, 3], true)]), 'p3', 202);
  assert.equal(sc.champKda, 7);
});

test('línea del campeón: partidas de las últimas, % y KDA', () => {
  assert.equal(champLineText({ champGames: 3, sampleGames: 20, sampleRanked: false, champWinRate: 2 / 3, champKda: 3.14 }), '3 de 20 últimas · 67% · KDA 3.1');
  assert.equal(champLineText({ champGames: 3, sampleGames: 14, sampleRanked: true, champWinRate: 1, champKda: 2 }), '3 de 14 ranked · 100% · KDA 2.0');
  // Sin KDA ni muestra (datos antiguos): no se rellena
  assert.equal(champLineText({ champGames: 2, champWinRate: null, champKda: null }), '2');
  assert.equal(champLineText({ champGames: 0, champMastery: { level: 7, points: 151000 } }), 'Maestría 7 · 151k pts');
  assert.equal(champLineText({ champGames: 0, champMastery: null }), 'Primera vez con el campeón');
  assert.equal(champLineText(null), '');
});
