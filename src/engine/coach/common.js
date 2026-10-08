/**
 * Piezas comunes de los coaches por rol: métricas que salen de la línea temporal (peleas, objetivos,
 * roams) y reglas reutilizables. Cada coach decide qué reglas aplica y con qué textos.
 *
 * Datos que usamos (comprobados en el historial del cliente): estadísticas finales del jugador
 * (visión, wards puestos/quitados, wards de control comprados, trinket final en item6, daño a torres)
 * y eventos de la línea temporal (CHAMPION_KILL, ELITE_MONSTER_KILL, BUILDING_KILL con posición).
 * Lo que NO hay: compras de objetos, wards puestos por minuto, enfriamiento de Flash, placas.
 * neutralMinionsKilledTeamJungle/EnemyJungle vienen siempre a 0, así que no se usan.
 */
import { zoneOf } from '../../util/mapzones.js';

export const TRINKET = { YELLOW: 3340, FARSIGHT: 3363, LENS: 3364 };

export const fmtMin = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
export const pct = (x) => Math.round(x * 100);

/**
 * Peleas: kills de campeón separadas entre sí por menos de 15 s forman un grupo; un grupo con 3 o más
 * muertes (de cualquier equipo) cuenta como pelea. Para cada una de tus muertes dice si fue en una
 * pelea y si fuiste el primer aliado en caer en ella.
 */
export function fightDeaths(killEvents, pid, allyIds) {
  const kills = [...killEvents].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  for (const e of kills) {
    const g = groups[groups.length - 1];
    if (g && e.timestamp - g[g.length - 1].timestamp <= 15000) g.push(e);
    else groups.push([e]);
  }
  const out = new Map(); // timestamp de tu muerte -> { fight, first }
  for (const g of groups) {
    const fight = g.length >= 3;
    const firstAlly = g.find((e) => allyIds.has(e.victimId));
    for (const e of g) {
      if (e.victimId === pid) out.set(e.timestamp, { fight, first: fight && firstAlly === e });
    }
  }
  return out;
}

const EPIC = { DRAGON: 'dragons', BARON_NASHOR: 'barons', RIFTHERALD: 'heralds', HORDE: 'grubs', ATAKHAN: 'atakhan' };

/**
 * Objetivos neutrales que mató tu equipo y en cuántos participaste (eres quien lo mata o sales en sus
 * asistencias). Solo se cuentan los de tu equipo: en los eventos, las asistencias pueden incluir rivales
 * que estaban cerca, y un killerId 0 (sin dueño claro) no se cuenta.
 */
export function objectiveParticipation(events, pid, allyIds) {
  const out = { dragons: { total: 0, mine: 0 }, barons: { total: 0, mine: 0 }, heralds: { total: 0, mine: 0 }, grubs: { total: 0, mine: 0 }, atakhan: { total: 0, mine: 0 } };
  for (const e of events) {
    if (e.type !== 'ELITE_MONSTER_KILL' || !allyIds.has(e.killerId)) continue;
    const k = EPIC[e.monsterType];
    if (!k) continue;
    out[k].total++;
    if (e.killerId === pid || (e.assistingParticipantIds || []).includes(pid)) out[k].mine++;
  }
  return out;
}

const LANE_ZONE = { TOP: 'Línea de top', MIDDLE: 'Línea de mid', BOTTOM: 'Línea de bot', UTILITY: 'Línea de bot' };

/**
 * Roams en la fase de líneas: kills en las que participas antes del minuto 14 dentro de otra línea
 * (las del río no cuentan: son escaramuzas de tu propia zona).
 */
export function earlyRoams(events, pid, pos, teamId) {
  const own = LANE_ZONE[pos];
  if (!own) return 0;
  return events.filter((e) => e.type === 'CHAMPION_KILL' && e.timestamp < 14 * 60000 && e.position
    && (e.killerId === pid || (e.assistingParticipantIds || []).includes(pid))
    && /^Línea de /.test(zoneOf(e.position, teamId)) && zoneOf(e.position, teamId) !== own).length;
}

/** Acumulador de fallos (improve), aciertos (strengths) y sugerencias suaves (no cuentan como fallo). */
export function collector() {
  const issues = [];
  const goods = [];
  const suggestions = [];
  return {
    issues, goods, suggestions,
    issue: (severity, title, detail, tip) => issues.push({ severity, title, detail, tip }),
    good: (score, title, detail) => goods.push({ score, title, detail }),
    suggest: (title, detail) => suggestions.push({ title, detail }),
  };
}

