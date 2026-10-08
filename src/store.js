/**
 * Datos personales guardados en local (data/*.json), separados por cuenta (puuid):
 *  - notes.json: tus notas de matchup ("Jhin vs Caitlyn") y generales contra un campeón.
 *  - matchups.json: tu historial de enfrentamientos de línea (se rellena con cada partida analizada).
 *  - goals.json: tu objetivo de LP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { ddragon } from './data/ddragon.js';

const DIR = path.dirname(config.cacheDir);

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
  } catch {
    return {};
  }
}

function save(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(data, null, 1));
}

// ---------- Notas ----------
// Clave "miCampeón:suCampeón"; miCampeón = 0 para una nota general contra ese campeón.
export function getNotes(puuid, me, vs) {
  const all = load('notes.json')[puuid] || {};
  return {
    matchup: me ? all[`${me}:${vs}`] || null : null,
    general: all[`0:${vs}`] || null,
  };
}

export function setNote(puuid, me, vs, text) {
  const data = load('notes.json');
  const mine = (data[puuid] ||= {});
  const key = `${me || 0}:${vs}`;
  const clean = String(text || '').slice(0, 2000);
  if (clean.trim()) mine[key] = { text: clean, updatedAt: Date.now() };
  else delete mine[key];
  save('notes.json', data);
  return mine[key] || null;
}

export function allNotes(puuid) {
  const all = load('notes.json')[puuid] || {};
  return Object.entries(all)
    .map(([key, n]) => {
      const [me, vs] = key.split(':').map(Number);
      return { me: me || 0, vs, meChamp: me ? ddragon.champView(me) : null, vsChamp: ddragon.champView(vs), ...n };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------- Historial de matchups ----------
export function recordMatchup(puuid, a) {
  if (!a?.sr || !a.opp?.champ?.key || !a.champ?.key) return;
  const data = load('matchups.json');
  const mine = (data[puuid] ||= {});
  if (mine[a.gameId]) return;
  mine[a.gameId] = {
    me: a.champ.key,
    vs: a.opp.champ.key,
    pos: a.pos,
    win: a.win,
    kda: a.stats?.kda,
    gold14: a.lane?.at14?.goldDiff ?? null,
    date: a.date,
    ranked: a.ranked,
  };
  save('matchups.json', data);
}

export function matchupHistory(puuid, me, vs) {
  const games = Object.entries(load('matchups.json')[puuid] || {})
    .map(([gameId, g]) => ({ gameId: Number(gameId), ...g }))
    .filter((g) => g.vs === vs)
    .sort((a, b) => b.date - a.date);
  const summarize = (list) => ({
    games: list.length,
    wins: list.filter((g) => g.win).length,
    avgGold14: list.filter((g) => g.gold14 != null).length
      ? Math.round(list.filter((g) => g.gold14 != null).reduce((s, g) => s + g.gold14, 0) / list.filter((g) => g.gold14 != null).length)
      : null,
  });
  const same = games.filter((g) => g.me === me);
  return {
    withChamp: summarize(same),
    any: summarize(games),
    recent: games.slice(0, 5).map((g) => ({ ...g, meChamp: ddragon.champView(g.me) })),
  };
}

// ---------- Objetivo de LP ----------
export function getGoal(puuid) {
  return load('goals.json')[puuid] || null;
}

export function setGoal(puuid, goal) {
  const data = load('goals.json');
  if (goal) data[puuid] = { ...goal, createdAt: Date.now() };
  else delete data[puuid];
  save('goals.json', data);
  return data[puuid] || null;
}

// ---------- Tendencias (métricas de cada partida analizada; crece más allá de las 20 del cliente) ----------
/** Fila de tendencias a partir del análisis de una partida (null si no cuenta: ARAM, partidas cortas…). */
export function trendRow(a) {
  if (!a?.sr || a.duration < 15) return null;
  const [, d] = String(a.stats?.kda || '0/0/0').split('/').map(Number);
  return {
    date: a.date,
    champ: a.champ?.key,
    win: a.win,
    ranked: a.ranked,
    pos: a.pos,
    csMin: a.stats?.csMin,
    deaths: d,
    early: (a.deaths || []).filter((x) => x.minute < 14).length,
    visionMin: a.stats?.visionMin,
    kp: a.stats?.kp,
    dmgShare: a.stats?.dmgShare,
    score: a.grades?.overall?.score,
    gold14: a.lane?.at14?.goldDiff ?? null,
    wards: a.stats?.controlWards,
  };
}

export function recordTrend(puuid, a) {
  const row = trendRow(a);
  if (!row) return;
  const data = load('trends.json');
  const mine = (data[puuid] ||= {});
  if (mine[a.gameId]) return;
  mine[a.gameId] = row;
  save('trends.json', data);
}

export function getTrends(puuid) {
  return Object.entries(load('trends.json')[puuid] || {})
    .map(([gameId, g]) => ({ gameId: Number(gameId), ...g }))
    .sort((a, b) => a.date - b.date);
}

