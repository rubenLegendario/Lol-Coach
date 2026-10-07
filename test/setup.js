// Se importa el primero en cada test: hace que la app guarde sus datos en una carpeta temporal
// (así los tests nunca tocan tus datos reales de data/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolcoach-test-'));
process.env.LOLCOACH_DATA_DIR = dir;

/** LCU falso: responde según un mapa ruta -> datos (o función). */
export function fakeLcu(routes) {
  return {
    connected: true,
    async get(p) {
      for (const [k, v] of Object.entries(routes)) {
        if (p === k || p.startsWith(k + '?')) return typeof v === 'function' ? v(p) : structuredClone(v);
      }
      return null;
    },
    async request() { return null; },
  };
}
