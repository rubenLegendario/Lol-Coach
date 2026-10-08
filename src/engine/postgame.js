/**
 * Análisis post-partida al estilo del "AI Coach" de iTero: nota por fases, comparación con tu rival
 * de línea y con tu propia media, y las 3 cosas concretas que más te costaron la partida.
 * Fuente: historial del cliente (estadísticas completas + línea temporal minuto a minuto).
 */
import { ddragon } from '../data/ddragon.js';
import { cached } from '../util/cache.js';
import { assignPositions, roughPosition } from '../util/positions.js';
import { toMapPercent, zoneOf } from '../util/mapzones.js';
import { recordMatchup, recordTrend } from '../store.js';
import { computeBadges, mvpRanking } from './badges.js';
import { champProfile } from '../data/champinfo.js';
import { coachFor, coachInfo, reviewGame } from './coach/index.js';
import { fightDeaths, objectiveParticipation, earlyRoams } from './coach/common.js';

const QUEUES = {
  420: 'Clasificatoria Solo/Dúo', 440: 'Clasificatoria Flexible', 400: 'Normal (reclutamiento)', 430: 'Normal (a ciegas)',
  490: 'Partida rápida', 450: 'ARAM', 2400: 'ARAM: Caos', 1700: 'Arena', 1900: 'URF', 900: 'URF',
};
const RANKED = new Set([420, 440]);

// Las referencias por rol (CS/min, visión, KP, daño…) y los consejos están en ./coach/ (un coach por rol)
const POS_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

const grade = (s) => (s == null ? null : s >= 85 ? 'S' : s >= 70 ? 'A' : s >= 55 ? 'B' : s >= 40 ? 'C' : 'D');
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const fmtMin = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function queueName(id) {
  return QUEUES[id] || 'Partida';
}

/** Lista de tus últimas partidas para la pestaña "Mis partidas". */
export async function listGames(lcu, puuid) {
  const res = await lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`);
  return (res?.games?.games || []).map((g) => {
    const p = g.participants?.[0] || {};
    const s = p.stats || {};
    return {
      gameId: g.gameId,
      queue: queueName(g.queueId),
      ranked: RANKED.has(g.queueId),
      champ: ddragon.champView(p.championId),
      win: !!s.win,
      remake: g.gameDuration < 300,
      kda: `${s.kills}/${s.deaths}/${s.assists}`,
      cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
      duration: Math.round(g.gameDuration / 60),
      date: g.gameCreation,
    };
  });
}

/** Tu media en las últimas partidas (para comparar contigo mismo). */
async function personalBaseline(lcu, puuid, excludeId) {
  const res = await lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`).catch(() => null);
  const games = (res?.games?.games || []).filter((g) => g.gameId !== excludeId && g.mapId === 11 && g.gameDuration > 900);
  if (games.length < 3) return null;
  const v = games.map((g) => {
    const s = g.participants[0].stats;
    const min = g.gameDuration / 60;
    return { deaths: s.deaths, csMin: (s.totalMinionsKilled + s.neutralMinionsKilled) / min, visionMin: s.visionScore / min };
  });
  const avg = (k) => v.reduce((s, x) => s + x[k], 0) / v.length;
  return { games: v.length, deaths: avg('deaths'), csMin: avg('csMin'), visionMin: avg('visionMin') };
}

/**
 * other: el jugador no es el usuario (logros en tercera persona). Va en la clave de la caché ("_o") porque
 * el texto cambia; las de tu cuenta conservan la clave de siempre para no repetir los análisis ya hechos.
 */
export async function analyzeGame(lcu, gameId, puuid, { record = true, other = false } = {}) {
  const a = await cached(`postgame_v8_${gameId}_${puuid}${other ? '_o' : ''}`, 365 * 24 * 3600_000, () => doAnalyze(lcu, gameId, puuid, { other }));
  if (record) {
    recordMatchup(puuid, a); // tu historial de enfrentamientos crece con cada partida analizada
    recordTrend(puuid, a);
  }
  return a;
}

