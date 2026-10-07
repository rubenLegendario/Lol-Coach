import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrScore } from '../src/engine/iterolive.js';
import { App } from '../src/app.js';
import { TIERS } from '../src/engine/itemstats.js';

test('puntuación 0-5 a partir del winrate (estilo iTero)', () => {
  assert.equal(wrScore(0.45), 0);
  assert.equal(wrScore(0.5), 2.5);
  assert.equal(wrScore(0.55), 5);
  assert.equal(wrScore(0.6), 5, 'no pasa de 5');
  assert.equal(wrScore(0.3), 0, 'no baja de 0');
  assert.equal(wrScore(null), null);
});

const view = (o = {}) => ({ gameTime: 15 * 60, goldDiff: 0, teams: { draft: { winProb: 50 } }, objectives: { drakes: { ally: [], enemy: [] } }, ...o });

test('probabilidad en directo: partida igualada = 50%', () => {
  assert.equal(App.probOf(view()), 50);
});

test('probabilidad en directo: parte del draft', () => {
  assert.equal(App.probOf(view({ teams: { draft: { winProb: 55 } } })), 55);
});

test('probabilidad en directo: el oro pesa y pesa más al principio', () => {
  assert.ok(App.probOf(view({ goldDiff: 5000 })) > 75);
  assert.ok(App.probOf(view({ goldDiff: -5000 })) < 25);
  const early = App.probOf(view({ gameTime: 8 * 60, goldDiff: 2000 }));
  const late = App.probOf(view({ gameTime: 30 * 60, goldDiff: 2000 }));
  assert.ok(early > late, `2k de oro al 8' (${early}) debería valer más que al 30' (${late})`);
});

test('probabilidad en directo: los dragones suman y hay límites', () => {
  const d = App.probOf(view({ objectives: { drakes: { ally: ['Infernal', 'Océano'], enemy: [] } } }));
  assert.ok(d > 50);
  assert.equal(App.probOf(view({ goldDiff: 60000 })), 97);
  assert.equal(App.probOf(view({ goldDiff: -60000 })), 3);
});

test('los rangos de Builds son valores que acepta OP.GG (silver_plus da error 422)', () => {
  assert.ok(!('silver_plus' in TIERS));
  for (const k of ['all', 'gold_plus', 'emerald_plus', 'master_plus']) assert.ok(k in TIERS, k);
});
