import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVersionInfo, VERSION_INFO } from '../src/version.js';

function tmpPkg(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolcoach-ver-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), content);
  return dir;
}

test('lee versión y repo del package.json real', () => {
  assert.match(VERSION_INFO.version, /^\d+\.\d+\.\d+$/);
  assert.ok(VERSION_INFO.updateRepo === null || /\//.test(VERSION_INFO.updateRepo));
});

test('updateRepo vacío o mal formado => null', () => {
  assert.deepEqual(readVersionInfo(tmpPkg('{"version":"1.2.3","updateRepo":""}')), { version: '1.2.3', updateRepo: null });
  assert.deepEqual(readVersionInfo(tmpPkg('{"version":"1.2.3","updateRepo":"no es repo"}')), { version: '1.2.3', updateRepo: null });
  assert.deepEqual(readVersionInfo(tmpPkg('{"version":"1.2.3","updateRepo":" ruben/lol-coach "}')), { version: '1.2.3', updateRepo: 'ruben/lol-coach' });
});

test('package.json ausente o roto => nulls', () => {
  assert.deepEqual(readVersionInfo(tmpPkg()), { version: null, updateRepo: null });
  assert.deepEqual(readVersionInfo(tmpPkg('{roto')), { version: null, updateRepo: null });
});