/** Resumen de los 10 jugadores de la partida (para la tabla y para cambiar de punto de vista). */
function playersOf(game, positions, me) {
  const team = (p) => (p.teamId === me.teamId ? 'ally' : 'enemy');
  const teamDmg = (t) => game.participants.filter((p) => team(p) === t).reduce((s, p) => s + p.stats.totalDamageDealtToChampions, 0) || 1;
  const teamKills = (t) => game.participants.filter((p) => team(p) === t).reduce((s, p) => s + p.stats.kills, 0) || 1;
  const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ranking = game.participants.length === 10 ? mvpRanking(game) : new Map();
  return game.participants.map((p) => {
    const r = ranking.get(p.participantId);
    const i = game.participantIdentities.find((x) => x.participantId === p.participantId)?.player || {};
    const s = p.stats;
    const t = team(p);
    return {
      puuid: i.puuid || null,
      name: i.gameName || '?',
      tag: i.tagLine || '',
      self: p.participantId === me.participantId,
      team: t,
      champ: ddragon.champView(p.championId),
      pos: positions.get(p.participantId) || null,
      level: s.champLevel,
      k: s.kills, d: s.deaths, a: s.assists,
      kda: Math.round(((s.kills + s.assists) / Math.max(1, s.deaths)) * 10) / 10,
      kp: Math.round(((s.kills + s.assists) / teamKills(t)) * 100),
      cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
      dmg: s.totalDamageDealtToChampions,
      dmgShare: Math.round((s.totalDamageDealtToChampions / teamDmg(t)) * 100),
      gold: s.goldEarned,
      vision: s.visionScore,
      items: ddragon.statItems(s),
      spells: [p.spell1Id, p.spell2Id].map((k) => ddragon.spellView(k)).filter(Boolean),
      keystone: ddragon.runeView(s.perk0),
      rank: r?.rank ?? null,
      mvp: !!r?.mvp,
      ace: !!r?.ace,
    };
  }).sort((a, b) => (a.team === b.team ? order.indexOf(a.pos) - order.indexOf(b.pos) : a.team === 'ally' ? -1 : 1));
}

const DRAGONS = { FIRE_DRAGON: 'Infernal', WATER_DRAGON: 'Océano', EARTH_DRAGON: 'Montaña', AIR_DRAGON: 'Nube', HEXTECH_DRAGON: 'Hextech', CHEMTECH_DRAGON: 'Quimtech', ELDER_DRAGON: 'Ancestral' };

/** Momentos clave de la partida (tus kills/muertes, primera sangre, objetivos y estructuras). */
function keyMoments(events, game, pid, me, allyIds) {
  const champOf = (id) => ddragon.champView(game.participants.find((p) => p.participantId === id)?.championId);
  const out = [];
  let firstBlood = true;
  for (const e of events) {
    const t = Math.round(e.timestamp / 1000);
    if (e.type === 'CHAMPION_KILL') {
      if (firstBlood && e.killerId) {
        firstBlood = false;
        const ally = allyIds.has(e.killerId);
        out.push({ t, type: 'firstblood', team: ally ? 'ally' : 'enemy', label: `Primera sangre para ${ally ? 'tu equipo' : 'el rival'}`, champ: champOf(e.killerId) });
      }
      if (e.killerId === pid) out.push({ t, type: 'kill', team: 'ally', label: `Matas a ${champOf(e.victimId)?.name || '?'}`, champ: champOf(e.victimId) });
      else if (e.victimId === pid) out.push({ t, type: 'death', team: 'enemy', label: `Te mata ${champOf(e.killerId)?.name || '?'}`, champ: champOf(e.killerId) });
      else if ((e.assistingParticipantIds || []).includes(pid)) out.push({ t, type: 'assist', team: 'ally', label: `Asistencia contra ${champOf(e.victimId)?.name || '?'}`, champ: champOf(e.victimId), minor: true });
    } else if (e.type === 'ELITE_MONSTER_KILL') {
      const ally = e.killerId ? allyIds.has(e.killerId) : e.killerTeamId === me.teamId;
      const who = ally ? 'Tu equipo' : 'El rival';
      const m = e.monsterType;
      if (m === 'DRAGON') {
        const name = DRAGONS[e.monsterSubType] || 'Dragón';
        out.push({ t, type: name === 'Ancestral' ? 'elder' : 'dragon', team: ally ? 'ally' : 'enemy', label: `${who} mata al dragón ${name === 'Ancestral' ? 'ancestral' : name}` });
      } else if (m === 'BARON_NASHOR') out.push({ t, type: 'baron', team: ally ? 'ally' : 'enemy', label: `${who} mata al Barón` });
      else if (m === 'RIFTHERALD') out.push({ t, type: 'herald', team: ally ? 'ally' : 'enemy', label: `${who} mata al Heraldo` });
      else if (m === 'HORDE') out.push({ t, type: 'grubs', team: ally ? 'ally' : 'enemy', label: `${who} mata una larva`, minor: true });
      else if (m === 'ATAKHAN') out.push({ t, type: 'baron', team: ally ? 'ally' : 'enemy', label: `${who} mata a Atakhan` });
    } else if (e.type === 'BUILDING_KILL') {
      // teamId es el dueño del edificio destruido
      const ally = e.teamId !== me.teamId;
      const inhib = e.buildingType === 'INHIBITOR_BUILDING';
      const lane = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' }[e.laneType] || '';
      out.push({ t, type: inhib ? 'inhib' : 'tower', team: ally ? 'ally' : 'enemy', label: `${ally ? 'Tu equipo destruye' : 'El rival destruye'} ${inhib ? 'un inhibidor' : 'una torre'}${lane ? ' de ' + lane : ''}`, minor: !inhib });
    }
  }
  return out;
}

