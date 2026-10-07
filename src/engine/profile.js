/**
 * Pantalla de inicio al estilo del perfil de iTero: rango, resumen de las últimas partidas,
 * campeones y roles más jugados, partidas recientes y "tu coach" (hábitos que se repiten).
 */
import { ddragon } from '../data/ddragon.js';
import { cached } from '../util/cache.js';
import { roughPosition } from '../util/positions.js';
import { analyzeGame, queueName } from './postgame.js';
import { trendRow } from '../store.js';

const RANKED = new Set([420, 440]);
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};
const POS_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const gradeOf = (x) => (x >= 85 ? 'S' : x >= 70 ? 'A' : x >= 55 ? 'B' : x >= 40 ? 'C' : 'D');
const r1 = (x) => Math.round(x * 10) / 10;

function rankEntry(e, label) {
  if (!e || !e.tier || e.tier === 'NONE') return { queue: label, tier: null, text: 'Sin clasificar' };
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier);
  const games = e.wins + e.losses;
  const prev = e.previousSeasonEndTier && e.previousSeasonEndTier !== 'NONE' ? `${TIER_ES[e.previousSeasonEndTier] || e.previousSeasonEndTier} ${e.previousSeasonEndDivision || ''}`.trim() : null;
  return {
    queue: label,
    tier: e.tier,
    division: e.division,
    text: `${TIER_ES[e.tier] || e.tier}${apex ? '' : ' ' + e.division}`,
    lp: e.leaguePoints,
    wins: e.wins,
    losses: e.losses,
    winRate: games ? Math.round((e.wins / games) * 1000) / 10 : null,
    previous: prev,
  };
}

function gameRow(g) {
  const p = g.participants?.[0] || {};
  const s = p.stats || {};
  const min = Math.max(1, g.gameDuration / 60);
  const cs = (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0);
  return {
    gameId: g.gameId,
    queue: queueName(g.queueId),
    queueId: g.queueId,
    ranked: RANKED.has(g.queueId),
    sr: g.mapId === 11,
    remake: g.gameDuration < 300,
    win: !!s.win,
    champId: p.championId,
    champ: ddragon.champView(p.championId),
    pos: g.mapId === 11 ? roughPosition(p) : null,
    k: s.kills, d: s.deaths, a: s.assists,
    kda: `${s.kills}/${s.deaths}/${s.assists}`,
    kdaRatio: r1((s.kills + s.assists) / Math.max(1, s.deaths)),
    cs,
    csMin: r1(cs / min),
    visionMin: Math.round(((s.visionScore || 0) / min) * 100) / 100,
    dmgMin: Math.round((s.totalDamageDealtToChampions || 0) / min),
    goldMin: Math.round((s.goldEarned || 0) / min),
    items: ddragon.statItems(s),
    slots: ddragon.statSlots(s),
    gold: s.goldEarned || 0,
    secs: g.gameDuration,
    spells: [p.spell1Id, p.spell2Id].map((k) => ddragon.spellView(k)).filter(Boolean),
    duration: Math.round(min),
    date: g.gameCreation,
  };
}

/** Filtros de cola del perfil. "auto": clasificatorias si hay suficientes; si no, todas las de la Grieta. */
export const QUEUE_FILTERS = {
  auto: { label: 'Auto', ids: null },
  all: { label: 'Todas', ids: null },
  ranked: { label: 'Clasificatorias', ids: [420, 440] },
  solo: { label: 'Solo/Dúo', ids: [420] },
  flex: { label: 'Flexible', ids: [440] },
  normal: { label: 'Normales', ids: [400, 430, 480, 490] },
  aram: { label: 'ARAM', ids: [450, 100, 720, 2400] },
};

/**
 * archive(rows): para tu cuenta, mezcla las 20 partidas del cliente con las que se han ido guardando
 * (el cliente no da más de 20), así los filtros tienen más muestra con el tiempo.
 */