// ---------- Ajustes (qué partes de la app están activadas) ----------
export const DEFAULT_SETTINGS = {
  overlay: { enabled: true, locked: true, bench: true, posCs: null, posTimers: null, posSkill: null, posBack: null, posLoadAlly: null, posLoadEnemy: null, back: true, loading: true, loadingCards: true, cs: true, timers: true, timersPopup: true, skill: true, timerDragon: true, timerGrubs: true, timerHerald: true, timerBaron: true, timerInhibs: true },
  alerts: { enabled: true, toasts: true, voice: false, oppItems: true, levels: true, advantage: true, myItems: true, oppDeath: true, canBuy: true, fedEnemies: true, objectives: true },
  live: { power: true, alertsPanel: true, draft: true, insights: true, comps: true, pairs: true, buy: true, situational: true, skills: true, objectives: true, spells: true },
  champSelect: { dodge: true, notes: true, picks: true, bans: true, matchups: true, why: true, autoRunes: true, autoSpells: true, autoItems: true },
  home: { form: true, session: true, goal: true, goalOdds: true, goalPlan: true, lpCard: true, perf: true, coach: true, recent: true, lpChart: true, trends: true, forecast: true, champs: true, deathMap: true, coachPhases: true, coachDeep: true },
  postgame: { badges: true, mvp: true, rowDetails: true, suggestions: true },
  riot: { apiKey: '' },
};

function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeDeep(base[k], v) : v;
  }
  return out;
}

export function getSettings() {
  return mergeDeep(DEFAULT_SETTINGS, load('settings.json'));
}

/** Cambia un ajuste por su ruta ("overlay.cs") o restaura los valores por defecto (path = null). */
export function setSetting(pathKey, value) {
  if (!pathKey) {
    save('settings.json', {});
    return getSettings();
  }
  const data = load('settings.json');
  const [group, key] = String(pathKey).split('.');
  if (!(group in DEFAULT_SETTINGS) || !(key in DEFAULT_SETTINGS[group])) throw new Error(`Ajuste desconocido: ${pathKey}`);
  const def = DEFAULT_SETTINGS[group][key];
  const clamp = (n) => Math.min(1, Math.max(0, Number(n)));
  // Interruptores: sí/no. Posiciones del overlay: {x, y} en fracción de la pantalla del juego (null = sitio por defecto)
  (data[group] ||= {})[key] = typeof def === 'string' ? String(value ?? '').trim().slice(0, 200)
    : typeof def === 'boolean' ? !!value
    : value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) ? { x: clamp(value.x), y: clamp(value.y) } : null;
  save('settings.json', data);
  return getSettings();
}

// ---------- Tu pool de campeones (elegido por ti, por rol) ----------
const POOL_ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export function getMyPool(puuid) {
  const mine = load('mypool.json')[puuid] || {};
  return Object.fromEntries(POOL_ROLES.map((r) => [r, (mine[r] || []).filter(Number.isFinite)]));
}

/** action: 'add' | 'remove' | 'up' | 'down' (orden = prioridad). */
export function updateMyPool(puuid, role, champId, action) {
  if (!POOL_ROLES.includes(role)) throw new Error('Rol desconocido');
  const id = Number(champId);
  if (!ddragon.champ(id)) throw new Error('Campeón desconocido');
  const data = load('mypool.json');
  const mine = (data[puuid] ||= {});
  const list = (mine[role] ||= []);
  const i = list.indexOf(id);
  if (action === 'add' && i < 0) {
    if (list.length >= 10) throw new Error('Máximo 10 campeones por rol');
    list.push(id);
  } else if (action === 'remove' && i >= 0) list.splice(i, 1);
  else if (action === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  else if (action === 'down' && i >= 0 && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  save('mypool.json', data);
  return getMyPool(puuid);
}

/** Tus partidas analizadas con un campeón (y contra un rival concreto, si se indica). */
export function champRecord(puuid, champId, vs = null) {
  const games = Object.values(load('matchups.json')[puuid] || {}).filter((g) => g.me === champId);
  const vsGames = vs ? games.filter((g) => g.vs === vs) : [];
  return {
    games: games.length,
    wins: games.filter((g) => g.win).length,
    vsGames: vsGames.length,
    vsWins: vsGames.filter((g) => g.win).length,
  };
}

// ---------- Archivo de tus partidas (el cliente solo da las 20 últimas; aquí se van acumulando) ----------
const ARCHIVE_MAX = 400;
/** Todas las partidas archivadas (más recientes primero). */
export function archivedGames(puuid) {
  return Object.values(load('history.json')[puuid] || {}).sort((a, b) => b.date - a.date);
}

export function archiveGames(puuid, rows) {
  const data = load('history.json');
  const mine = (data[puuid] ||= {});
  let changed = false;
  for (const r of rows) {
    if (r?.gameId && !mine[r.gameId]) { mine[r.gameId] = r; changed = true; }
  }
  const all = Object.values(mine).sort((a, b) => b.date - a.date);
  if (all.length > ARCHIVE_MAX) {
    for (const r of all.slice(ARCHIVE_MAX)) delete mine[r.gameId];
    changed = true;
  }
  if (changed) save('history.json', data);
  // Las 20 del cliente (frescas) y después las archivadas que no están entre ellas
  const fresh = new Set(rows.map((r) => r.gameId));
  return [...rows, ...all.slice(0, ARCHIVE_MAX).filter((r) => !fresh.has(r.gameId))].sort((a, b) => b.date - a.date);
}
