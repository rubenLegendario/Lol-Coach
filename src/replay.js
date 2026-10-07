/**
 * "Mando del analista" para repeticiones: descarga y abre la repetición oficial con el cliente y la
 * controla desde la app con la Replay API del juego (https://127.0.0.1:2999/replay/...):
 * saltar a un momento, velocidad, pausa y fijar la cámara en un campeón.
 *
 * La Replay API necesita "EnableReplayApi=1" en la sección [General] de Config/game.cfg.
 * La activamos la primera vez (guardando antes una copia del archivo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { localRequest } from './util/http.js';

const BODY = { componentType: 'replay-button_match-history' };
const cfgFile = () => path.join(config.lolPath, 'Config', 'game.cfg');

export function replayApiEnabled() {
  try {
    return /^\s*EnableReplayApi\s*=\s*1\s*$/im.test(fs.readFileSync(cfgFile(), 'utf8'));
  } catch {
    return false;
  }
}

/** Activa la Replay API en game.cfg. Devuelve true si hubo que cambiar el archivo. */
export function enableReplayApi() {
  const file = cfgFile();
  const text = fs.readFileSync(file, 'utf8');
  if (/^\s*EnableReplayApi\s*=\s*1\s*$/im.test(text)) return false;
  fs.copyFileSync(file, `${file}.lolcoach-backup`);
  let next;
  if (/^\s*EnableReplayApi\s*=.*$/im.test(text)) next = text.replace(/^\s*EnableReplayApi\s*=.*$/im, 'EnableReplayApi=1');
  else if (/^\[General\]\s*$/im.test(text)) next = text.replace(/^\[General\]\s*$/im, (m) => `${m}\r\nEnableReplayApi=1`);
  else next = `[General]\r\nEnableReplayApi=1\r\n${text}`;
  fs.writeFileSync(file, next);
  return true;
}

async function api(method, p, body) {
  return localRequest({ port: 2999, path: p, method, body, timeout: 2500 });
}

/** ¿Hay una repetición abierta y controlable? */
export async function playbackState() {
  try {
    return await api('GET', '/replay/playback');
  } catch {
    return null;
  }
}

export async function replayStatus(lcu, gameId) {
  const [meta, conf, playback] = await Promise.all([
    lcu.get(`/lol-replays/v1/metadata/${gameId}`).catch(() => null),
    lcu.get('/lol-replays/v1/configuration').catch(() => null),
    playbackState(),
  ]);
  return {
    state: meta?.state || 'unknown', // download | downloading | watch | incompatible | missingOrExpired | ...
    progress: meta?.downloadProgress ?? null,
    playingReplay: !!conf?.isPlayingReplay,
    connected: !!playback,
    length: playback?.length ?? null,
    time: playback?.time ?? null,
    paused: playback?.paused ?? null,
    speed: playback?.speed ?? null,
    apiEnabled: replayApiEnabled(),
  };
}

/** Descarga (si hace falta) y abre la repetición en el juego. */
export async function openReplay(lcu, gameId) {
  const changedCfg = enableReplayApi();
  let meta = await lcu.get(`/lol-replays/v1/metadata/${gameId}`);
  if (meta?.state === 'incompatible') throw new Error('Esta repetición es de otro parche: Riot solo deja ver repeticiones del parche actual.');
  if (meta?.state === 'missingOrExpired' || meta?.state === 'lost') throw new Error('La repetición ya no está disponible en los servidores de Riot.');
  if (meta?.state === 'download') await lcu.post(`/lol-replays/v1/rofls/${gameId}/download`, BODY);
  for (let i = 0; i < 120 && meta?.state !== 'watch'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    meta = await lcu.get(`/lol-replays/v1/metadata/${gameId}`);
    if (['incompatible', 'missingOrExpired', 'error', 'lost'].includes(meta?.state)) throw new Error(`No se pudo descargar la repetición (${meta.state}).`);
  }
  if (meta?.state !== 'watch') throw new Error('La descarga de la repetición está tardando demasiado; vuelve a intentarlo en un momento.');
  await lcu.post(`/lol-replays/v1/rofls/${gameId}/watch`, BODY);
  return { ok: true, changedCfg };
}

/** Nombre con el que la repetición identifica a un jugador (para fijar la cámara). */
async function selectionNameFor(champion, championId) {
  try {
    const players = await localRequest({ port: 2999, path: '/liveclientdata/playerlist', timeout: 2000 });
    const keys = [champion, championId].filter(Boolean);
    const p = players.find((x) => keys.some((k) => x.championName === k || x.rawChampionName?.endsWith(`_${k}`) || x.rawChampionName?.includes(`_${k}_`)));
    return p?.riotIdGameName || p?.summonerName || null;
  } catch {
    return null;
  }
}

/**
 * Acciones: seek (t en segundos, con 'lead' segundos de margen), play, pause, speed, follow (champion).
 */
export async function controlReplay({ action, t, lead = 10, speed, champion, championId, follow, followId }) {
  const pb = await playbackState();
  if (!pb) throw new Error('No hay ninguna repetición abierta (o el juego aún está cargando).');
  if (action === 'seek') {
    await api('POST', '/replay/playback', { time: Math.max(0, Number(t) - lead), paused: false, seeking: true, ...(speed ? { speed } : {}) });
    if (follow) await controlReplay({ action: 'follow', champion: follow, championId: followId });
  } else if (action === 'pause' || action === 'play') {
    await api('POST', '/replay/playback', { paused: action === 'pause' });
  } else if (action === 'speed') {
    await api('POST', '/replay/playback', { speed: Number(speed) || 1 });
  } else if (action === 'follow') {
    const name = await selectionNameFor(champion, championId);
    if (!name) throw new Error(`No encuentro a ${champion} en la repetición.`);
    // La repetición recupera su propia selección si solo cambiamos el nombre: hay que soltar la cámara
    // y volver a fijarla en el nuevo jugador. Comprobamos que se ha quedado y, si no, reintentamos.
    for (let attempt = 0; attempt < 3; attempt++) {
      await api('POST', '/replay/render', { cameraAttached: false });
      await new Promise((r) => setTimeout(r, 120));
      await api('POST', '/replay/render', { selectionName: name, cameraAttached: true, cameraMode: 'top' });
      await new Promise((r) => setTimeout(r, 500));
      const render = await api('GET', '/replay/render').catch(() => null);
      if (render?.selectionName === name) break;
    }
  } else {
    throw new Error(`Acción desconocida: ${action}`);
  }
  return playbackState();
}
