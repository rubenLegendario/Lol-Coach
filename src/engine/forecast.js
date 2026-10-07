/**
 * Previsión de rango (al estilo de DeepLoL).
 *
 * 1) Nivel de juego: compara tus medias por partida (en tu rol principal) con lo habitual en cada rango
 *    y calcula a qué rango corresponde cómo juegas.
 * 2) Proyección: con tus LP por victoria/derrota reales, tu winrate reciente (suavizado) y tu nivel de juego,
 *    estima cuántas partidas te faltan para subir y dónde estarías dentro de 20 y 50 partidas.
 *
 * Las referencias por rango son medias aproximadas de SoloQ (EUW, temporadas recientes) para Hierro y Maestro+;
 * los rangos intermedios se interpolan. Es una estimación orientativa, no un dato oficial de Riot.
 */
import { absoluteLp, divisionLabel } from '../lp.js';

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'];
const TIER_ES = { IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Maestro+' };
const POS_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

// [Hierro, Maestro+] por rol
const BENCH = {
  BOTTOM: { csMin: [5.0, 8.4], deaths: [6.6, 5.0], kda: [2.1, 3.0], dmgMin: [480, 820], goldMin: [360, 470], visionMin: [0.3, 0.65] },
  MIDDLE: { csMin: [4.9, 8.2], deaths: [6.4, 4.9], kda: [2.2, 3.1], dmgMin: [500, 850], goldMin: [350, 455], visionMin: [0.32, 0.75] },
  TOP: { csMin: [4.7, 7.8], deaths: [6.0, 4.9], kda: [1.9, 2.6], dmgMin: [450, 720], goldMin: [340, 440], visionMin: [0.3, 0.7] },
  JUNGLE: { csMin: [4.0, 6.5], deaths: [6.2, 4.8], kda: [2.3, 3.3], dmgMin: [330, 560], goldMin: [330, 430], visionMin: [0.45, 1.05] },
  UTILITY: { csMin: [0.9, 1.4], deaths: [6.4, 5.1], kda: [2.2, 3.3], dmgMin: [220, 420], goldMin: [230, 300], visionMin: [1.0, 2.4] },
};
// El CS y el oro son lo que más separa a unos rangos de otros; muertes y KDA dependen mucho de cada partida
const WEIGHTS = { csMin: 0.3, deaths: 0.1, kda: 0.15, dmgMin: 0.15, goldMin: 0.2, visionMin: 0.1 };
const WEIGHTS_SUP = { csMin: 0, deaths: 0.15, kda: 0.2, dmgMin: 0.1, goldMin: 0.2, visionMin: 0.35 };
// Cuánto pesa el nivel en estadísticas frente a tu rango actual (que ya refleja cientos de partidas)
const SKILL_PULL = 0.4;
const LABELS = { csMin: 'CS/min', deaths: 'Muertes', kda: 'KDA', dmgMin: 'Daño/min', goldMin: 'Oro/min', visionMin: 'Visión/min' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Posición continua en la escala de rangos: 0 = Hierro IV … 7 = Maestro+. */
function scaleOf(v, [lo, hi]) {
  return clamp(((v - lo) / (hi - lo)) * 7, -0.4, 7.6);
}

/** 0-7 → { tier, label } (Oro II, Maestro+…). */
function scaleLabel(t) {
  if (t >= 7) return { tier: 'MASTER', label: 'Maestro+', abs: 2800 };
  const x = clamp(t, 0, 6.999);
  const tier = Math.floor(x);
  const div = Math.floor((x - tier) * 4);
  return { tier: TIERS[tier], label: `${TIER_ES[TIERS[tier]]} ${['IV', 'III', 'II', 'I'][div]}`, abs: Math.round(x * 400) };
}

const absLabel = (abs) => {
  if (abs >= 2800) return 'Maestro+';
  const a = Math.max(0, abs);
  return `${divisionLabel(Math.floor(a / 100) * 100)} · ${Math.round(a % 100)} LP`;
};
const absTier = (abs) => (abs >= 2800 ? 'MASTER' : TIERS[Math.floor(Math.max(0, abs) / 400)]);

/**
 * Lo habitual en un rango (LP absolutos) para tu rol: CS/min, KDA y visión/min.
 * Para la comparativa en directo del overlay. Es una referencia orientativa (ver BENCH).
 */
export function benchAt(role, abs) {
  const b = BENCH[role] || BENCH.MIDDLE;
  const t = clamp(abs / 400, 0, 7);
  const at = (k) => b[k][0] + ((b[k][1] - b[k][0]) * t) / 7;
  return { tier: absTier(abs), tierLabel: TIER_ES[absTier(abs)], csMin: at('csMin'), kda: at('kda'), visionMin: at('visionMin') };
}

export function buildForecast(profile, lp, { other = false } = {}) {
  const T = other
    ? { stats: 'Sus estadísticas', recent: 'Sus estadísticas recientes', rank: 'su rango', where: 'donde está', keep: 'mantenerse', drop: 'Puede bajar.', fits: 'Su rango refleja su nivel de juego: su previsión es mantenerse en' }
    : { stats: 'Tus estadísticas', recent: 'Tus estadísticas recientes', rank: 'tu rango', where: 'donde estás', keep: 'mantenerte', drop: 'Cuidado con bajar.', fits: 'Tu rango refleja tu nivel de juego: tu previsión es mantenerte en' };
  const rows = (profile?.recent || []).filter((g) => !g.remake && g.sr);
  const ranked = rows.filter((g) => g.ranked);
  let games = ranked.length >= 5 ? ranked : rows;
  if (games.length < 3) return null;

  // Rol principal; si hay suficientes partidas en él, solo esas
  const count = {};
  for (const g of games) if (g.pos) count[g.pos] = (count[g.pos] || 0) + 1;
  const role = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MIDDLE';
  const inRole = games.filter((g) => g.pos === role);
  if (inRole.length >= 5) games = inRole;
  const n = games.length;
  const bench = BENCH[role] || BENCH.MIDDLE;
  const weights = role === 'UTILITY' ? WEIGHTS_SUP : WEIGHTS;

  const avg = (f) => games.reduce((s, g) => s + f(g), 0) / n;
  const values = {
    csMin: avg((g) => g.csMin),
    deaths: avg((g) => g.d),
    kda: games.reduce((s, g) => s + g.k + g.a, 0) / Math.max(1, games.reduce((s, g) => s + g.d, 0)),
    dmgMin: avg((g) => g.dmgMin),
    goldMin: avg((g) => g.goldMin),
    visionMin: avg((g) => g.visionMin),
  };
  const fmt = { csMin: (v) => v.toFixed(1), deaths: (v) => v.toFixed(1), kda: (v) => v.toFixed(2), dmgMin: (v) => Math.round(v), goldMin: (v) => Math.round(v), visionMin: (v) => v.toFixed(2) };

  let sum = 0, wsum = 0;
  const metrics = Object.keys(weights).filter((k) => weights[k] > 0).map((k) => {
    const t = scaleOf(values[k], bench[k]);
    sum += t * weights[k];
    wsum += weights[k];
    return { key: k, label: LABELS[k], value: fmt[k](values[k]), t: Math.round(t * 100) / 100, tier: scaleLabel(t).label, lowerIsBetter: k === 'deaths' };
  });
  const skillT = sum / wsum;
  const skill = scaleLabel(skillT);
  const sorted = [...metrics].sort((a, b) => b.t - a.t);

  // Rango actual (Solo/Dúo)
  const solo = profile.ranks?.find((r) => r.queue === 'Solo/Dúo' && r.tier) || profile.ranks?.find((r) => r.tier) || null;
  const q = lp?.solo;
  const curAbs = q?.current?.abs ?? (solo ? absoluteLp(solo.tier, solo.division, solo.lp || 0) : null);
  const current = curAbs != null ? { abs: curAbs, tier: solo?.tier || absTier(curAbs), label: solo ? `${solo.text} · ${solo.lp} LP` : absLabel(curAbs) } : null;
  // Rango previsto: tu rango actual se desplaza hacia tu nivel de juego (las estadísticas no lo explican todo)
  const predicted = current ? (() => {
    const abs = Math.round(curAbs + (Math.min(skill.abs, 2800) - Math.min(curAbs, 2800)) * SKILL_PULL * (n >= 15 ? 1 : n >= 8 ? 0.75 : 0.5));
    return { abs, tier: absTier(abs), label: abs >= 2800 ? 'Maestro+' : divisionLabel(Math.floor(abs / 100) * 100) };
  })() : null;
  const diffDivs = current ? Math.round((predicted.abs - curAbs) / 100) : null;

  // Proyección de LP
  let projection = null;
  if (current) {
    const rw = ranked.filter((g) => g.win).length;
    const shrunk = (rw + 5) / (ranked.length + 10); // suaviza rachas con pocas partidas
    const expected = 0.5 + clamp((diffDivs || 0) * 0.008, -0.05, 0.05); // si juegas por encima de tu rango, tiendes a ganar más
    const wr = 0.6 * shrunk + 0.4 * expected;
    const assumed = q?.avgWin == null || q?.avgLoss == null;
    const W = q?.avgWin ?? 20;
    const L = Math.abs(q?.avgLoss ?? -20);
    const perGame = wr * W - (1 - wr) * L;
    const apex = curAbs >= 2800;
    const need = apex ? null : 100 - (curAbs % 100);
    const at = (games) => {
      const abs = Math.max(0, Math.round(curAbs + perGame * games));
      return { abs, label: absLabel(abs), tier: absTier(abs) };
    };
    projection = {
      wr: Math.round(wr * 1000) / 10,
      W, L, assumed,
      perGame: Math.round(perGame * 10) / 10,
      nextDiv: need != null && perGame > 0.3 ? { label: divisionLabel(curAbs - (curAbs % 100) + 100), games: Math.ceil(need / perGame) } : null,
      in20: at(20),
      in50: at(50),
    };
  }

  let mmr = null;
  if (q?.avgWin != null && q?.avgLoss != null) {
    const d = q.avgWin - Math.abs(q.avgLoss);
    mmr = d >= 4 ? { type: 'good', text: `Tu MMR está por encima de tu rango: ganas +${q.avgWin} y pierdes ${q.avgLoss}. Subirás rápido si mantienes el winrate.` }
      : d <= -4 ? { type: 'bad', text: `Tu MMR está por debajo de tu rango: ganas +${q.avgWin} y pierdes ${q.avgLoss}. Necesitas ganar más de la mitad para no bajar.` }
      : { type: 'info', text: `Tu MMR está en línea con tu rango (+${q.avgWin} / ${q.avgLoss}).` };
  }

  const verdict = diffDivs == null ? `${T.stats} son de nivel ${skill.label}.`
    : diffDivs >= 1 ? `${T.stats} son de ${skill.label}: rango previsto ${predicted.label}, ${diffDivs === 1 ? 'una división' : diffDivs + ' divisiones'} por encima de ${T.where}.`
    : diffDivs <= -1 ? `${T.recent} son de ${skill.label}, por debajo de ${T.rank}: previsión ${predicted.label}. ${T.drop}`
    : `${T.fits} ${predicted.label}.`;

  return {
    role, roleLabel: POS_ES[role] || role, games: n,
    confidence: n >= 15 ? 'alta' : n >= 8 ? 'media' : 'baja',
    skill: { ...skill, t: Math.round(skillT * 100) / 100 },
    current, predicted, diffDivs, verdict, metrics,
    best: sorted[0], worst: sorted[sorted.length - 1],
    projection, mmr,
  };
}