/** El tramo de 3 minutos con el mayor cambio de oro entre equipos, y qué pasó en él. */
function decisiveMoment(goldChart, moments) {
  let best = null;
  for (let i = 3; i < goldChart.length; i++) {
    const delta = goldChart[i].team - goldChart[i - 3].team;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { from: i - 3, to: i, delta };
  }
  if (!best || Math.abs(best.delta) < 1500) return null;
  const inWindow = moments.filter((m) => m.t >= best.from * 60 - 30 && m.t <= best.to * 60 + 30 && !m.minor && m.type !== 'assist');
  const causes = [...new Set(inWindow.map((m) => m.label))].slice(0, 4);
  return {
    from: best.from,
    to: best.to,
    delta: best.delta,
    text: `Entre el minuto ${best.from} y el ${best.to} ${best.delta > 0 ? 'tu equipo ganó' : 'tu equipo perdió'} ${(Math.abs(best.delta) / 1000).toFixed(1)}k de oro de diferencia${causes.length ? ': ' + causes.map((c) => c[0].toLowerCase() + c.slice(1)).join(', ') + '.' : '.'}`,
  };
}

async function doAnalyze(lcu, gameId, puuid, { other = false } = {}) {
  const game = await lcu.get(`/lol-match-history/v1/games/${gameId}`);
  if (!game) throw new Error('Partida no encontrada');
  const timeline = await lcu.get(`/lol-match-history/v1/game-timelines/${gameId}`).catch(() => null);
  const ident = game.participantIdentities.find((i) => i.player.puuid === puuid);
  if (!ident) throw new Error('No apareces en esa partida');
  const pid = ident.participantId;
  const me = game.participants.find((p) => p.participantId === pid);
  const isSR = game.mapId === 11;
  const min = game.gameDuration / 60;
  const positions = isSR ? assignPositions(game, timeline) : new Map();
  const myPos = positions.get(pid) || (isSR ? roughPosition(me) : null);
  const allies = game.participants.filter((p) => p.teamId === me.teamId);
  const enemies = game.participants.filter((p) => p.teamId !== me.teamId);
  const opp = myPos ? enemies.find((p) => positions.get(p.participantId) === myPos) : null;
  const nameOf = (p) => {
    const i = game.participantIdentities.find((x) => x.participantId === p.participantId)?.player;
    return i?.gameName ? `${i.gameName}#${i.tagLine}` : '?';
  };

  const s = me.stats;
  const sum = (list, f) => list.reduce((a, p) => a + f(p.stats), 0);
  const teamKills = sum(allies, (x) => x.kills);
  const cs = (st) => (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0);
  const m = {
    kills: s.kills, deaths: s.deaths, assists: s.assists,
    kda: (s.kills + s.assists) / Math.max(1, s.deaths),
    kp: teamKills ? (s.kills + s.assists) / teamKills : 0,
    cs: cs(s), csMin: cs(s) / min,
    goldMin: s.goldEarned / min,
    dmg: s.totalDamageDealtToChampions,
    dmgShare: s.totalDamageDealtToChampions / Math.max(1, sum(allies, (x) => x.totalDamageDealtToChampions)),
    takenShare: s.totalDamageTaken / Math.max(1, sum(allies, (x) => x.totalDamageTaken)),
    visionMin: s.visionScore / min,
    controlWards: s.visionWardsBoughtInGame,
    wardsPlaced: s.wardsPlaced,
    wardsKilled: s.wardsKilled || 0,
    trinket: s.item6 || null,
    turretDmg: s.damageDealtToTurrets || 0,
    objDmg: s.damageDealtToObjectives,
  };

  // ---- Línea temporal: fase de líneas, muertes y gráfica de oro ----
  const frames = timeline?.frames || [];
  const pf = (i, id) => frames[Math.min(i, frames.length - 1)]?.participantFrames?.[String(id)];
  const at = (i, id) => {
    const f = pf(i, id);
    return f ? { gold: f.totalGold, cs: f.minionsKilled + f.jungleMinionsKilled, xp: f.xp, level: f.level } : null;
  };
  const lane = {};
  for (const t of [10, 14]) {
    if (frames.length > t) {
      const a = at(t, pid);
      const b = opp ? at(t, opp.participantId) : null;
      lane[t] = { cs: a.cs, gold: a.gold, csDiff: b ? a.cs - b.cs : null, goldDiff: b ? a.gold - b.gold : null, xpDiff: b ? a.xp - b.xp : null };
    }
  }
  const teamGold = (i, team) => team.reduce((acc, p) => acc + (pf(i, p.participantId)?.totalGold || 0), 0);
  const goldChart = frames.map((_, i) => ({
    min: i,
    team: teamGold(i, allies) - teamGold(i, enemies),
    lane: opp ? (pf(i, pid)?.totalGold || 0) - (pf(i, opp.participantId)?.totalGold || 0) : null,
  }));

  const events = frames.flatMap((f) => f.events || []);
  const enemyJungler = enemies.find((p) => positions.get(p.participantId) === 'JUNGLE')?.participantId;
  const enemyIds = new Set(enemies.map((p) => p.participantId));
  const allyIds = new Set(allies.map((p) => p.participantId));
  const fights = fightDeaths(events.filter((e) => e.type === 'CHAMPION_KILL'), pid, allyIds);
  const deaths = events.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === pid).map((e) => {
    const involved = [e.killerId, ...(e.assistingParticipantIds || [])];
    const { x, y } = e.position || { x: 7500, y: 7500 };
    const enemySide = me.teamId === 100 ? x + y > 15500 : x + y < 14000;
    const killer = game.participants.find((p) => p.participantId === e.killerId);
    return {
      time: e.timestamp,
      gank: myPos !== 'JUNGLE' && e.timestamp < 15 * 60000 && enemyJungler != null && involved.includes(enemyJungler),
      enemySide,
      by: involved.filter((id) => enemyIds.has(id)).length,
      fight: !!fights.get(e.timestamp)?.fight,
      first: !!fights.get(e.timestamp)?.first,
      x,
      y,
      killer: killer ? ddragon.champView(killer.championId) : null,
    };
  });
  const earlyDeaths = deaths.filter((d) => d.time < 14 * 60000);

  // Participación por fases
  const phaseOf = (ms) => (ms < 14 * 60000 ? 'early' : ms < 25 * 60000 ? 'mid' : 'late');
  const phase = { early: { tk: 0, mine: 0, deaths: 0 }, mid: { tk: 0, mine: 0, deaths: 0 }, late: { tk: 0, mine: 0, deaths: 0 } };
  for (const e of events.filter((x) => x.type === 'CHAMPION_KILL')) {
    const ph = phase[phaseOf(e.timestamp)];
    if (allyIds.has(e.killerId)) {
      ph.tk++;
      if (e.killerId === pid || (e.assistingParticipantIds || []).includes(pid)) ph.mine++;
    }
    if (e.victimId === pid) ph.deaths++;
  }

  // ---- Notas por fase (con las referencias del coach de tu rol) ----
  const coach = coachFor(myPos, { aram: !isSR });
  const t = (k) => coach.targets[k] ?? null;
  const scores = {};
  if (isSR && frames.length > 14) {
    let e = 55;
    if (lane[14]?.goldDiff != null) e += lane[14].goldDiff / 40;
    if (lane[14]?.csDiff != null && myPos !== 'UTILITY') e += lane[14].csDiff * 0.8;
    else if (t('cs10') && lane[10]) e += (lane[10].cs - t('cs10')) * 0.6;
    e -= earlyDeaths.length * 9;
    e += phase.early.tk ? (phase.early.mine / phase.early.tk - 0.4) * 30 : 0;
    scores.early = clamp(e);
  }
  for (const k of ['mid', 'late']) {
    const ph = phase[k];
    if ((k === 'mid' && min < 16) || (k === 'late' && min < 27)) continue;
    let sc = 55 + (ph.tk ? (ph.mine / ph.tk - 0.5) * 60 : 0) - ph.deaths * 7 + ph.mine * 1.5;
    scores[k] = clamp(sc);
  }
  let overall = 50 + (m.kda - 2.5) * 6 + (m.kp - (t('kp') || 0.5)) * 60 + (m.dmgShare - (t('dmgShare') || 0.2)) * 80;
  if (t('csMin')) overall += (m.csMin - t('csMin')) * 4;
  if (t('visionMin')) overall += (m.visionMin - t('visionMin')) * 8;
  scores.overall = clamp(overall);

  // ---- Las 3 cosas a mejorar, lo que hiciste bien y sugerencias: las decide el coach de tu rol ----
  const base = isSR ? await personalBaseline(lcu, puuid, gameId) : null;
  const team = game.teams.find((x) => x.teamId === me.teamId);
  const enemyTeam = game.teams.find((x) => x.teamId !== me.teamId);
  const objectives = team && enemyTeam ? {
    ally: { dragons: team.dragonKills, barons: team.baronKills, towers: team.towerKills, grubs: team.hordeKills, heralds: team.riftHeraldKills },
    enemy: { dragons: enemyTeam.dragonKills, barons: enemyTeam.baronKills, towers: enemyTeam.towerKills, grubs: enemyTeam.hordeKills, heralds: enemyTeam.riftHeraldKills },
  } : null;
  const teamTurretDmg = sum(allies, (x) => x.damageDealtToTurrets || 0);
  const review = reviewGame(coach, {
    sr: isSR, min, pos: myPos, m, lane, base, phase, deaths, earlyDeaths,
    oppName: opp ? ddragon.champ(opp.championId)?.name || null : null,
    objectives,
    objParticipation: isSR && frames.length ? objectiveParticipation(events, pid, allyIds) : null,
    roams: isSR ? earlyRoams(events, pid, myPos, me.teamId) : 0,
    turretShare: teamTurretDmg ? m.turretDmg / teamTurretDmg : null,
    tank: !!champProfile(me.championId)?.tank,
  });

  const moments = isSR ? keyMoments(events, game, pid, me, allyIds) : [];

  return {
    gameId,
    queue: queueName(game.queueId),
    ranked: RANKED.has(game.queueId),
    sr: isSR,
    win: team?.win === 'Win',
    duration: Math.round(min),
    date: game.gameCreation,
    champ: ddragon.champView(me.championId),
    pos: myPos,
    posLabel: POS_ES[myPos] || null,
    coach: coachInfo(coach),
    opp: opp ? { champ: ddragon.champView(opp.championId), name: nameOf(opp) } : null,
    viewer: { puuid, name: ident.player.gameName || '?', tag: ident.player.tagLine || '' },
    players: isSR ? playersOf(game, positions, me) : playersOf(game, new Map(), me),
    stats: {
      kda: `${m.kills}/${m.deaths}/${m.assists}`,
      kdaRatio: Math.round(m.kda * 100) / 100,
      kp: Math.round(m.kp * 100),
      csMin: Math.round(m.csMin * 10) / 10,
      dmgShare: Math.round(m.dmgShare * 100),
      visionMin: Math.round(m.visionMin * 100) / 100,
      controlWards: m.controlWards,
      goldMin: Math.round(m.goldMin),
    },
    targets: { csMin: t('csMin'), visionMin: t('visionMin'), kp: t('kp') != null ? Math.round(t('kp') * 100) : null, dmgShare: t('dmgShare') != null ? Math.round(t('dmgShare') * 100) : null, controlWards: isSR ? coach.controlWardTarget(min) : null },
    baseline: base && { deaths: Math.round(base.deaths * 10) / 10, csMin: Math.round(base.csMin * 10) / 10, visionMin: Math.round(base.visionMin * 100) / 100, games: base.games },
    lane: lane[14] ? { at10: lane[10] || null, at14: lane[14] } : null,
    grades: {
      early: scores.early != null ? { score: scores.early, grade: grade(scores.early) } : null,
      mid: scores.mid != null ? { score: scores.mid, grade: grade(scores.mid) } : null,
      late: scores.late != null ? { score: scores.late, grade: grade(scores.late) } : null,
      overall: { score: scores.overall, grade: grade(scores.overall) },
    },
    badges: computeBadges(game, pid, { sr: isSR, minutes: min, events, goldChart, lane14: lane[14] || null, csTarget: t('csMin'), pos: myPos, other }),
    improve: review.improve,
    strengths: review.strengths,
    suggestions: review.suggestions,
    deaths: deaths.map((d) => ({
      time: fmtMin(d.time),
      minute: Math.floor(d.time / 60000),
      gank: d.gank,
      enemySide: d.enemySide,
      by: d.by,
      killer: d.killer,
      zone: isSR ? zoneOf(d, me.teamId) : null,
      map: isSR ? toMapPercent(d) : null,
    })),
    goldChart,
    moments,
    decisive: decisiveMoment(goldChart, moments),
    objectives,
  };
}

