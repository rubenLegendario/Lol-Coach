/**
 * "Scouting" de jugadores usando solo el cliente local (LCU): rango, historial y maestría.
 * No necesita clave de la API de Riot.
 */
import { cached } from './util/cache.js';
import { ddragon } from './data/ddragon.js';
import { roughPosition } from './util/positions.js';

const RANKED_QUEUES = new Set([420, 440]);
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};

function rankOf(stats) {
  const q = stats?.queueMap || {};
  for (const [queue, label] of [['RANKED_SOLO_5x5', 'SoloQ'], ['RANKED_FLEX_SR', 'Flex']]) {
    const e = q[queue];
    if (e?.tier && e.tier !== 'NONE' && e.tier !== '') {
      const games = e.wins + e.losses;
      const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier);
      return {
        queue: label,
        tier: e.tier,
        text: `${TIER_ES[e.tier] || e.tier}${apex ? '' : ' ' + e.division} · ${e.leaguePoints} LP`,
        wins: e.wins,
        losses: e.losses,
        // A veces el cliente no devuelve las derrotas de otros jugadores (0D con cientos de V): mejor no mostrar un 100% falso
        winRate: games && !(e.losses === 0 && e.wins > 20) ? e.wins / games : null,
      };
    }
  }
  return { queue: null, tier: 'UNRANKED', text: 'Sin clasificar', wins: 0, losses: 0, winRate: null };
}

async function loadPlayer(lcu, puuid) {
  const [stats, history, mastery] = await Promise.all([
    lcu.get(`/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => null),
    lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`).catch(() => null),
    lcu.get(`/lol-champion-mastery/v1/${puuid}/champion-mastery`).catch(() => null),
  ]);

  const ids = (history?.games?.games || []).map((g) => g.gameId).filter(Boolean);
  const all = (history?.games?.games || []).filter((g) => g.mapId === 11);
  const ranked = all.filter((g) => RANKED_QUEUES.has(g.queueId));
  const games = (ranked.length >= 5 ? ranked : all).map((g) => {
    const p = g.participants?.[0] || {};
    const s = p.stats || {};
    const pos = roughPosition(p);
    const min = Math.max(1, (g.gameDuration || 1800) / 60);
    return {
      win: !!s.win, champId: p.championId, k: s.kills, d: s.deaths, a: s.assists, at: g.gameCreation, pos,
      csMin: ((s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0)) / min,
      visionMin: (s.visionScore || 0) / min,
      dmgMin: (s.totalDamageDealtToChampions || 0) / min,
      fb: !!(s.firstBloodKill || s.firstBloodAssist),
    };
  });

  return {
    ids,
    rank: rankOf(stats),
    games,
    mastery: (Array.isArray(mastery) ? mastery : []).map((m) => ({ champId: m.championId, level: m.championLevel, points: m.championPoints })),
  };
}