/**
 * El historial de Riot tarda en actualizarse (a veces horas para otros jugadores), pero cada partida suelta
 * sí se puede descargar. extraGameIds: partidas que sabemos que existen (p. ej. la última de un amigo) y que
 * se añaden si aún no están en la lista.
 */
async function extraGames(lcu, puuid, ids, have) {
  const out = [];
  for (const id of ids || []) {
    if (!id || have.has(id)) continue;
    const g = await lcu.get(`/lol-match-history/v1/games/${id}`).catch(() => null);
    const pid = g?.participantIdentities?.find((x) => x.player?.puuid === puuid)?.participantId;
    const part = pid && g.participants?.find((p) => p.participantId === pid);
    if (part) out.push(gameRow({ ...g, participants: [part] }));
  }
  return out;
}

export async function buildProfile(lcu, puuid, { queue = 'auto', champ = null, archive = null, extraGameIds = null } = {}) {
  const [stats, history] = await Promise.all([
    lcu.get(`/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => null),
    lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`).catch(() => null),
  ]);
  let games = (history?.games?.games || []).map(gameRow);
  if (extraGameIds?.length) {
    const extra = await extraGames(lcu, puuid, extraGameIds, new Set(games.map((g) => g.gameId)));
    if (extra.length) games = [...extra, ...games].sort((a, b) => b.date - a.date);
  }
  if (archive) games = archive(games);
  const valid = games.filter((g) => !g.remake);
  if (!QUEUE_FILTERS[queue]) queue = 'auto';
  const qf = QUEUE_FILTERS[queue];
  const inQueue = (g) => !qf.ids || qf.ids.includes(g.queueId);
  // Auto: como siempre, sobre las 20 últimas (clasificatorias si hay suficientes; si no, la Grieta)
  const last20 = valid.filter((g) => games.indexOf(g) < 20);
  const rankedSR = last20.filter((g) => g.ranked && g.sr);
  const base = queue === 'auto' ? (rankedSR.length >= 5 ? rankedSR : last20.filter((g) => g.sr)) : valid.filter(inQueue);
  const champCount = {};
  for (const g of base) champCount[g.champId] = (champCount[g.champId] || 0) + 1;
  const champOptions = Object.entries(champCount).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ ...ddragon.champView(Number(id)), games: n })).filter((c) => c.key);
  champ = champ && champCount[champ] ? Number(champ) : null;
  const sample = champ ? base.filter((g) => g.champId === champ) : base;
  const filtered = queue !== 'auto' || !!champ;
  const recentList = filtered ? games.filter((g) => (queue === 'auto' || inQueue(g)) && (!champ || g.champId === champ)) : games.slice(0, 20);
  const avg = (f, list = sample) => (list.length ? list.reduce((s, g) => s + f(g), 0) / list.length : null);
  const wins = sample.filter((g) => g.win).length;

  const byChamp = new Map();
  for (const g of sample) {
    const c = byChamp.get(g.champId) || { champ: g.champ, games: 0, wins: 0, k: 0, d: 0, a: 0, csMin: 0 };
    c.games++;
    c.wins += g.win ? 1 : 0;
    c.k += g.k; c.d += g.d; c.a += g.a;
    c.csMin += g.csMin;
    byChamp.set(g.champId, c);
  }
  const champions = [...byChamp.values()].sort((a, b) => b.games - a.games).slice(0, 5).map((c) => ({
    champ: c.champ,
    games: c.games,
    winRate: Math.round((c.wins / c.games) * 100),
    kda: `${r1(c.k / c.games)}/${r1(c.d / c.games)}/${r1(c.a / c.games)}`,
    kdaRatio: r1((c.k + c.a) / Math.max(1, c.d)),
    csMin: r1(c.csMin / c.games),
  }));

  const posCount = {};
  for (const g of sample) if (g.pos) posCount[g.pos] = (posCount[g.pos] || 0) + 1;
  const roles = Object.entries(posCount).sort((a, b) => b[1] - a[1]).map(([pos, n]) => ({ pos, label: POS_ES[pos], games: n, pct: Math.round((n / sample.length) * 100) }));

  let streak = 0;
  for (const g of valid) {
    if (g.win === valid[0].win) streak++;
    else break;
  }

  return {
    ranks: [rankEntry(stats?.queueMap?.RANKED_SOLO_5x5, 'Solo/Dúo'), rankEntry(stats?.queueMap?.RANKED_FLEX_SR, 'Flexible')],
    summary: sample.length ? {
      label: filtered
        ? `${queue === 'auto' ? 'Últimas' : qf.label}${champ ? ' con ' + (ddragon.champ(champ)?.name || '') : ''} · ${sample.length} partida${sample.length === 1 ? '' : 's'}`
        : rankedSR.length >= 5 ? `Últimas ${sample.length} clasificatorias` : `Últimas ${sample.length} partidas en la Grieta`,
      games: sample.length,
      wins,
      losses: sample.length - wins,
      winRate: Math.round((wins / sample.length) * 100),
      kda: `${r1(avg((g) => g.k))}/${r1(avg((g) => g.d))}/${r1(avg((g) => g.a))}`,
      kdaRatio: r1(avg((g) => g.k + g.a) / Math.max(0.1, avg((g) => g.d))),
      csMin: r1(avg((g) => g.csMin)),
      visionMin: Math.round(avg((g) => g.visionMin) * 100) / 100,
      dmgMin: Math.round(avg((g) => g.dmgMin)),
      goldMin: Math.round(avg((g) => g.goldMin)),
      form: sample.slice(0, 10).map((g) => g.win),
    } : null,
    streak: valid.length ? (valid[0].win ? streak : -streak) : 0,
    champions,
    roles,
    recent: recentList.slice(0, 40),
    recentAll: games.slice(0, 20), // sin filtrar (para la sesión de hoy)
    filter: {
      queue,
      champ,
      champOptions,
      queues: Object.fromEntries(Object.entries(QUEUE_FILTERS).map(([k, v]) => [k, v.label])),
      totalGames: valid.length,
    },
  };
}

