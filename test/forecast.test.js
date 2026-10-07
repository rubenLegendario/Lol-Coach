import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../src/engine/forecast.js';

const game = (o = {}) => ({ remake: false, sr: true, ranked: true, pos: 'BOTTOM', k: 6, d: 5, a: 7, csMin: 6.8, dmgMin: 650, goldMin: 410, visionMin: 0.45, win: true, ...o });
const games = (n, o) => Array.from({ length: n }, (_, i) => game({ win: i % 2 === 0, ...o }));
const gold2 = { queue: 'Solo/Dúo', tier: 'GOLD', division: 'II', lp: 37, text: 'Oro II' };
const profile = (recent, rank = gold2) => ({ recent, ranks: [rank] });

test('sin partidas suficientes no hay previsión', () => {
  assert.equal(buildForecast(profile(games(2)), null), null);
});

test('las partidas de ARAM no cuentan', () => {
  assert.equal(buildForecast(profile(games(10, { sr: false })), null), null);
});

test('con estadísticas de rango alto, el rango previsto sube', () => {
  const f = buildForecast(profile(games(16, { csMin: 8.4, goldMin: 470, dmgMin: 820, d: 4.8, k: 8, a: 8, visionMin: 0.65 })), null);
  assert.ok(f.predicted.abs > f.current.abs, 'el previsto debería estar por encima del actual');
  assert.ok(f.diffDivs >= 1);
  assert.match(f.verdict, /por encima/);
});

test('con estadísticas de rango bajo, el rango previsto baja', () => {
  const f = buildForecast(profile(games(16, { csMin: 5, goldMin: 360, dmgMin: 480, d: 7, k: 3, a: 4, visionMin: 0.3 })), null);
  assert.ok(f.predicted.abs < f.current.abs);
  assert.match(f.verdict, /por debajo/);
});

test('la confianza depende del número de partidas', () => {
  assert.equal(buildForecast(profile(games(5)), null).confidence, 'baja');
  assert.equal(buildForecast(profile(games(10)), null).confidence, 'media');
  assert.equal(buildForecast(profile(games(16)), null).confidence, 'alta');
});

test('con pocas partidas, la previsión se aleja menos de tu rango actual', () => {
  const strong = { csMin: 8.4, goldMin: 470, dmgMin: 820, d: 4.8, k: 8, a: 8, visionMin: 0.65 };
  const few = buildForecast(profile(games(5, strong)), null);
  const many = buildForecast(profile(games(16, strong)), null);
  assert.ok(few.predicted.abs - few.current.abs < many.predicted.abs - many.current.abs);
});

test('la proyección usa tus LP reales si los hay', () => {
  const lp = { solo: { current: { abs: 1437 }, avgWin: 21, avgLoss: -19 } };
  const f = buildForecast(profile(games(16)), lp);
  assert.equal(f.projection.W, 21);
  assert.equal(f.projection.L, 19);
  assert.equal(f.projection.assumed, false);
  assert.ok(f.mmr);
  const g = buildForecast(profile(games(16)), null);
  assert.equal(g.projection.assumed, true, 'sin LP guardados supone ±20');
});

test('textos en tercera persona para otros jugadores', () => {
  const f = buildForecast(profile(games(16)), null, { other: true });
  assert.match(f.verdict, /^Su/);
});
