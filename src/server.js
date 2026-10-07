import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { VERSION_INFO } from './version.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createServer(app) {
  const clients = new Set();

  app.on('state', (state) => {
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) res.write(msg);
  });

  // Mantiene vivas las conexiones SSE
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20000).unref();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(app.state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/state') return json(res, 200, app.state);
    if (url.pathname === '/api/version') return json(res, 200, VERSION_INFO);
    if (url.pathname === '/api/overlay') return json(res, 200, app.overlay());
    if (url.pathname === '/api/settings') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        try {
          return json(res, 200, app.updateSetting(b.reset ? null : b.path, b.value));
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }
      return json(res, 200, app.state.settings);
    }

    // Notas de matchup, objetivo de LP y asesor de pool
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 200, await app.saveNote(b));
    }
    if (url.pathname === '/api/notes') {
      return json(res, 200, await app.notes(Number(url.searchParams.get('me')) || 0, Number(url.searchParams.get('vs'))));
    }
    if (url.pathname === '/api/notes/all') return json(res, 200, await app.allNotes());
    if (url.pathname === '/api/goal' && req.method === 'POST') {
      try {
        return json(res, 200, await app.saveGoal(await readBody(req)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (url.pathname === '/api/mypool') {
      try {
        if (req.method === 'POST') return json(res, 200, await app.editMyPool(await readBody(req)));
        return json(res, 200, await app.myPool());
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (url.pathname === '/api/champions') return json(res, 200, await app.championList());
    if (url.pathname === '/api/tierlist') {
      try {
        return json(res, 200, await app.tierList(Object.fromEntries(url.searchParams)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (url.pathname === '/api/itemstats') {
      try {
        return json(res, 200, await app.itemStats(Object.fromEntries(url.searchParams)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (url.pathname === '/api/pool') {
      try {
        return json(res, 200, await app.pool(url.searchParams.get('role')));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Pantalla de inicio (perfil) y coach
    if (url.pathname === '/api/profile' || url.pathname === '/api/coach') {
      try {
        const opts = { queue: url.searchParams.get('queue') || 'auto', champ: Number(url.searchParams.get('champ')) || null };
        return json(res, 200, url.pathname === '/api/profile' ? await app.profile(opts) : await app.coach());
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Tendencias, buscador de jugadores y repeticiones
    const route = async (fn) => {
      try {
        return json(res, 200, await fn());
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    };
    if (url.pathname === '/api/trends') return route(() => app.trends());
    if (url.pathname.startsWith('/api/trends/')) return route(() => app.otherTrends(decodeURIComponent(url.pathname.slice('/api/trends/'.length))));
    if (url.pathname === '/api/search') return route(() => app.search(url.searchParams.get('q')));
    const liveMatch = url.pathname.match(/^\/api\/(live|spectate)\/([\w-]+)$/);
    if (liveMatch) return route(() => (liveMatch[1] === 'live' ? app.liveOf(liveMatch[2]) : app.spectate(liveMatch[2])));
    const profMatch = url.pathname.match(/^\/api\/(profile|coach)\/([\w-]+)$/);
    if (profMatch) {
      const opts = { queue: url.searchParams.get('queue') || 'auto', champ: Number(url.searchParams.get('champ')) || null };
      return route(() => (profMatch[1] === 'profile' ? app.otherProfile(profMatch[2], opts) : app.otherCoach(profMatch[2])));
    }
    if (url.pathname === '/api/replay/control' && req.method === 'POST') {
      const b = await readBody(req);
      return route(() => app.controlReplay(b));
    }
    const repAt = url.pathname.match(/^\/api\/replay\/(\d+)\/at$/);
    if (repAt && req.method === 'POST') {
      const b = await readBody(req);
      return route(() => app.replayAt(Number(repAt[1]), b));
    }
    const repMatch = url.pathname.match(/^\/api\/replay\/(\d+)(\/open)?$/);
    if (repMatch) return route(() => (repMatch[2] && req.method === 'POST' ? app.openReplay(Number(repMatch[1])) : app.replayStatus(Number(repMatch[1]))));

    // Ficha de cualquier jugador (rango, forma, maestría)
    const playerMatch = url.pathname.match(/^\/api\/player\/([\w-]+)$/);
    if (playerMatch) {
      try {
        return json(res, 200, await app.playerInfo(playerMatch[1], Number(url.searchParams.get('champ')) || null));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Explorador del mapa de una partida
    const mapMatch = url.pathname.match(/^\/api\/games\/(\d+)\/map$/);
    if (mapMatch) {
      try {
        return json(res, 200, await app.gameMap(Number(mapMatch[1]), url.searchParams.get('puuid')));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Resúmenes para las filas del historial: ?ids=1,2,3&puuid=…
    if (url.pathname === '/api/games/summary') {
      try {
        const ids = (url.searchParams.get('ids') || '').split(',').map(Number).filter(Number.isFinite).slice(0, 25);
        return json(res, 200, await app.gameSummaries(ids, url.searchParams.get('puuid')));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Análisis post-partida
    if (url.pathname === '/api/games' || url.pathname.startsWith('/api/games/')) {
      try {
        const id = url.pathname.split('/')[3];
        return json(res, 200, id ? await app.gameAnalysis(Number(id), url.searchParams.get('puuid')) : await app.gameList());
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    if (url.pathname.startsWith('/api/apply/') && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const message = await app.action(url.pathname.split('/').pop(), body);
        return json(res, 200, { ok: true, message });
      } catch (err) {
        return json(res, 400, { ok: false, message: err.message });
      }
    }

    // Archivos estáticos
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
