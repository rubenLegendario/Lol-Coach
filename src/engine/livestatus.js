/**
 * ¿Está este jugador en partida?
 *
 * - Amigos: el cliente del LoL da su estado (en partida, en selección…), campeón, cola, hora de inicio
 *   y la clave para verla como espectador. No necesita nada más.
 * - Cualquier otro jugador: Riot desactivó esa consulta en el cliente, así que solo es posible con una
 *   clave de la API de Riot (spectator-v5), que se puede poner en Ajustes. Con ella además sabemos
 *   los 10 jugadores, los hechizos y los baneos.
 */
import { config } from '../config.js';
import { ddragon } from '../data/ddragon.js';
import { queueName } from './postgame.js';

const PLATFORM = { EUW: 'euw1', EUNE: 'eun1', NA: 'na1', KR: 'kr', BR: 'br1', LAN: 'la1', LAS: 'la2', OCE: 'oc1', TR: 'tr1', RU: 'ru', JP: 'jp1', ME: 'me1', SEA: 'sg2', TW: 'tw2', VN: 'vn2' };

let friendsCache = { at: 0, list: [] };

export async function friends(lcu) {
  if (Date.now() - friendsCache.at < 15_000) return friendsCache.list;
  const list = (await lcu.get('/lol-chat/v1/friends').catch(() => null)) || [];
  friendsCache = { at: Date.now(), list };
  return list;
}

/** Partida en curso desde la API de Riot (null si no está en partida). Lanza error si la clave no vale. */
async function riotActiveGame(puuid, apiKey) {
  const host = PLATFORM[String(config.statsRegion).toUpperCase()] || 'euw1';
  const res = await fetch(`https://${host}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`, { headers: { 'X-Riot-Token': apiKey } });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('La clave de la API de Riot no es válida o ha caducado (las de desarrollo duran 24 h)');
  if (!res.ok) throw new Error(`API de Riot: error ${res.status}`);
  return res.json();
}

/**
 * Estado en directo de un jugador. scout(puuid, champId) y draft(allies, enemies) vienen de la app
 * para reutilizar el scouting y el modelo de draft.
 */
export async function liveStatus(lcu, puuid, { apiKey = '', scout = null, draft = null } = {}) {
  const list = await friends(lcu);
  const f = list.find((x) => x.puuid === puuid);
  const lol = f?.lol || {};
  const base = { friend: !!f, canDetect: !!f || !!apiKey, keyConfigured: !!apiKey };

  let game = null;
  let keyError = null;
  if (apiKey) {
    try {
      game = await riotActiveGame(puuid, apiKey);
    } catch (err) {
      keyError = err.message;
    }
  }

  if (game) {
    const me = game.participants.find((p) => p.puuid === puuid);
    const view = (p) => ({
      puuid: p.puuid,
      name: p.riotId || '',
      isTarget: p.puuid === puuid,
      champ: ddragon.champView(p.championId),
      spells: [p.spell1Id, p.spell2Id].map((k) => ddragon.spellView(k)).filter(Boolean),
      keystone: p.perks?.perkIds?.[0] ? ddragon.runeView?.(p.perks.perkIds[0]) || null : null,
      scout: scout && p.puuid ? scout(p.puuid, p.championId) : null,
    });
    const allies = game.participants.filter((p) => p.teamId === me?.teamId).map(view);
    const enemies = game.participants.filter((p) => p.teamId !== me?.teamId).map(view);
    let winProb = null;
    if (draft) {
      try {
        winProb = await draft(game.participants.filter((p) => p.teamId === me?.teamId).map((p) => p.championId), game.participants.filter((p) => p.teamId !== me?.teamId).map((p) => p.championId));
      } catch { /* sin predicción */ }
    }
    return {
      ...base,
      inGame: true,
      source: 'riot',
      queueId: game.gameQueueConfigId,
      gameId: game.gameId || null,
      queue: queueName(game.gameQueueConfigId),
      champ: ddragon.champView(me?.championId),
      startTime: game.gameStartTime || null,
      gameLength: game.gameLength ?? null,
      fetchedAt: Date.now(),
      allies,
      enemies,
      bans: (game.bannedChampions || []).filter((b) => b.championId > 0).map((b) => ({ champ: ddragon.champView(b.championId), ally: b.teamId === me?.teamId })),
      winProb,
      spectatable: !!(f && lol.spectatorKey && lol.isObservable === 'ALL'),
    };
  }

  if (f && lol.gameStatus === 'inGame') {
    const qid = Number(lol.queueId) || null;
    return {
      ...base,
      inGame: true,
      source: 'friend',
      queueId: qid,
      queue: qid ? queueName(qid) : lol.gameQueueType || 'Partida',
      champ: ddragon.champView(Number(lol.championId)),
      startTime: Number(lol.timeStamp) || null,
      gameId: Number(lol.gameId) || null,
      spectatable: !!(lol.spectatorKey && lol.isObservable === 'ALL'),
      keyError,
    };
  }

  const pre = { championSelect: 'En selección de campeón', inQueue: 'Buscando partida', hosting_NORMAL: 'En una sala' }[lol.gameStatus] || null;
  return { ...base, inGame: false, status: f ? (pre || (f.availability === 'offline' ? 'Desconectado' : 'En el cliente')) : null, keyError };
}

/** Abre el modo espectador de la partida de un amigo (el cliente del LoL la abre con ~3 min de retraso). */
export async function spectateFriend(lcu, puuid) {
  friendsCache.at = 0;
  const f = (await friends(lcu)).find((x) => x.puuid === puuid);
  if (!f || f.lol?.gameStatus !== 'inGame') throw new Error('Ya no está en partida');
  if (!f.lol.spectatorKey || f.lol.isObservable !== 'ALL') throw new Error('Su partida no se puede ver como espectador');
  const body = { puuid, spectatorKey: f.lol.spectatorKey, dropInSpectateGameId: '', gameQueueType: f.lol.gameQueueType || '', allowObserveMode: 'ALL' };
  await lcu.request('POST', '/lol-spectator/v1/spectate/launch', body);
  return { ok: true, name: `${f.gameName}#${f.gameTag}` };
}
