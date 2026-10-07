import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddragon } from '../src/data/ddragon.js';
import { ownedSet, ownedBoots } from '../src/engine/ingame.js';

// Catálogo mínimo (sin red): botas, botas de nivel 3 y un objeto con mejora
const add = (id, gold, from = [], into = [], tags = []) => ddragon.items.set(id, { id, name: String(id), gold, from, into, tags });
add(1001, 300, [], [3006, 3009], ['Boots']);
add(1042, 250, [], [3006]);
add(3006, 1100, [1001, 1042, 1042], [3172], ['Boots']);
add(3009, 1000, [1001], [3170], ['Boots']);
add(3172, 1100, [3006], [], ['AttackSpeed', 'NonbootsMovement']);
add(1037, 875, [], [3031]);
add(3031, 3400, [1037], []);

test('las botas de nivel 3 cuentan como sus botas de nivel 2', () => {
  const owned = ownedSet(new Map([[3172, 1]]));
  assert.ok(owned.has(3006));
  assert.equal(ownedBoots(owned), 3172);
});

test('cualquier par de botas cuenta como botas hechas, pero las básicas no', () => {
  assert.equal(ownedBoots(ownedSet(new Map([[3009, 1]]))), 3009);
  assert.equal(ownedBoots(ownedSet(new Map([[1001, 1]]))), null);
});

test('un objeto completo no marca sus componentes sueltos como comprados', () => {
  assert.ok(!ownedSet(new Map([[3031, 1]])).has(1037));
});
