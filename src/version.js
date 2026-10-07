import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/**
 * Versión de la app y repositorio de GitHub de donde salen las actualizaciones (package.json).
 * `updateRepo` tiene el formato `propietario/repo`; vacío o ausente => null (aún no hay repo).
 * Si package.json falta o está roto devuelve nulls en vez de romper el servidor.
 */
export function readVersionInfo(root = ROOT) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
    const repo = typeof pkg.updateRepo === 'string' ? pkg.updateRepo.trim() : '';
    return { version, updateRepo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null };
  } catch {
    return { version: null, updateRepo: null };
  }
}

export const VERSION_INFO = readVersionInfo();