// ---------------------------------------------------------------------------------------------
// Reglas reutilizables. `c` es el contexto de la partida (ver buildContext en postgame.js),
// `o` el acumulador y `T` los objetivos del coach.
// ---------------------------------------------------------------------------------------------

/** Muchas muertes: 7 o más, o 5 o más y 2 por encima de tu media. */
export function deathsRule(c, o, tip) {
  const { m, base } = c;
  if (m.deaths >= 7 || (base && m.deaths >= 5 && m.deaths > base.deaths + 2)) {
    o.issue(m.deaths - 3, 'Mueres demasiado', `${m.deaths} muertes${base ? ` (tu media: ${base.deaths.toFixed(1)})` : ''}; ${c.earlyDeaths.length} antes del minuto 14.`, tip);
  }
}

/** Dos o más muertes con el jungla rival implicado antes del minuto 15. */
export function gankRule(c, o, tip, title = 'Te gankean en la fase de líneas') {
  const g = c.deaths.filter((d) => d.gank);
  if (g.length >= 2) o.issue(3 + g.length, title, `${g.length} muertes con el jungla rival antes del minuto 15 (${g.map((d) => fmtMin(d.time)).join(', ')}).`, tip);
}

/** Tres o más muertes en la mitad rival del mapa después del minuto 10. */
export function sideDeathsRule(c, o, title, tip) {
  const n = c.deaths.filter((d) => d.enemySide && d.time > 10 * 60000).length;
  if (n >= 3) o.issue(n, title, `${n} muertes en su mitad del mapa después del minuto 10.`, tip);
}

/** Diferencia de oro con tu rival de línea al minuto 14 (±800). */
export function laneRule(c, o, tip, { goldNote = '' } = {}) {
  const l = c.lane[14];
  if (l?.goldDiff == null) return;
  if (l.goldDiff <= -800) {
    o.issue(Math.abs(l.goldDiff) / 400, 'Pierdes la fase de líneas', `Al minuto 14 ibas ${l.goldDiff} de oro y ${l.csDiff} CS frente a ${c.oppName || 'tu rival'}${goldNote}.`, tip);
  } else if (l.goldDiff >= 800) {
    o.good(l.goldDiff / 300, 'Ganaste tu línea', `+${l.goldDiff} de oro y ${l.csDiff >= 0 ? '+' : ''}${l.csDiff} CS al minuto 14${goldNote}.`);
  }
}

/** CS/min por debajo del objetivo del rol (0,8 de margen) o por encima (+0,3). */
export function csRule(c, o, T, tip, title = 'Farmeas poco') {
  if (!T.csMin) return;
  const { m, lane, base } = c;
  if (m.csMin < T.csMin - 0.8) {
    o.issue((T.csMin - m.csMin) * 2, title, `${m.csMin.toFixed(1)} CS/min (objetivo ${T.csMin})${lane[10] && T.cs10 ? `; al minuto 10 llevabas ${lane[10].cs} (objetivo ${T.cs10})` : ''}${base ? `. Tu media: ${base.csMin.toFixed(1)}` : ''}.`, tip);
  } else if (m.csMin >= T.csMin + 0.3) {
    o.good(m.csMin - T.csMin + 1, 'Buen farmeo', `${m.csMin.toFixed(1)} CS/min.`);
  }
}

/** CS al minuto 10 claramente por debajo del objetivo (10 o más), aunque el CS/min final sea aceptable. */
export function cs10Rule(c, o, T, tip) {
  const l10 = c.lane[10];
  if (!T.cs10 || !l10 || !T.csMin || c.m.csMin < T.csMin - 0.8) return; // si ya salta "Farmeas poco", no repetir
  if (l10.cs <= T.cs10 - 10) o.issue((T.cs10 - l10.cs) / 6, 'Pierdes CS en la fase de líneas', `${l10.cs} CS al minuto 10 (objetivo ${T.cs10})${l10.csDiff != null ? `, ${l10.csDiff >= 0 ? '+' : ''}${l10.csDiff} frente a tu rival` : ''}.`, tip);
}