/**
 * Resumen de una partida para las filas del historial (al estilo de Blitz): los 10 jugadores,
 * runas, oro por minuto y logros. Las partidas terminadas no cambian, así que se guarda un año.
 */
export async function gameSummary(lcu, gameId, puuid, { other = false } = {}) {
  // other: partida de otro jugador (logros en tercera persona; clave de caché aparte)
  return cached(`gsum_v2_${gameId}_${puuid}${other ? '_o' : ''}`, 365 * 24 * 3600_000, async () => {
    const game = await lcu.get(`/lol-match-history/v1/games/${gameId}`);
    const ident = game?.participantIdentities?.find((i) => i.player.puuid === puuid);
    if (!ident) throw new Error('Partida no disponible'); // sin guardar: puede ser un fallo pasajero del cliente
    const pid = ident.participantId;
    const me = game.participants.find((p) => p.participantId === pid);
    const isSR = game.mapId === 11;
    const min = game.gameDuration / 60;
    // La línea temporal solo hace falta para los logros que dependen del tiempo (remontada, dominio de línea, remates)
    const timeline = isSR && game.gameDuration >= 300 ? await lcu.get(`/lol-match-history/v1/game-timelines/${gameId}`).catch(() => null) : null;
    const positions = isSR ? assignPositions(game, timeline) : new Map();
    const myPos = positions.get(pid) || (isSR ? roughPosition(me) : null);
    const frames = timeline?.frames || [];
    const gold = (i, id) => frames[i]?.participantFrames?.[String(id)]?.totalGold || 0;
    const allies = game.participants.filter((p) => p.teamId === me.teamId);
    const enemies = game.participants.filter((p) => p.teamId !== me.teamId);
    const goldChart = frames.map((_, i) => ({ team: allies.reduce((a, p) => a + gold(i, p.participantId), 0) - enemies.reduce((a, p) => a + gold(i, p.participantId), 0) }));
    const opp = myPos ? enemies.find((p) => positions.get(p.participantId) === myPos) : null;
    const lane14 = opp && frames.length > 14 ? { goldDiff: gold(14, pid) - gold(14, opp.participantId) } : null;
    const events = frames.flatMap((f) => f.events || []);
    const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    const players = game.participants.map((p) => {
      const i = game.participantIdentities.find((x) => x.participantId === p.participantId)?.player || {};
      return { name: i.gameName || '?', tag: i.tagLine || '', puuid: i.puuid || null, self: p.participantId === pid, team: p.teamId === me.teamId ? 'ally' : 'enemy', pos: positions.get(p.participantId) || null, champ: ddragon.champView(p.championId) };
    }).sort((a, b) => (a.team === b.team ? order.indexOf(a.pos) - order.indexOf(b.pos) : a.team === 'ally' ? -1 : 1));
    return {
      gameId,
      pos: myPos,
      keystone: ddragon.runeView(me.stats.perk0),
      subStyle: ddragon.runeView(me.stats.perkSubStyle),
      goldMin: Math.round(me.stats.goldEarned / Math.max(1, min)),
      players,
      badges: game.gameDuration >= 300 ? computeBadges(game, pid, { sr: isSR, minutes: min, events, goldChart, lane14, csTarget: isSR ? coachFor(myPos).targets.csMin : null, pos: myPos, other }) : [],
    };
  });
}
