/**
 * Objetivo de rango: progreso, plan hasta la fecha límite y estimación por simulación.
 *
 * La simulación juega muchas "temporadas" posibles con tus LP reales por victoria/derrota y tu winrate.
 * El winrate no se toma como fijo: se sortea en cada simulación según lo seguro que es (pocas partidas =
 * más incertidumbre), mezclando tus últimas ranked con tu récord de la temporada. El ritmo (partidas/día)
 * sale de tus partidas de los últimos 14 días. Es una estimación: no contempla cambios de LP por MMR,
 * el escudo de descenso ni que juegues más o menos de lo habitual.
 */
import { absoluteLp, divisionLabel } from '../lp.js';

const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};
const QUEUE_ID = { solo: 420, flex: 440 };
const DAY = 86_400_000;
const SIMS = 2000;
const MAX_GAMES = 1000; // más allá de esto lo damos por "no llegas a este ritmo"
const CONE_GAMES = 300; // hasta dónde guardamos trayectorias para la banda de la gráfica
const RECENT = 30; // partidas recientes que cuentan para el winrate
const PRIOR_MAX = 40; // cuánto pesa como mucho el récord de la temporada (en partidas equivalentes)
const PACE_DAYS = 14;

/** "Oro I · 20 LP" a partir de LP absolutos. */
export function absLabel(abs) {
  const base = Math.floor(abs / 100) * 100;
  return `${divisionLabel(Math.min(base, 2800))} · ${abs >= 2800 ? abs - 2800 : abs - base} LP`;
}

