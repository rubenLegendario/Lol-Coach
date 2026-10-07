import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../src/store.js';

test('por defecto, todo activado y el overlay bloqueado', () => {
  const s = getSettings();
  assert.equal(s.overlay.enabled, true);
  assert.equal(s.overlay.locked, true);
  assert.equal(s.alerts.voice, false);
});

test('los interruptores se guardan como sí/no', () => {
  assert.equal(setSetting('live.pairs', 0).live.pairs, false);
  assert.equal(setSetting('live.pairs', 'x').live.pairs, true);
});

test('las posiciones del overlay se limitan a la pantalla (0-1) o null', () => {
  assert.deepEqual(setSetting('overlay.posCs', { x: 1.7, y: -2 }).overlay.posCs, { x: 1, y: 0 });
  assert.equal(setSetting('overlay.posCs', 'basura').overlay.posCs, null);
});

test('la clave de Riot se guarda como texto recortado', () => {
  assert.equal(setSetting('riot.apiKey', '  RGAPI-123  ').riot.apiKey, 'RGAPI-123');
});

test('un ajuste desconocido da error', () => {
  assert.throws(() => setSetting('live.noexiste', true), /desconocido/);
  assert.throws(() => setSetting('nogroup.x', true), /desconocido/);
});

test('restaurar vuelve a los valores por defecto', () => {
  setSetting('alerts.voice', true);
  const s = setSetting(null);
  assert.deepEqual(s, structuredClone(DEFAULT_SETTINGS));
});
