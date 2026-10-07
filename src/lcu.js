import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { localRequest, HttpError } from './util/http.js';

const LOCKFILE_CANDIDATES = [
  config.lolPath,
  'C:/Riot Games/League of Legends',
  'D:/Riot Games/League of Legends',
  'E:/Riot Games/League of Legends',
];

function readLockfile() {
  for (const dir of LOCKFILE_CANDIDATES) {
    try {
      const [, , port, password] = fs.readFileSync(path.join(dir, 'lockfile'), 'utf8').split(':');
      if (port && password) return { port: Number(port), password };
    } catch { /* probar la siguiente ruta */ }
  }
  return null;
}

// Plan B: leer el puerto y el token de la línea de comandos del proceso del cliente.
function readFromProcess() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const port = stdout.match(/--app-port=(\d+)/)?.[1];
        const password = stdout.match(/--remoting-auth-token=([\w-]+)/)?.[1];
        resolve(port && password ? { port: Number(port), password } : null);
      },
    );
  });
}

export class LCU {
  creds = null;
  lastDiscover = 0;

  get connected() {
    return !!this.creds;
  }

  async discover() {
    if (Date.now() - this.lastDiscover < 3000) return this.creds;
    this.lastDiscover = Date.now();
    this.creds = readLockfile() || (await readFromProcess());
    return this.creds;
  }

  async request(method, apiPath, body) {
    if (!this.creds && !(await this.discover())) throw new Error('Cliente del LoL no encontrado');
    try {
      return await localRequest({
        port: this.creds.port,
        path: apiPath,
        method,
        body,
        auth: `riot:${this.creds.password}`,
      });
    } catch (err) {
      if (!(err instanceof HttpError)) this.creds = null; // cliente cerrado o reiniciado
      throw err;
    }
  }

  /** GET que devuelve null en 404 (p. ej. "no hay sesión de selección"). */
  async get(apiPath) {
    try {
      return await this.request('GET', apiPath);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  post(p, body) { return this.request('POST', p, body); }
  put(p, body) { return this.request('PUT', p, body); }
  patch(p, body) { return this.request('PATCH', p, body); }
  delete(p) { return this.request('DELETE', p); }
}
