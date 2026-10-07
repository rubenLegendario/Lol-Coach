/**
 * Explorador del mapa de una partida: posiciones de los 10 jugadores minuto a minuto, todas las
 * kills, objetivos y estructuras con su posición, y un análisis de cada una de tus muertes
 * (dónde estaban tus aliados, cuántos rivales participaron, cómo ibais de oro).
 */
import { ddragon } from '../data/ddragon.js';
import { cached } from '../util/cache.js';
import { assignPositions } from '../util/positions.js';
import { toMapPercent, zoneOf } from '../util/mapzones.js';

const DRAGONS = { FIRE_DRAGON: 'Infernal', WATER_DRAGON: 'Océano', EARTH_DRAGON: 'Montaña', AIR_DRAGON: 'Nube', HEXTECH_DRAGON: 'Hextech', CHEMTECH_DRAGON: 'Quimtech', ELDER_DRAGON: 'Ancestral' };
const POS_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const NEAR = 2500; // unidades: a esta distancia un aliado puede ayudarte
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function gameMapData(lcu, gameId, puuid) {
  return cached(`gamemap_v3_${gameId}_${puuid}`, 365 * 24 * 3600_000, async () => {
    const game = await lcu.get(`/lol-match-history/v1/games/${gameId}`);
    const timeline = await lcu.get(`/lol-match-history/v1/game-timelines/${gameId}`).catch(() => null);
    if (!game || game.mapId !== 11) throw new Error('El mapa solo está disponible para partidas en la Grieta del Invocador');
    if (!timeline?.frames?.length) throw new Error('El cliente no tiene la línea temporal de esta partida');
    const ident = game.participantIdentities.find((i) => i.player.puuid === puuid);
    if (!ident) throw new Error('No apareces en esa partida');

    const myPid = ident.participantId;
    const me = game.participants.find((p) => p.participantId === myPid);
    const positions = assignPositions(game, timeline);
    const side = (p) => (p.teamId === me.teamId ? 'ally' : 'enemy');
    const byPid = new Map(game.participants.map((p) => [p.participantId, p]));
    const teamOf = (pid) => (byPid.get(pid) ? side(byPid.get(pid)) : null);

    const participants = game.participants.map((p) => {
      const i = game.participantIdentities.find((x) => x.participantId === p.participantId)?.player;
      return {
        pid: p.participantId,
        team: side(p),
        isMe: p.participantId === myPid,
        champ: ddragon.champView(p.championId),
        name: i?.gameName || '?',
        pos: positions.get(p.participantId) || null,
        posLabel: POS_ES[positions.get(p.participantId)] || '',
        puuid: i?.puuid || null,
        tag: i?.tagLine || '',
        stats: {
          k: p.stats.kills, d: p.stats.deaths, a: p.stats.assists,
          cs: (p.stats.totalMinionsKilled || 0) + (p.stats.neutralMinionsKilled || 0),
          dmg: p.stats.totalDamageDealtToChampions,
          gold: p.stats.goldEarned,
          vision: p.stats.visionScore,
          level: p.stats.champLevel,
          items: ddragon.statItems(p.stats),
          spells: [p.spell1Id, p.spell2Id].map((k) => ddragon.spellView(k)).filter(Boolean),
          keystone: ddragon.runeView(p.stats.perk0),
        },
      };
    }).sort((a, b) => (a.team === b.team ? ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].indexOf(a.pos) - ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].indexOf(b.pos) : a.team === 'ally' ? -1 : 1));

    // Fotos por minuto: posición (en % del minimapa), nivel, oro, CS
    const frames = timeline.frames.map((f, i) => {
      const players = {};
      for (const p of game.participants) {
        const pf = f.participantFrames?.[String(p.participantId)];
        if (!pf) continue;
        players[p.participantId] = {
          ...(pf.position ? toMapPercent(pf.position) : {}),
          level: pf.level,
          gold: pf.totalGold,
          cs: (pf.minionsKilled || 0) + (pf.jungleMinionsKilled || 0),
        };
      }
      const teamGold = (t) => game.participants.filter((p) => side(p) === t).reduce((s, p) => s + (f.participantFrames?.[String(p.participantId)]?.totalGold || 0), 0);
      return { min: i, players, goldDiff: teamGold('ally') - teamGold('enemy') };
    });

    // Posición real (coordenadas de juego) de un jugador en un instante, interpolando entre minutos
    const rawPos = (pid, tSec) => {
      const i = Math.min(timeline.frames.length - 1, Math.floor(tSec / 60));
      const a = timeline.frames[i]?.participantFrames?.[String(pid)]?.position;
      const b = timeline.frames[Math.min(timeline.frames.length - 1, i + 1)]?.participantFrames?.[String(pid)]?.position;
      if (!a) return null;
      if (!b) return a;
      const k = (tSec - i * 60) / 60;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };

    // Eventos con posición
    const events = [];
    for (const f of timeline.frames) {
      for (const e of f.events || []) {
        const t = Math.round(e.timestamp / 1000);
        if (!e.position) continue;
        const map = toMapPercent(e.position);
        if (e.type === 'CHAMPION_KILL') {
          events.push({
            t, time: fmt(t), type: 'kill', ...map, team: teamOf(e.killerId) || (teamOf(e.victimId) === 'ally' ? 'enemy' : 'ally'),
            killer: e.killerId || null, victim: e.victimId, assists: e.assistingParticipantIds || [],
            mine: e.killerId === myPid ? 'kill' : e.victimId === myPid ? 'death' : (e.assistingParticipantIds || []).includes(myPid) ? 'assist' : null,
          });
        } else if (e.type === 'ELITE_MONSTER_KILL') {
          const team = e.killerId ? teamOf(e.killerId) : e.killerTeamId === me.teamId ? 'ally' : 'enemy';
          const m = e.monsterType;
          const label = m === 'DRAGON' ? `Dragón ${DRAGONS[e.monsterSubType] || ''}`.trim() : m === 'BARON_NASHOR' ? 'Barón Nashor' : m === 'RIFTHERALD' ? 'Heraldo' : m === 'HORDE' ? 'Larva del Vacío' : m === 'ATAKHAN' ? 'Atakhan' : 'Objetivo';
          const type = m === 'DRAGON' ? (e.monsterSubType === 'ELDER_DRAGON' ? 'elder' : 'dragon') : m === 'BARON_NASHOR' || m === 'ATAKHAN' ? 'baron' : m === 'RIFTHERALD' ? 'herald' : 'grubs';
          events.push({ t, time: fmt(t), type, ...map, team, killer: e.killerId || null, label });
        } else if (e.type === 'BUILDING_KILL') {
          const inhib = e.buildingType === 'INHIBITOR_BUILDING';
          const lane = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' }[e.laneType] || '';
          events.push({ t, time: fmt(t), type: inhib ? 'inhib' : 'tower', ...map, team: e.teamId === me.teamId ? 'enemy' : 'ally', killer: e.killerId || null, label: `${inhib ? 'Inhibidor' : 'Torre'}${lane ? ' de ' + lane : ''}` });
        }
      }
    }

    // Análisis de cada una de tus muertes
    const allyPids = game.participants.filter((p) => side(p) === 'ally' && p.participantId !== myPid).map((p) => p.participantId);
    const deaths = events.filter((e) => e.mine === 'death').map((e, i) => {
      const myRaw = rawPos(myPid, e.t) || { x: 7500, y: 7500 };
      const dist = (pid) => {
        const p = rawPos(pid, e.t);
        return p ? Math.hypot(p.x - myRaw.x, p.y - myRaw.y) : Infinity;
      };
      const allyDists = allyPids.map((pid) => ({ pid, d: dist(pid) })).sort((a, b) => a.d - b.d);
      const near = allyDists.filter((a) => a.d <= NEAR);
      const enemiesInvolved = [e.killer, ...e.assists].filter((pid) => teamOf(pid) === 'enemy');
      const goldDiff = frames[Math.min(frames.length - 1, Math.round(e.t / 60))]?.goldDiff ?? 0;
      const zone = zoneOf(myRaw, me.teamId);
      const insights = [];
      if (!near.length) insights.push({ type: 'bad', text: `Moriste sin ayuda: el aliado más cercano (${byPid.get(allyDists[0]?.pid) ? ddragon.champ(byPid.get(allyDists[0].pid).championId)?.name : '?'}) estaba lejos` });
      else insights.push({ type: 'info', text: `Tenías ${near.length} aliado${near.length > 1 ? 's' : ''} cerca: ${near.map((a) => ddragon.champ(byPid.get(a.pid).championId)?.name).join(', ')}` });
      if (enemiesInvolved.length > near.length + 1) insights.push({ type: 'bad', text: `Te pillaron ${enemiesInvolved.length} rivales con ${near.length ? 'solo ' + near.length + ' aliado' + (near.length > 1 ? 's' : '') : 'nadie'} cerca: pelea en inferioridad numérica` });
      else if (enemiesInvolved.length >= 3) insights.push({ type: 'warn', text: `Pelea grande: participaron ${enemiesInvolved.length} rivales` });
      else if (enemiesInvolved.length === 1) insights.push({ type: 'warn', text: 'Perdiste un 1 contra 1' });
      if (goldDiff <= -1500) insights.push({ type: 'bad', text: `Tu equipo iba ${(goldDiff / 1000).toFixed(1)}k de oro por detrás: no era momento de arriesgar` });
      if (zone === 'Jungla enemiga' || zone === 'Base enemiga') insights.push({ type: 'bad', text: 'Estabas en territorio enemigo' });
      if (zone.startsWith('Río')) insights.push({ type: 'warn', text: 'En el río: zona de ganks y peleas por objetivos' });
      const nextObj = events.find((x) => x.t > e.t && x.t - e.t <= 60 && x.team === 'enemy' && ['dragon', 'baron', 'herald', 'elder', 'tower', 'inhib'].includes(x.type));
      if (nextObj) insights.push({ type: 'bad', text: `Tras tu muerte el rival consiguió: ${nextObj.label.toLowerCase()} (${nextObj.time})` });
      return { n: i + 1, t: e.t, time: e.time, left: e.left, top: e.top, zone, killer: e.killer, assists: e.assists, enemies: enemiesInvolved.length, alliesNear: near.length, goldDiff, insights };
    });

    // Tu recorrido (posición por minuto)
    const path = frames.map((f) => f.players[myPid]).filter((p) => p?.left != null).map((p) => ({ left: p.left, top: p.top }));

    return { gameId, duration: Math.ceil(game.gameDuration / 60), myPid, participants, frames, events, deaths, path };
  });
}
