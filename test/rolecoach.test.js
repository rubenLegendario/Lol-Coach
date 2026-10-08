import { fakeLcu } from './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachFor, coachInfo, reviewGame, COACHES } from '../src/engine/coach/index.js';
import { fightDeaths, objectiveParticipation, earlyRoams, TRINKET } from '../src/engine/coach/common.js';
import { objectiveBalance } from '../src/engine/coach/jungle.js';
import { supportControlWards } from '../src/engine/coach/support.js';
import { analyzeGame } from '../src/engine/postgame.js';
import { AlertTracker } from '../src/engine/alerts.js';
import { App } from '../src/app.js';

const MIN = 60000;
const phase = (tk = 0, mine = 0, deaths = 0) => ({ tk, mine, deaths });

/** Contexto de partida "normal" (todo dentro de objetivo) para probar una regla cada vez. */
function ctx(over = {}, m = {}) {
  return {
    sr: true, min: 30, pos: null, base: null, lane: {}, deaths: [], earlyDeaths: [], oppName: 'Rival',
    phase: { early: phase(), mid: phase(), late: phase() },
    objectives: null, objParticipation: null, roams: 0, turretShare: null, tank: false,
    ...over,
    m: { kills: 5, deaths: 3, assists: 8, kda: 4.3, kp: 0.55, cs: 240, csMin: 8.0, goldMin: 420, dmgShare: 0.25, visionMin: 0.8, controlWards: 0, wardsPlaced: 12, wardsKilled: 2, trinket: TRINKET.YELLOW, turretDmg: 3000, ...m },
  };
}
const texts = (r) => [...r.improve, ...r.strengths, ...r.suggestions].map((x) => `${x.title} ${x.detail} ${x.tip || ''}`).join(' | ');

test('coachFor elige el coach por posición (también en minúsculas y con alias)', () => {
  assert.equal(coachFor('BOTTOM').id, 'adc');
  assert.equal(coachFor('UTILITY').id, 'support');
  assert.equal(coachFor('utility').id, 'support');
  assert.equal(coachFor('MIDDLE').id, 'mid');
  assert.equal(coachFor('MID').id, 'mid');
  assert.equal(coachFor('JUNGLE').id, 'jungle');
  assert.equal(coachFor('TOP').id, 'top');
  assert.equal(coachFor(null).id, 'neutral');
  assert.equal(coachFor('ARAM').id, 'neutral');
  assert.equal(coachFor('BOTTOM', { aram: true }).id, 'aram');
  assert.deepEqual(coachInfo(coachFor('BOTTOM')), { role: 'adc', label: 'Coach de ADC' });
  assert.equal(coachInfo(coachFor(null)).label, null);
});

test('un ADC sin wards de control no recibe ningún fallo ni sugerencia de wards de control', () => {
  const r = reviewGame(coachFor('BOTTOM'), ctx({ pos: 'BOTTOM' }, { controlWards: 0, visionMin: 0.3 }));
  assert.ok(!/control/i.test(texts(r)), texts(r));
  assert.ok(!r.improve.some((x) => /visión/i.test(x.title)));
  assert.equal(coachFor('BOTTOM').backWard, false);
  assert.equal(coachFor('BOTTOM').itemSetWards, false);
  assert.equal(coachFor('BOTTOM').targets.visionMin, null);
});

test('un support sin wards de control sí recibe el fallo', () => {
  const r = reviewGame(coachFor('UTILITY'), ctx({ pos: 'UTILITY' }, { controlWards: 0, visionMin: 2.2, trinket: TRINKET.LENS }));
  assert.ok(r.improve.some((x) => x.title === 'No compraste ningún ward de control'));
  assert.equal(coachFor('UTILITY').backWard, true);
  // Con los suficientes, es un acierto
  const ok = reviewGame(coachFor('UTILITY'), ctx({ pos: 'UTILITY' }, { controlWards: 6, visionMin: 2.2, trinket: TRINKET.LENS }));
  assert.ok(ok.strengths.some((x) => x.title === 'Buenos wards de control'));
});