// ---------- Aleatorio reproducible (mismo resultado para los mismos datos: la cifra no baila al refrescar) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Gamma(k, 1) por Marsaglia-Tsang (k ≥ 1, que es nuestro caso). */
function gamma(k, rand) {
  if (k < 1) return gamma(k + 1, rand) * Math.pow(rand(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(a, b, rand) {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Winrate esperado y su incertidumbre (parámetros de una Beta). */
export function winModel(recent, season) {
  const wins = recent.filter((g) => g.win).length;
  const n = recent.length;
  const sGames = season ? season.wins + season.losses : 0;
  const prior = sGames ? Math.min(PRIOR_MAX, sGames) : 20;
  const prior0 = sGames ? season.wins / sGames : 0.5;
  const a = wins + prior * prior0;
  const b = n - wins + prior * (1 - prior0);
  return { a, b, mean: a / (a + b), recentGames: n, recentWins: wins, seasonGames: sGames };
}

/** Partidas al día de esa cola en los últimos 14 días (o desde la partida más antigua que tengamos). */
export function paceOf(games, queueId, now) {
  if (!games.length) return null;
  const oldest = Math.min(...games.map((g) => g.date));
  const days = Math.min(PACE_DAYS, Math.max(1, (now - oldest) / DAY));
  const n = games.filter((g) => g.queueId === queueId && now - g.date <= days * DAY).length;
  return n ? { perDay: n / days, games: n, days: Math.round(days) } : null;
}

/** Simulación de Monte Carlo: partidas hasta llegar y trayectorias de LP. */
export function simulate({ cur, target, win, loss, model, sims = SIMS, seed = 1 }) {
  const rand = rng(seed);
  const reach = [];
  const traj = new Float32Array(sims * (CONE_GAMES + 1));
  for (let s = 0; s < sims; s++) {
    const p = beta(model.a, model.b, rand);
    let lp = cur;
    let hit = cur >= target ? 0 : null;
    traj[s * (CONE_GAMES + 1)] = lp;
    for (let g = 1; g <= MAX_GAMES && (hit == null || g <= CONE_GAMES); g++) {
      lp = Math.max(0, lp + (rand() < p ? win : -loss));
      if (hit == null && lp >= target) hit = g;
      if (g <= CONE_GAMES) traj[s * (CONE_GAMES + 1) + g] = lp;
    }
    reach.push(hit ?? Infinity);
  }
  reach.sort((a, b) => a - b);
  const at = (g, p) => {
    const col = [];
    for (let s = 0; s < sims; s++) col.push(traj[s * (CONE_GAMES + 1) + g]);
    col.sort((a, b) => a - b);
    return pct(col, p);
  };
  return { reach, at, sims };
}

/**
 * @param goal  objetivo guardado { queue, tier, division, deadline, startAbs, createdAt }
 * @param q     resumen de LP de esa cola (lpSummary)
 * @param games partidas archivadas (todas las colas, con date, queueId, win, remake)
 * @param season récord de la temporada { wins, losses } (puede faltar)
 */
export function buildGoal(goal, q, { games = [], season = null, now = Date.now(), sims = SIMS } = {}) {
  if (!goal) return null;
  const target = absoluteLp(goal.tier, goal.division || 'IV', 0);
  const label = `${TIER_ES[goal.tier] || goal.tier}${APEX.includes(goal.tier) ? '' : ' ' + (goal.division || 'IV')}`;
  if (!q?.current || target == null) return { ...goal, label, noData: true };

  const cur = q.current.abs;
  const start = goal.startAbs ?? cur;
  const createdAt = goal.createdAt ?? now;
  const need = Math.max(0, target - cur);
  const out = {
    ...goal,
    label,
    target,
    targetLabel: absLabel(target),
    cur,
    start,
    createdAt,
    done: need === 0,
    need,
    progress: target > start ? Math.max(0, Math.min(100, Math.round(((cur - start) / (target - start)) * 100))) : 100,
    daysLeft: goal.deadline ? Math.max(0, Math.ceil((goal.deadline - now) / DAY)) : null,
  };
  if (out.done) return out;

  // ---------- Entradas del modelo ----------
  const queueId = QUEUE_ID[goal.queue || 'solo'];
  const valid = games.filter((g) => g && !g.remake && g.date);
  const recent = valid.filter((g) => g.queueId === queueId).sort((a, b) => b.date - a.date).slice(0, RECENT);
  const model = winModel(recent, season);
  const lpKnown = q.avgWin != null && q.avgLoss != null;
  const W = q.avgWin ?? 20;
  const L = Math.abs(q.avgLoss ?? -20);
  const pace = paceOf(valid, queueId, now);
  out.model = {
    winRate: Math.round(model.mean * 1000) / 10,
    recentGames: model.recentGames,
    recentWins: model.recentWins,
    seasonGames: model.seasonGames,
    lpWin: W,
    lpLoss: -L,
    lpKnown,
    pace: pace ? Math.round(pace.perDay * 10) / 10 : null,
    paceGames: pace?.games ?? 0,
    paceDays: pace?.days ?? null,
    sims,
  };
  out.breakEven = Math.round((L / (W + L)) * 100);
  out.netWins = Math.ceil(need / ((W + L) / 2));

  // ---------- Simulación ----------
  const sim = simulate({ cur, target, win: W, loss: L, model, sims, seed: (cur * 7919 + target * 31 + W * 17 + L + recent.length * 131) | 0 });
  const reachable = sim.reach.filter((x) => x !== Infinity).length / sims;
  out.reachProb = Math.round(reachable * 100);
  out.games = reachable >= 0.5 ? { p20: pct(sim.reach, 0.2), p50: pct(sim.reach, 0.5), p80: reachable >= 0.8 ? pct(sim.reach, 0.8) : null } : null;

  if (pace) {
    const perDay = pace.perDay;
    const dateOf = (n) => (n === Infinity || n == null ? null : now + (n / perDay) * DAY);
    if (out.games) out.eta = { p20: dateOf(out.games.p20), p50: dateOf(out.games.p50), p80: dateOf(out.games.p80) };
    if (goal.deadline) {
      const avail = Math.floor(perDay * Math.max(0, (goal.deadline - now) / DAY));
      out.gamesAvail = avail;
      out.onTimeProb = Math.round((sim.reach.filter((x) => x <= avail).length / sims) * 100);
    }
  }
  if (goal.deadline && out.daysLeft > 0) {
    // Partidas al día para tener un 80% de llegar a tiempo
    const g80 = pct(sim.reach, 0.8);
    out.perDayFor80 = g80 !== Infinity ? Math.ceil((g80 / out.daysLeft) * 10) / 10 : null;
  }

  // ---------- Plan (línea recta desde que te pusiste el objetivo hasta la fecha) ----------
  if (goal.deadline && goal.deadline > createdAt) {
    const planAt = (t) => Math.round(start + ((target - start) * Math.min(1, Math.max(0, (t - createdAt) / (goal.deadline - createdAt)))));
    const planNow = planAt(now);
    // Hito: domingo de esta semana a las 23:59 (o la fecha límite si llega antes)
    const d = new Date(now);
    d.setHours(23, 59, 0, 0);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    const mt = Math.min(d.getTime(), goal.deadline);
    out.plan = {
      now: planNow,
      diff: cur - planNow,
      milestone: { t: mt, abs: planAt(mt), label: absLabel(planAt(mt)), need: Math.max(0, planAt(mt) - cur) },
    };
  }

  // ---------- Datos de la gráfica ----------
  const hist = (q.points || []).filter((p) => p.t >= createdAt).map((p) => ({ t: p.t, abs: p.abs, win: p.win }));
  if (!hist.length || hist[0].t > createdAt) hist.unshift({ t: createdAt, abs: start, win: null });
  if (hist[hist.length - 1].abs !== cur) hist.push({ t: now, abs: cur, win: null });
  const cone = [];
  if (pace) {
    const endT = goal.deadline ?? out.eta?.p80 ?? out.eta?.p50 ?? now + 30 * DAY;
    const horizon = Math.min(CONE_GAMES, Math.max(1, Math.round(((endT - now) / DAY) * pace.perDay)));
    const steps = Math.min(24, horizon);
    for (let i = 0; i <= steps; i++) {
      const g = Math.round((i / steps) * horizon);
      // Media con la partida de al lado: los LP van a saltos de una victoria/derrota y la banda saldría en zigzag
      const sm = (p) => (g === 0 ? sim.at(0, p) : Math.round((sim.at(g, p) + sim.at(Math.max(1, g - 1), p) + sim.at(Math.min(CONE_GAMES, g + 1), p)) / 3));
      cone.push({ t: now + (g / pace.perDay) * DAY, games: g, p20: sm(0.2), p50: sm(0.5), p80: sm(0.8) });
    }
  }
  out.chart = { hist, cone, now };
  return out;
}