/** Información resumida de un jugador para mostrar en el panel. */
export async function scoutPlayer(lcu, puuid, champId, pos = null) {
  if (!puuid) return null;
  const p = await cached(`player_${puuid}`, 10 * 60_000, () => loadPlayer(lcu, puuid), { disk: false });

  const recent = p.games.slice(0, 10);
  const wins = recent.filter((g) => g.win).length;
  let streak = 0;
  for (const g of p.games) {
    if (g.win === p.games[0].win) streak++;
    else break;
  }
  if (p.games.length && !p.games[0].win) streak = -streak;

  const onChamp = champId ? p.games.filter((g) => g.champId === champId) : [];
  const champMastery = champId ? p.mastery.find((m) => m.champId === champId) : null;
  const kda = recent.length
    ? recent.reduce((s, g) => s + g.k + g.a, 0) / Math.max(1, recent.reduce((s, g) => s + g.d, 0))
    : null;

  const counts = {};
  for (const g of p.games) counts[g.champId] = (counts[g.champId] || 0) + 1;
  const [topChamp, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];

  const tags = [];
  // Estilo de juego (etiquetas legibles a partir de sus últimas partidas, como el scouting de iTero)
  const G = p.games;
  const avg = (fn, list = G) => (list.length ? list.reduce((s, g) => s + fn(g), 0) / list.length : null);
  const posCount = {};
  for (const g of G) if (g.pos) posCount[g.pos] = (posCount[g.pos] || 0) + 1;
  const [mainPos, mainPosN] = Object.entries(posCount).sort((a, b) => b[1] - a[1])[0] || [];
  const POS_ES = { TOP: 'top', JUNGLE: 'jungla', MIDDLE: 'mid', BOTTOM: 'ADC', UTILITY: 'support' };
  if (pos && mainPos && mainPos !== pos && mainPosN / G.length >= 0.7 && G.length >= 5) tags.push({ type: 'weak', text: `Fuera de su rol (suele ir ${POS_ES[mainPos]})` });
  if (G.length >= 5) {
    const deaths = avg((g) => g.d);
    const lanes = G.filter((g) => g.pos && g.pos !== 'UTILITY' && g.pos !== 'JUNGLE');
    const csMin = lanes.length >= 3 ? avg((g) => g.csMin, lanes) : null;
    const sup = G.filter((g) => g.pos === 'UTILITY');
    const visionMin = avg((g) => g.visionMin);
    const fbRate = avg((g) => (g.fb ? 1 : 0));
    if (deaths >= 7) tags.push({ type: 'weak', text: `Muere mucho (${deaths.toFixed(1)} por partida)` });
    else if (deaths <= 3.5) tags.push({ type: 'strong', text: 'Juega seguro, muere poco' });
    if (fbRate >= 0.35) tags.push({ type: 'info', text: `Agresivo early (primera sangre en ${Math.round(fbRate * 100)}%)` });
    if (csMin != null && csMin >= 7.5) tags.push({ type: 'strong', text: `Farmea muy bien (${csMin.toFixed(1)} CS/min)` });
    else if (csMin != null && csMin < 5.5) tags.push({ type: 'weak', text: `Farmea poco (${csMin.toFixed(1)} CS/min)` });
    if (sup.length < G.length / 2 && visionMin != null && visionMin < 0.5) tags.push({ type: 'weak', text: 'Pone muy pocos wards' });
    if (avg((g) => g.dmgMin) >= 950) tags.push({ type: 'strong', text: 'Hace mucho daño' });
  }
  if (streak >= 3) tags.push({ type: 'strong', text: `${streak} victorias seguidas` });
  if (streak <= -3) tags.push({ type: 'weak', text: `${-streak} derrotas seguidas` });
  if (champId && !champMastery) tags.push({ type: 'weak', text: 'Primera vez con el campeón' });
  else if (champMastery && champMastery.points < 20000) tags.push({ type: 'weak', text: 'Poca experiencia con el campeón' });
  if (champMastery && champMastery.points > 300000) tags.push({ type: 'strong', text: `Main (${Math.round(champMastery.points / 1000)}k puntos)` });
  if (p.games.length >= 8 && topCount / p.games.length >= 0.7) tags.push({ type: 'strong', text: `OTP de ${ddragon.champ(topChamp)?.name || '?'}` });
  if (recent.length >= 8 && wins / recent.length >= 0.75) tags.push({ type: 'strong', text: 'Racha de forma muy buena' });

  return {
    gameIds: p.ids || [],
    rank: p.rank,
    mainPos: mainPos || null,
    recent: recent.map((g) => ({ win: g.win, champ: ddragon.champView(g.champId)?.icon || null })),
    recentWinRate: recent.length ? wins / recent.length : null,
    kda,
    streak,
    champGames: onChamp.length,
    champWinRate: onChamp.length ? onChamp.filter((g) => g.win).length / onChamp.length : null,
    champMastery: champMastery ? { level: champMastery.level, points: champMastery.points } : null,
    topMastery: p.mastery.slice(0, 3).map((m) => ({ ...ddragon.champView(m.champId), points: m.points })),
    tags,
  };
}