test('wards de control de referencia del support: uno cada 6 minutos y al menos 2', () => {
  assert.equal(supportControlWards(10), 2);
  assert.equal(supportControlWards(30), 5);
  assert.equal(supportControlWards(36), 6);
});

test('trinket: el support con el amarillo al final es un fallo; el ADC solo recibe una sugerencia', () => {
  const sup = reviewGame(coachFor('UTILITY'), ctx({ pos: 'UTILITY' }, { controlWards: 6, visionMin: 2.2, trinket: TRINKET.YELLOW }));
  assert.ok(sup.improve.some((x) => x.title === 'No cambiaste al barrido'));
  const adc = reviewGame(coachFor('BOTTOM'), ctx({ pos: 'BOTTOM' }, { trinket: TRINKET.YELLOW }));
  assert.ok(!adc.improve.some((x) => /barrido|trinket/i.test(x.title)));
  assert.ok(adc.suggestions.some((x) => x.title === 'Valora cambiar de trinket'));
});

test('ADC: morir el primero en varias peleas es un fallo propio del rol', () => {
  const deaths = [{ time: 16 * MIN, fight: true, first: true }, { time: 22 * MIN, fight: true, first: true }];
  const r = reviewGame(coachFor('BOTTOM'), ctx({ pos: 'BOTTOM', deaths }, { deaths: 2 }));
  assert.ok(r.improve.some((x) => x.title === 'Mueres el primero en las peleas'));
  // Al support no se le aplica esa regla
  const s = reviewGame(coachFor('UTILITY'), ctx({ pos: 'UTILITY', deaths }, { deaths: 2, controlWards: 6, visionMin: 2.2, trinket: TRINKET.LENS }));
  assert.ok(!s.improve.some((x) => x.title === 'Mueres el primero en las peleas'));
});

test('ADC: el objetivo de CS es alto y avisa del CS al minuto 10', () => {
  const low = reviewGame(coachFor('BOTTOM'), ctx({ pos: 'BOTTOM' }, { csMin: 6.8 }));
  assert.ok(low.improve.some((x) => x.title === 'Farmeas poco'));
  const lane10 = reviewGame(coachFor('BOTTOM'), ctx({ pos: 'BOTTOM', lane: { 10: { cs: 58, csDiff: -12 } } }, { csMin: 7.6 }));
  assert.ok(lane10.improve.some((x) => x.title === 'Pierdes CS en la fase de líneas'));
});

test('top y mid: sin wards de control solo hay una sugerencia, nunca un fallo', () => {
  for (const pos of ['TOP', 'MIDDLE']) {
    const r = reviewGame(coachFor(pos), ctx({ pos }, { controlWards: 0, csMin: 7.5 }));
    assert.ok(!r.improve.some((x) => /control/i.test(x.title)), pos);
    assert.ok(r.suggestions.some((x) => /control/i.test(x.title)), pos);
    assert.equal(coachFor(pos).backWard, false);
  }
});

test('jungla: balance de objetivos y fallo si el rival se los lleva', () => {
  const obj = (a, e) => ({ ally: { dragons: a, barons: 0, heralds: 0, grubs: 0 }, enemy: { dragons: e, barons: 1, heralds: 1, grubs: 3 } });
  assert.equal(objectiveBalance(obj(1, 3)), 1 - 3 - 2 - 1 - 1);
  assert.equal(objectiveBalance(null), null);
  const r = reviewGame(coachFor('JUNGLE'), ctx({ pos: 'JUNGLE', objectives: obj(1, 3) }, { csMin: 6, visionMin: 1.3, trinket: TRINKET.LENS }));
  assert.ok(r.improve.some((x) => x.title === 'El rival se llevó los objetivos'));
  assert.equal(coachFor('JUNGLE').backWard, true);
});

