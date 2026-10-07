import { fakeLcu } from './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveStatus } from '../src/engine/livestatus.js';

// Un solo listado de amigos para todos los casos (el módulo lo cachea 15 s)
const lcu = fakeLcu({
  '/lol-chat/v1/friends': [
    { puuid: 'jugando', gameName: 'A', gameTag: '1', availability: 'dnd', lol: { gameStatus: 'inGame', championId: '711', queueId: '420', timeStamp: '1791227993935', gameId: '8004887182', isObservable: 'ALL', spectatorKey: 'k' } },
    { puuid: 'seleccion', gameName: 'B', gameTag: '2', availability: 'chat', lol: { gameStatus: 'championSelect' } },
    { puuid: 'fuera', gameName: 'C', gameTag: '3', availability: 'offline', lol: {} },
  ],
});

test('amigo en partida: lo detecta con su cola, inicio y si se puede ver', async () => {
  const s = await liveStatus(lcu, 'jugando');
  assert.equal(s.inGame, true);
  assert.equal(s.source, 'friend');
  assert.equal(s.queueId, 420);
  assert.equal(s.gameId, 8004887182);
  assert.equal(s.startTime, 1791227993935);
  assert.equal(s.spectatable, true);
});

test('amigo en selección de campeón', async () => {
  const s = await liveStatus(lcu, 'seleccion');
  assert.equal(s.inGame, false);
  assert.equal(s.status, 'En selección de campeón');
});

test('amigo desconectado', async () => {
  const s = await liveStatus(lcu, 'fuera');
  assert.equal(s.status, 'Desconectado');
});

test('quien no es tu amigo no se puede detectar sin clave de Riot', async () => {
  const s = await liveStatus(lcu, 'desconocido');
  assert.equal(s.friend, false);
  assert.equal(s.canDetect, false);
  assert.equal(s.inGame, false);
});
