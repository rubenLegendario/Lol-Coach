import { localRequest } from './util/http.js';

/**
 * Live Client Data API: la expone el propio juego en el puerto 2999 mientras hay una partida
 * (incluida la Herramienta de práctica). Devuelve null si no hay partida o aún está cargando.
 */
export async function getLiveGame() {
  try {
    const data = await localRequest({ port: 2999, path: '/liveclientdata/allgamedata', timeout: 1500 });
    if (!Array.isArray(data?.allPlayers) || !data.allPlayers.length) return null;
    if (!data.activePlayer || data.activePlayer.error) data.activePlayer = {}; // modo espectador: no hay jugador activo
    return data;
  } catch {
    return null;
  }
}