test('ARAM y sin posición: sin consejos de rol (ni visión, ni wards, ni farmeo)', () => {
  for (const coach of [coachFor('BOTTOM', { aram: true }), coachFor(null)]) {
    const r = reviewGame(coach, ctx({ sr: coach.id !== 'aram' }, { controlWards: 0, visionMin: 0, wardsPlaced: 0, csMin: 2, kp: 0.1, dmgShare: 0.05, deaths: 12 }));
    const all = texts(r);
    assert.ok(!/ward|visión|trinket|CS|farm|daño/i.test(all), all);
    assert.ok(r.improve.some((x) => x.title === 'Mueres demasiado'));
    assert.equal(coach.backWard, false);
  }
});

test('fightDeaths: grupos de kills a menos de 15 s; 3+ muertes es pelea; primer aliado en caer', () => {
  const ev = (s, victimId) => ({ type: 'CHAMPION_KILL', timestamp: s * 1000, victimId });
  const allies = new Set([1, 2, 3, 4, 5]);
  const out = fightDeaths([ev(100, 4), ev(105, 7), ev(110, 1), ev(300, 4), ev(600, 8), ev(606, 4), ev(612, 9)], 4, allies);
  assert.deepEqual(out.get(100000), { fight: true, first: true });
  assert.deepEqual(out.get(300000), { fight: false, first: false });
  assert.deepEqual(out.get(606000), { fight: true, first: true }); // el 8 es rival: tú fuiste el primer aliado
  const late = fightDeaths([ev(100, 2), ev(104, 4), ev(108, 9)], 4, allies);
  assert.deepEqual(late.get(104000), { fight: true, first: false });
});

test('objectiveParticipation: solo objetivos de tu equipo, con killerId conocido', () => {
  const allies = new Set([1, 2, 3, 4, 5]);
  const e = (monsterType, killerId, assist = []) => ({ type: 'ELITE_MONSTER_KILL', monsterType, killerId, assistingParticipantIds: assist });
  const p = objectiveParticipation([e('DRAGON', 2, [4, 5]), e('DRAGON', 2, [1]), e('DRAGON', 7, [4]), e('BARON_NASHOR', 4), e('RIFTHERALD', 0, [4]), e('HORDE', 2, [9])], 4, allies);
  assert.deepEqual(p.dragons, { total: 2, mine: 1 });
  assert.deepEqual(p.barons, { total: 1, mine: 1 });
  assert.deepEqual(p.heralds, { total: 0, mine: 0 });
  assert.deepEqual(p.grubs, { total: 1, mine: 0 });
});

test('earlyRoams: kills antes del 14 en otra línea (el río no cuenta)', () => {
  const k = (min, x, y, killerId = 3) => ({ type: 'CHAMPION_KILL', timestamp: min * MIN, position: { x, y }, killerId, assistingParticipantIds: [] });
  const ev = [k(5, 1000, 9000), k(6, 12000, 1000), k(7, 7400, 7400), k(8, 5000, 9800), k(16, 1000, 9000), k(6, 12000, 1000, 9)];
  assert.equal(earlyRoams(ev, 3, 'MIDDLE', 100), 2); // top y bot; mid propio, río y tarde no
  assert.equal(earlyRoams(ev, 3, null, 100), 0);
});

// ---------- Integración: aviso de volver a base, alertas y análisis post-partida ----------

test('aviso de volver a base: "+ Guardián de control" solo si el coach del rol lo pide', () => {
  const g = (pos) => ({ gameTime: 600, aram: false, me: { gold: 3400, pos }, shopping: { missing: 0, target: { id: 3031, name: 'Filo infinito', icon: null }, remaining: 3000, spend: 0, buyNow: [] } });
  const me = { items: [], isDead: false };
  const back = (pos) => App.prototype.backAdvice.call({}, g(pos), me).sub;
  assert.ok(!back('BOTTOM').includes('Guardián de control'), back('BOTTOM'));
  assert.ok(back('UTILITY').includes('Guardián de control'));
  assert.ok(back('JUNGLE').includes('Guardián de control'));
  assert.ok(!back('MIDDLE').includes('Guardián de control'));
  assert.ok(!back('TOP').includes('Guardián de control'));
});

