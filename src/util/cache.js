import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const memory = new Map();
const inflight = new Map();

function fileFor(key) {
  return path.join(config.cacheDir, key.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json');
}

/**
 * Devuelve el valor cacheado (memoria y disco) o lo carga con `loader`.
 * Si la carga falla y hay una copia caducada en disco, se usa esa.
 */
export async function cached(key, ttlMs, loader, { disk = true } = {}) {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && now - mem.t < ttlMs) return mem.v;

  let stale = mem;
  if (!mem && disk) {
    try {
      const entry = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
      memory.set(key, entry);
      if (now - entry.t < ttlMs) return entry.v;
      stale = entry;
    } catch { /* no hay copia en disco */ }
  }

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await loader();
      const entry = { t: Date.now(), v };
      memory.set(key, entry);
      if (disk) {
        fs.mkdirSync(config.cacheDir, { recursive: true });
        fs.writeFileSync(fileFor(key), JSON.stringify(entry));
      }
      return v;
    } catch (err) {
      if (stale) return stale.v;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Borra una entrada (memoria y disco) para que la próxima lectura la vuelva a calcular. */
export function forget(key) {
  memory.delete(key);
  try {
    fs.unlinkSync(fileFor(key));
  } catch { /* no estaba en disco */ }
}