/** Participación en kills por debajo del objetivo (−12 puntos) en partidas de más de 18 min. */
export function kpRule(c, o, T, tip) {
  const target = T.kp ?? 0.5;
  if (c.sr && c.min > 18 && c.m.kp < target - 0.12) {
    o.issue((target - c.m.kp) * 20, 'Participas poco en las peleas', `Participación en kills del ${pct(c.m.kp)}% (objetivo ${pct(target)}%).`, tip);
  } else if (c.m.kp >= 0.65) {
    o.good(c.m.kp * 4, 'Muy presente en las peleas', `Participaste en el ${pct(c.m.kp)}% de las kills.`);
  }
}

/** Parte del daño del equipo por debajo del objetivo (−7 puntos) o por encima (+6). */
export function dmgRule(c, o, T, tip) {
  if (!T.dmgShare) return;
  if (c.m.dmgShare < T.dmgShare - 0.07) {
    o.issue((T.dmgShare - c.m.dmgShare) * 25, 'Haces poco daño para tu rol', `${pct(c.m.dmgShare)}% del daño de tu equipo (objetivo ~${pct(T.dmgShare)}%).`, tip);
  } else if (c.m.dmgShare >= T.dmgShare + 0.06) {
    o.good(c.m.dmgShare * 10, 'Mucho daño', `${pct(c.m.dmgShare)}% del daño de tu equipo.`);
  }
}

/** Visión/min por debajo del objetivo (−0,3): fallo o, con soft, solo sugerencia. */
export function visionRule(c, o, T, { tip, soft = false, softTitle = 'Más visión con el trinket' }) {
  if (!T.visionMin) return;
  const v = c.m.visionMin;
  if (v < T.visionMin - 0.3) {
    const detail = `${v.toFixed(2)} de visión por minuto (referencia ${T.visionMin}); pusiste ${c.m.wardsPlaced} wards y quitaste ${c.m.wardsKilled}.`;
    if (soft) o.suggest(softTitle, `${detail} ${tip}`);
    else o.issue((T.visionMin - v) * 5, 'Poca visión', detail, tip);
  } else if (v >= T.visionMin + 0.4) {
    o.good(2, 'Buena visión', `${v.toFixed(2)} de visión por minuto.`);
  }
}

/** KDA alto y pocas muertes (iguales para todos los roles). */
export function kdaGoods(c, o) {
  const { m } = c;
  if (m.kda >= 4 && m.deaths > 2) o.good(m.kda / 2, 'Gran KDA', `${m.kills}/${m.deaths}/${m.assists} (${m.kda.toFixed(1)}).`);
  if (m.deaths <= 2 && c.min > 20) o.good(3, 'Muy pocas muertes', m.deaths === 0 ? 'Ninguna muerte en toda la partida.' : `Solo ${m.deaths} muerte${m.deaths === 1 ? '' : 's'}.`);
}

/** Poca presencia en las kills de la fase de líneas: tu equipo hizo 4+ kills antes del 14 y estuviste en menos del umbral. */
export function earlyPresenceRule(c, o, { min = 0.3, title = 'Poca presencia en la fase de líneas', tip }) {
  const e = c.phase.early;
  if (e.tk < 4) return;
  const share = e.mine / e.tk;
  if (share < min) o.issue((min - share) * 12 + 1, title, `Estuviste en ${e.mine} de las ${e.tk} kills de tu equipo antes del minuto 14 (${pct(share)}%).`, tip);
}

/** Objetivos de tu equipo en los que no estuviste (dragones, Barón y Atakhan; mín. 3 en la partida). */
export function objectivePresenceRule(c, o, { min = 0.5, tip, title = 'Te pierdes los objetivos' }) {
  const p = c.objParticipation;
  if (!p) return;
  const total = p.dragons.total + p.barons.total + p.atakhan.total;
  const mine = p.dragons.mine + p.barons.mine + p.atakhan.mine;
  if (total < 3) return;
  const share = mine / total;
  if (share < min) o.issue((min - share) * 8 + 1, title, `Tu equipo mató ${total} dragones/barones y estuviste en ${mine} (${pct(share)}%).`, tip);
  else if (share >= 0.8) o.good(2 + share, 'Presente en los objetivos', `Estuviste en ${mine} de los ${total} dragones/barones de tu equipo.`);
}
