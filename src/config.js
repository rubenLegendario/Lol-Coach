import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadDotEnv(), ...process.env };

export const config = {
  port: Number(env.PORT) || 3737,
  host: env.HOST || '127.0.0.1',
  lolPath: env.LOL_PATH || 'C:/Riot Games/League of Legends',
  statsRegion: env.STATS_REGION || 'EUW',
  statsTier: env.STATS_TIER || 'emerald_plus',
  locale: env.LOCALE || 'es_ES',
  // Objetivos (temporada 2026): el Barón vuelve al minuto 20 y Atakhan ya no existe
  baronFirstSpawn: (Number(env.BARON_FIRST_SPAWN_MIN) || 20) * 60,
  grubsSpawn: (Number(env.GRUBS_SPAWN_MIN) || 8) * 60,
  heraldSpawn: (Number(env.HERALD_SPAWN_MIN) || 15) * 60,
  heraldDespawn: (Number(env.HERALD_DESPAWN_MIN) || 19.75) * 60,
  inhibRespawn: (Number(env.INHIB_RESPAWN_MIN) || 5) * 60,
  pollMs: 1500,
  // Carpeta de datos (LOLCOACH_DATA_DIR para usar otra, p. ej. en los tests)
  cacheDir: path.join(process.env.LOLCOACH_DATA_DIR || path.join(ROOT, 'data'), 'cache'),
};
