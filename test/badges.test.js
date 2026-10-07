import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadges, mvpRanking } from '../src/engine/badges.js';

const base = { kills: 2, deaths: 4, assists: 4, totalDamageDealtToChampions: 12000, goldEarned: 9000, visionScore: 20, damageDealtToObjectives: 3000, totalDamageTaken: 15000, damageSelfMitigated: 5000,
  totalMinionsKilled: 150, neutralMinionsKilled: 0, wardsKilled: 2, damageDealtToTurrets: 1000, turretKills: 0, timeCCingOthers: 10, largestKillingSpree: 0,
  doubleKills: 0, tripleKills: 0, quadraKills: 0, pentaKills: 0, firstBloodKill: false, firstBloodAssist: false, firstTowerKill: false, firstTowerAssist: false };
function game(meStats = {}) {
  const participants = Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, stats: { ...base, win: i < 5 } }));
  Object.assign(participants[0].stats, meStats);
  return { mapId: 11, gameDuration: 1800, participants };
}

test('el mejor del equipo ganador es MVP y el del perdedor ACE', () => {
  const r = mvpRanking(game({ kills: 15, deaths: 1, totalDamageDealtToChampions: 40000, goldEarned: 16000 }));
  assert.equal(r.get(1).mvp, true);
  assert.equal(r.get(1).rank, 1);
  assert.equal([...r.values()].filter((x) => x.mvp).length, 1);
  assert.equal([...r.values()].filter((x) => x.ace).length, 1);
  assert.equal(r.get(2).mvp, false);
});

test('logros a partir de las estadísticas del cliente', () => {
  const g = game({ kills: 15, deaths: 0, pentaKills: 1, quadraKills: 1, tripleKills: 2, firstBloodKill: true, totalMinionsKilled: 260, totalDamageDealtToChampions: 40000, largestKillingSpree: 9 });
  const ids = computeBadges(g, 1, { goldChart: [{ team: 0 }, { team: -4000 }, { team: 2000 }] }).map((b) => b.id);
  for (const id of ['mvp', 'penta', 'deathless', 'comeback', 'legendary', 'firstblood', 'cs-top', 'dmg-top']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('quadra') && !ids.includes('triple'), 'solo la mayor multikill');
  assert.ok(!ids.includes('cs-top') || ids.indexOf('mvp') < ids.indexOf('cs-top'), 'ordenados por rareza');
});

test('un empate en el máximo no da el logro, y un jugador normal no saca nada raro', () => {
  const ids = computeBadges(game(), 1).map((b) => b.id);
  assert.ok(!ids.includes('cs-top') && !ids.includes('dmg-top') && !ids.includes('deathless') && !ids.includes('comeback'));
});

test('los supports no compiten por el farm', () => {
  const g = game({ totalMinionsKilled: 300 });
  assert.ok(!computeBadges(g, 1, { pos: 'UTILITY' }).some((b) => b.id.startsWith('cs')));
});

test('en partidas de otros los logros van en tercera persona', () => {
  const g = game({ kills: 15, deaths: 0, firstBloodKill: true, totalDamageDealtToChampions: 40000, firstTowerKill: true });
  const extra = { goldChart: [{ team: 0 }, { team: -4000 }, { team: 2000 }], events: [{ type: 'ELITE_MONSTER_KILL', killerId: 1, monsterType: 'BARON_NASHOR' }, { type: 'ELITE_MONSTER_KILL', killerId: 1, monsterType: 'DRAGON' }, { type: 'ELITE_MONSTER_KILL', killerId: 1, monsterType: 'DRAGON' }], lane14: { goldDiff: 1500 } };
  const mine = computeBadges(g, 1, extra);
  const theirs = computeBadges(g, 1, { ...extra, other: true });
  assert.deepEqual(mine.map((b) => b.id), theirs.map((b) => b.id));
  const text = (list) => list.map((b) => `${b.title} ${b.detail}`).join(' | ');
  assert.match(text(mine), /fue tuya/);
  assert.match(text(mine), /Rematas el Barón/);
  const t = text(theirs);
  for (const re of [/\btuy[ao]\b/, /\btu\b/, /\bte\b/i, /asteis\b/, /aste\b/, /iste\b/, /Rematas/]) assert.doesNotMatch(t, re);
  assert.match(t, /fue suya/);
  assert.match(t, /Ganaron/);
  assert.match(t, /Remata el Barón/);
  // ACE de un jugador del equipo perdedor
  const ace = computeBadges(game({ win: false, kills: 15, totalDamageDealtToChampions: 40000 }), 1, { other: true }).find((b) => b.id === 'ace');
  if (ace) assert.match(ace.detail, /su equipo aunque perdieron/);
});