/**
 * Partidas que analiza el coach: junta las del historial del cliente (formato del LCU) con las archivadas
 * (filas de gameRow, solo de tu cuenta), sin duplicados y de la más reciente a la más antigua.
 * Solo la Grieta y de más de 15 min; clasificatorias si hay al menos 4, si no todas. Hasta 20.
 * @returns { games: [{ gameId, queueId, date }], ranked: boolean }
 */
export function pickCoachGames(history = [], archived = []) {
  const byId = new Map();
  for (const g of history || []) {
    if (!g?.gameId) continue;
    byId.set(g.gameId, { gameId: g.gameId, queueId: g.queueId, sr: g.mapId === 11, secs: g.gameDuration, date: g.gameCreation || 0 });
  }
  for (const r of archived || []) {
    if (!r?.gameId || byId.has(r.gameId)) continue;
    // Las filas archivadas antiguas pueden no tener "secs": se usa la duración en minutos (redondeada)
    byId.set(r.gameId, { gameId: r.gameId, queueId: r.queueId, sr: !!r.sr, secs: r.secs ?? (r.duration || 0) * 60, date: r.date || 0 });
  }
  const all = [...byId.values()].filter((g) => g.sr && g.secs > 900).sort((a, b) => b.date - a.date);
  const ranked = all.filter((g) => RANKED.has(g.queueId));
  const useRanked = ranked.length >= 4;
  return { games: (useRanked ? ranked : all).slice(0, 20), ranked: useRanked };
}

/** Mínimo de partidas con esa fase para dar su nota, y para señalarla como la peor. */
const PHASE_MIN_GAMES = 2;
const WEAKEST_MIN_GAMES = 3;

