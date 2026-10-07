import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';

/** "16.19.8230722+branch..." o "16.19.823.722" -> "16.19" */
export function patchOf(version) {
  const m = typeof version === 'string' && version.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Versión del juego instalado, leída del ejecutable (funciona aunque el cliente esté cerrado). */
export function installedGameVersion() {
  const exe = path.join(config.lolPath, 'Game', 'League of Legends.exe').replace(/'/g, "''");
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.FileVersion`],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.trim() || null),
    );
  });
}

/** Versión que reporta el cliente abierto (LCU). */
export async function clientGameVersion(lcu) {
  const v = await lcu.get('/lol-patch/v1/game-version').catch(() => null);
  return typeof v === 'string' ? v : null;
}