test('alertas: el aviso de dragón a 1 minuto usa el texto del coach del rol', () => {
  const view = (pos, t) => ({ gameTime: t, me: { level: 9, pos }, players: [], power: null, objectives: { dragon: { label: 'Dragón', at: 900 } } });
  for (const [pos, coach] of [['BOTTOM', COACHES.adc], ['UTILITY', COACHES.support]]) {
    const tr = new AlertTracker();
    tr.update(view(pos, 830));
    const list = tr.update(view(pos, 845));
    assert.equal(list[0].text, coach.live.objective('dragon', 'Dragón').text);
  }
});

/** Partida mínima del historial del cliente: 10 jugadores, tú eres el 4 (ADC por timeline del cliente). */
function fakeGame(myRole) {
  const role = { 1: ['TOP', 'SOLO'], 2: ['JUNGLE', 'NONE'], 3: ['MIDDLE', 'SOLO'], 4: ['BOTTOM', 'CARRY'], 5: ['BOTTOM', 'SUPPORT'] };
  if (myRole === 'UTILITY') { role[4] = ['BOTTOM', 'SUPPORT']; role[5] = ['BOTTOM', 'CARRY']; }
  const stats = (i) => ({ kills: 3, deaths: 4, assists: 6, totalMinionsKilled: 200, neutralMinionsKilled: 10, goldEarned: 12000, totalDamageDealtToChampions: 15000, totalDamageTaken: 18000, visionScore: i === 4 && myRole === 'UTILITY' ? 70 : 20, visionWardsBoughtInGame: 0, wardsPlaced: 10, wardsKilled: 1, damageDealtToObjectives: 2000, damageDealtToTurrets: 1500, item6: TRINKET.YELLOW, champLevel: 15, perk0: 0, win: i <= 5 });
  return {
    gameId: 777, queueId: 420, mapId: 11, gameDuration: 30 * 60, gameCreation: Date.now(),
    participants: Array.from({ length: 10 }, (_, k) => {
      const i = k + 1;
      const [lane, r] = role[((i - 1) % 5) + 1];
      return { participantId: i, teamId: i <= 5 ? 100 : 200, championId: 0, spell1Id: 4, spell2Id: i % 5 === 2 ? 11 : 7, timeline: { lane, role: r }, stats: stats(i) };
    }),
    participantIdentities: Array.from({ length: 10 }, (_, k) => ({ participantId: k + 1, player: { puuid: `p${k + 1}`, gameName: `J${k + 1}`, tagLine: 'EUW' } })),
    teams: [100, 200].map((teamId) => ({ teamId, win: teamId === 100 ? 'Win' : 'Fail', dragonKills: 2, baronKills: 1, towerKills: 5, hordeKills: 3, riftHeraldKills: 1 })),
  };
}

test('análisis post-partida: un ADC sin wards de control no recibe el fallo; un support sí, y se indica el coach', async () => {
  for (const [pos, label, wants] of [['BOTTOM', 'Coach de ADC', false], ['UTILITY', 'Coach de support', true]]) {
    const game = fakeGame(pos);
    game.gameId = pos === 'BOTTOM' ? 9101 : 9102;
    const lcu = fakeLcu({ [`/lol-match-history/v1/games/${game.gameId}`]: game });
    const a = await analyzeGame(lcu, game.gameId, 'p4', { record: false });
    assert.equal(a.pos, pos);
    assert.deepEqual(a.coach, { role: pos === 'BOTTOM' ? 'adc' : 'support', label });
    assert.equal(a.improve.some((x) => /ward de control/i.test(x.title)), wants, a.improve.map((x) => x.title).join(', '));
    assert.equal(a.targets.controlWards, wants ? 5 : null);
    assert.ok(Array.isArray(a.suggestions));
  }
});