/**
 * "Tu coach": analiza tus últimas clasificatorias (hasta 20) y cuenta qué problemas se repiten.
 * - Hábitos: en tus 10 últimas, y si van a mejor o a peor frente a las 10 anteriores.
 * - Por fase: nota de la fase de líneas (0-14), la mitad (14-25) y el final (25+), con sus muertes.
 * - Por campeón: nota, muertes, CS y el fallo que más se repite con cada uno.
 * Cada análisis se cachea para siempre, así que solo es lento la primera vez.
 * archived: tus partidas archivadas (archivedGames), porque el cliente a veces da muy pocas. Solo para tu cuenta.
 * other: el jugador no es el usuario (textos en tercera persona). analyze: para los tests.
 */
export async function buildCoach(lcu, puuid, { record = true, other = false, archived = null, analyze = analyzeGame } = {}) {
  return cached(`coach_${puuid}`, 10 * 60_000, async () => {
    const history = await lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`).catch(() => null);
    const { games, ranked: onlyRanked } = pickCoachGames(history?.games?.games || [], archived || []);
    const analyses = [];
    for (const g of games) {
      const a = await analyze(lcu, g.gameId, puuid, { record, other }).catch((err) => { console.warn('[coach]', g.gameId, err.message); return null; });
      if (a) analyses.push(a);
    }
    // Si el cliente falla con muchas (p. ej. recién arrancado), mejor no guardar un coach a medias
    if (games.length >= 4 && analyses.length < games.length / 2) throw new Error('El cliente no ha dado el análisis de tus partidas; se reintentará');
    const recent = analyses.slice(0, 10);
    const before = analyses.slice(10);
    const n = recent.length;
    const hasBefore = before.length >= 4;
    const avg = (list) => (list.length ? list.reduce((x, v) => x + v, 0) / list.length : null);
    const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

    // ---- Hábitos (tus 10 últimas) y su evolución ----
    const countIssues = (list) => {
      const map = new Map();
      for (const a of list) {
        for (const x of a.improve) {
          const e = map.get(x.title) || { title: x.title, tip: x.tip, games: 0, severity: 0, examples: [] };
          e.games++;
          e.severity += x.severity;
          if (e.examples.length < 3) e.examples.push(x.detail);
          map.set(x.title, e);
        }
      }
      return map;
    };
    const issues = countIssues(recent);
    const issuesBefore = countIssues(before);
    const goods = new Map();
    for (const a of recent) {
      for (const x of a.strengths) {
        const e = goods.get(x.title) || { title: x.title, games: 0 };
        e.games++;
        goods.set(x.title, e);
      }
    }
    const trendOf = (now, prev) => {
      if (prev == null) return null;
      const d = now - prev;
      return Math.abs(d) < 0.15 ? 'same' : d < 0 ? 'better' : 'worse';
    };
    const top = [...issues.values()].sort((a, b) => b.games - a.games || b.severity - a.severity).slice(0, 3);

    // ---- Por fase ----
    const PHASES = [
      { key: 'early', label: 'Fase de líneas', range: "0-14'", from: 0, to: 14 },
      { key: 'mid', label: 'Mitad de partida', range: "14-25'", from: 14, to: 25 },
      { key: 'late', label: 'Final', range: "25'+", from: 25, to: 999 },
    ];
    const phaseOf = (list, p) => {
      const played = list.filter((a) => a.grades?.[p.key]);
      const score = avg(played.map((a) => a.grades[p.key].score));
      const deaths = avg(played.map((a) => (a.deaths || []).filter((d) => d.minute >= p.from && d.minute < p.to).length));
      return { games: played.length, score, deaths };
    };
    const phases = PHASES.map((p) => {
      const now = phaseOf(recent, p);
      const prev = hasBefore ? phaseOf(before, p) : null;
      // Con una sola partida la nota de la fase no dice nada: se muestra a partir de PHASE_MIN_GAMES
      const enough = now.games >= PHASE_MIN_GAMES && now.score != null;
      const out = {
        key: p.key, label: p.label, range: p.range, games: now.games,
        score: enough ? round(now.score) : null, grade: enough ? gradeOf(now.score) : null,
        deaths: round(now.deaths, 1),
        scoreBefore: prev?.games >= 3 ? round(prev.score) : null,
        deathsBefore: prev?.games >= 3 ? round(prev.deaths, 1) : null,
      };
      if (p.key === 'early') {
        const lane = recent.filter((a) => a.lane?.at14);
        out.gold14 = round(avg(lane.filter((a) => a.lane.at14.goldDiff != null).map((a) => a.lane.at14.goldDiff)));
        out.cs10 = round(avg(lane.filter((a) => a.lane.at10).map((a) => a.lane.at10.cs)));
      }
      return out;
    });
    const graded = phases.filter((p) => p.score != null && p.games >= WEAKEST_MIN_GAMES);
    const weakest = graded.length >= 2 ? graded.reduce((a, b) => (b.score < a.score ? b : a)).key : null;

    // ---- Por campeón (todas las analizadas) ----
    const byChamp = new Map();
    for (const a of analyses) {
      if (!a.champ) continue;
      const e = byChamp.get(a.champ.key) || { champ: a.champ, list: [] };
      e.list.push(a);
      byChamp.set(a.champ.key, e);
    }
    const champs = [...byChamp.values()].filter((e) => e.list.length >= 2).sort((a, b) => b.list.length - a.list.length).slice(0, 6).map((e) => {
      const issueCount = countIssues(e.list);
      const worst = [...issueCount.values()].sort((a, b) => b.games - a.games || b.severity - a.severity)[0];
      const phaseScores = PHASES.map((p) => ({ key: p.key, score: avg(e.list.filter((a) => a.grades?.[p.key]).map((a) => a.grades[p.key].score)) })).filter((x) => x.score != null);
      const weak = phaseScores.length >= 2 ? phaseScores.reduce((a, b) => (b.score < a.score ? b : a)).key : null;
      return {
        champ: e.champ,
        games: e.list.length,
        wins: e.list.filter((a) => a.win).length,
        score: round(avg(e.list.map((a) => a.grades.overall.score))),
        deaths: round(avg(e.list.map((a) => Number(String(a.stats.kda).split('/')[1]) || 0)), 1),
        csMin: round(avg(e.list.map((a) => a.stats.csMin)), 1),
        weakPhase: weak,
        topIssue: worst && worst.games >= 2 ? { title: worst.title, games: worst.games } : null,
      };
    });

    // ---- Mapa de muertes (tus 10 últimas) ----
    const deathPoints = [];
    for (const a of recent) for (const d of a.deaths || []) if (d.map) deathPoints.push({ ...d.map, zone: d.zone, gank: d.gank, early: d.minute < 14, gameId: a.gameId });

    const score = avg(recent.map((a) => a.grades.overall.score));
    const scoreBefore = hasBefore ? avg(before.map((a) => a.grades.overall.score)) : null;
    return {
      analyzed: n,
      ranked: onlyRanked,
      queueLabel: onlyRanked ? 'clasificatorias' : 'partidas de la Grieta',
      analyzedBefore: hasBefore ? before.length : 0,
      avgScore: round(score),
      avgScoreBefore: round(scoreBefore),
      deathMap: (() => {
        const counts = {};
        for (const d of deathPoints) counts[d.zone] = (counts[d.zone] || 0) + 1;
        const zones = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([zone, count]) => ({ zone, count, pct: Math.round((count / deathPoints.length) * 100) }));
        return { points: deathPoints, zones, total: deathPoints.length, games: n, early: deathPoints.filter((d) => d.early).length, ganks: deathPoints.filter((d) => d.gank).length };
      })(),
      habits: top.map((x) => {
        const prev = hasBefore ? (issuesBefore.get(x.title)?.games || 0) : null;
        return {
          title: x.title, games: x.games, of: n, tip: x.tip, example: x.examples[0],
          before: prev, beforeOf: hasBefore ? before.length : null,
          trend: hasBefore ? trendOf(x.games / n, prev / before.length) : null,
        };
      }),
      strengths: [...goods.values()].sort((a, b) => b.games - a.games).slice(0, 3).map((x) => ({ title: x.title, games: x.games, of: n })),
      phases,
      weakestPhase: weakest,
      champs,
    };
  }, { disk: false });
}

/**
 * Sesión actual (anti-tilt): partidas encadenadas con menos de 90 min entre una y otra,
 * siempre que la última haya acabado hace menos de 3 h.
 */
export function buildSession(recent, lp) {
  const games = recent.filter((g) => !g.remake && g.sr);
  if (!games.length) return null;
  const end = (g) => g.date + g.duration * 60_000;
  if (Date.now() - end(games[0]) > 3 * 3600_000) return { active: false };

  const session = [games[0]];
  for (let i = 1; i < games.length; i++) {
    if (session[session.length - 1].date - end(games[i]) > 90 * 60_000) break;
    session.push(games[i]);
  }
  const others = games.slice(session.length);
  const wins = session.filter((g) => g.win).length;
  let lossStreak = 0;
  for (const g of session) { if (g.win) break; lossStreak++; }
  let winStreak = 0;
  for (const g of session) { if (!g.win) break; winStreak++; }

  const deltas = Object.values(lp || {}).flatMap((q) => q.games || []);
  const known = session.map((g) => deltas.find((d) => d.gameId === g.gameId)?.delta).filter((d) => d != null);
  const lpNet = known.reduce((s, d) => s + d, 0);
  const avg = (list, f) => (list.length ? list.reduce((s, g) => s + f(g), 0) / list.length : null);
  const deaths = avg(session, (g) => g.d);
  const baseDeaths = avg(others, (g) => g.d);

  const warnings = [];
  if (lossStreak >= 3) warnings.push({ level: 'stop', text: `Llevas ${lossStreak} derrotas seguidas. Es el momento clásico de tiltearse: para, despéjate y vuelve más tarde.` });
  else if (lossStreak === 2) warnings.push({ level: 'careful', text: 'Dos derrotas seguidas. Si la siguiente sale mal, déjalo por hoy.' });
  if (known.length && lpNet <= -40) warnings.push({ level: 'stop', text: `Llevas ${lpNet} LP en esta sesión.` });
  if (deaths != null && baseDeaths != null && session.length >= 3 && deaths >= baseDeaths + 2) {
    warnings.push({ level: 'careful', text: `Estás muriendo más de lo normal (${deaths.toFixed(1)} por partida frente a ${baseDeaths.toFixed(1)} de media): señal de cansancio o tilt.` });
  }
  if (session.length >= 6) warnings.push({ level: 'careful', text: `${session.length} partidas seguidas: el rendimiento suele bajar tras muchas horas de juego.` });
  const hour = new Date().getHours();
  if (hour >= 1 && hour < 6) warnings.push({ level: 'careful', text: 'Es muy tarde: jugar con sueño cuesta LP.' });

  const verdict = warnings.some((w) => w.level === 'stop') ? 'stop' : warnings.length ? 'careful' : winStreak >= 2 ? 'hot' : 'ok';
  return {
    active: true,
    verdict,
    games: session.length,
    wins,
    losses: session.length - wins,
    lossStreak,
    winStreak,
    lpNet: known.length ? lpNet : null,
    lpKnown: known.length,
    minutes: Math.round((end(session[0]) - session[session.length - 1].date) / 60_000),
    deaths: deaths != null ? Math.round(deaths * 10) / 10 : null,
    baseDeaths: baseDeaths != null ? Math.round(baseDeaths * 10) / 10 : null,
    form: session.slice().reverse().map((g) => ({ win: g.win, champ: g.champ, delta: deltas.find((d) => d.gameId === g.gameId)?.delta ?? null })),
    warnings,
  };
}

const METRICS = [
  { key: 'score', label: 'Nota del coach', unit: '', better: 'up', digits: 0 },
  { key: 'deaths', label: 'Muertes', unit: '', better: 'down', digits: 1 },
  { key: 'early', label: "Muertes antes del 14'", unit: '', better: 'down', digits: 1 },
  { key: 'csMin', label: 'CS por minuto', unit: '', better: 'up', digits: 1 },
  { key: 'visionMin', label: 'Visión por minuto', unit: '', better: 'up', digits: 2 },
  { key: 'kp', label: 'Participación en kills', unit: '%', better: 'up', digits: 0 },
  { key: 'dmgShare', label: 'Daño del equipo', unit: '%', better: 'up', digits: 0 },
  { key: 'gold14', label: "Oro vs rival al 14'", unit: '', better: 'up', digits: 0 },
];

/**
 * Tu evolución partida a partida. Se asegura de que tus últimas partidas en la Grieta estén analizadas
 * (quedan guardadas para siempre) y compara tus últimas partidas con las anteriores.
 */
/** getTrendsFn: tus tendencias guardadas. Sin ella (otros jugadores) se calculan solo con sus últimas partidas, sin guardar nada. */
export async function buildTrends(lcu, puuid, getTrendsFn = null) {
  return cached(`trends_${puuid}`, 5 * 60_000, async () => {
    const history = await lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=19`).catch(() => null);
    const games = (history?.games?.games || []).filter((g) => g.mapId === 11 && g.gameDuration > 900);
    const rows = [];
    for (const g of games) {
      const a = await analyzeGame(lcu, g.gameId, puuid, { record: !!getTrendsFn, other: !getTrendsFn }).catch(() => null);
      const row = trendRow(a);
      if (row) rows.push({ gameId: g.gameId, ...row });
    }

    const all = getTrendsFn ? getTrendsFn(puuid) : rows.sort((a, b) => a.date - b.date);
    const ranked = all.filter((g) => g.ranked);
    const list = (ranked.length >= 8 ? ranked : all).slice(-40);
    const n = list.length;
    const win = Math.min(5, Math.floor(n / 2));
    const avg = (arr, k) => {
      const v = arr.map((g) => g[k]).filter((x) => x != null && !Number.isNaN(x));
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const metrics = METRICS.map((m) => {
      const recent = win ? avg(list.slice(-win), m.key) : null;
      const before = win ? avg(list.slice(0, n - win), m.key) : null;
      const delta = recent != null && before != null ? recent - before : null;
      const rel = delta != null && before ? delta / Math.abs(before) : null;
      const improving = delta == null ? null : m.better === 'up' ? delta > 0 : delta < 0;
      const absolute = m.key === 'gold14';
      const meaningful = absolute ? delta != null && Math.abs(delta) >= 300 : rel != null && Math.abs(rel) >= 0.1;
      const r = (x) => (x == null ? null : Number(x.toFixed(m.digits)));
      return {
        ...m,
        values: list.map((g) => g[m.key] ?? null),
        recent: r(recent),
        before: r(before),
        change: absolute ? (delta != null ? Math.round(delta) : null) : rel != null ? Math.round(rel * 100) : null,
        absolute,
        trend: meaningful ? (improving ? 'good' : 'bad') : 'flat',
      };
    });
    const fmt = (m, x) => `${x}${m.unit}`;
    const insights = metrics
      .filter((m) => m.trend !== 'flat' && m.recent != null && m.before != null)
      .sort((a, b) => (b.absolute ? Math.abs(b.change) / 10 : Math.abs(b.change)) - (a.absolute ? Math.abs(a.change) / 10 : Math.abs(a.change)))
      .slice(0, 4)
      .map((m) => ({
        type: m.trend,
        text: `${m.label}: ${m.trend === 'good' ? (getTrendsFn ? 'mejoras' : 'mejora') : (getTrendsFn ? 'empeoras' : 'empeora')}, de ${fmt(m, m.before)} a ${fmt(m, m.recent)}${m.absolute ? '' : ` (${m.change > 0 ? '+' : ''}${m.change}%)`} en ${getTrendsFn ? 'tus' : 'sus'} últimas ${win} partidas`,
      }));
    return {
      games: list.map((g) => ({ gameId: g.gameId, date: g.date, win: g.win, champ: ddragon.champView(g.champ) })),
      metrics,
      insights,
      window: win,
      total: n,
    };
  }, { disk: false });
}
