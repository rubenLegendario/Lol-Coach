/**
 * Seguimiento de LP. El cliente solo da los LP actuales, así que vamos apuntando una "foto" cada vez
 * que cambian (después de cada partida) en data/lp-history.json, por cuenta y por cola.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.join(path.dirname(config.cacheDir), 'lp-history.json');
const QUEUES = { RANKED_SOLO_5x5: { key: 'solo', label: 'Solo/Dúo', queueId: 420 }, RANKED_FLEX_SR: { key: 'flex', label: 'Flexible', queueId: 440 } };
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};

/** LP "absolutos" para poder dibujar una sola línea: Hierro IV 0 LP = 0, cada división son 100. */
export function absoluteLp(tier, division, lp) {
  if (APEX.includes(tier)) return TIERS.length * 400 + lp;
  const t = TIERS.indexOf(tier);
  if (t < 0) return null;
  return t * 400 + (DIVS[division] ?? 0) * 100 + lp;
}

/** Inverso de absoluteLp: nombre de la división que empieza en ese valor (para las líneas de la gráfica). */
export function divisionLabel(abs) {
  if (abs >= TIERS.length * 400) return 'Maestro+';
  const t = Math.floor(abs / 400);
  const d = Math.floor((abs % 400) / 100);
  return `${TIER_ES[TIERS[t]]} ${['IV', 'III', 'II', 'I'][d]}`;
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
}

/**
 * Lee el rango actual y apunta una entrada nueva si algo cambió.
 * Si entre dos fotos se jugó exactamente una partida, se enlaza con esa partida del historial.
 */
export async function recordLp(lcu, puuid) {
  const stats = await lcu.get(`/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => null);
  if (!stats?.queueMap) return false;
  const data = load();
  const mine = (data[puuid] ||= { solo: [], flex: [] });
  let changed = false;
  let history = null;

  for (const [queueType, q] of Object.entries(QUEUES)) {
    const e = stats.queueMap[queueType];
    if (!e?.tier || e.tier === 'NONE' || e.tier === '') continue;
    const entry = {
      t: Date.now(),
      tier: e.tier,
      division: APEX.includes(e.tier) ? '' : e.division,
      lp: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
      abs: absoluteLp(e.tier, e.division, e.leaguePoints),
    };
    const list = mine[q.key];
    const last = list[list.length - 1];
    if (last && last.abs === entry.abs && last.wins === entry.wins && last.losses === entry.losses) continue;

    if (last) {
      const games = entry.wins + entry.losses - (last.wins + last.losses);
      entry.games = games;
      entry.delta = entry.abs - last.abs;
      if (games === 1) {
        entry.win = entry.wins > last.wins;
        // Enlazamos con la partida más reciente de esa cola que aún no tenga LP apuntados
        history ||= await lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=9`).catch(() => null);
        const used = new Set(list.map((x) => x.gameId).filter(Boolean));
        const g = (history?.games?.games || []).find((x) => x.queueId === q.queueId && !used.has(x.gameId));
        if (g) entry.gameId = g.gameId;
      }
    }
    list.push(entry);
    changed = true;
  }
  if (changed) save(data);
  return changed;
}

/** Datos para la gráfica y el resumen de la pantalla de inicio. */
export function lpSummary(puuid) {
  const mine = load()[puuid] || { solo: [], flex: [] };
  const out = {};
  for (const q of Object.values(QUEUES)) {
    const list = mine[q.key] || [];
    if (!list.length) {
      out[q.key] = { label: q.label, points: [], games: [] };
      continue;
    }
    const now = Date.now();
    const since = (ms) => {
      const base = [...list].reverse().find((x) => x.t <= now - ms) || list[0];
      return list[list.length - 1].abs - base.abs;
    };
    const tracked = list.filter((x) => x.games === 1);
    const cur = list[list.length - 1];
    out[q.key] = {
      label: q.label,
      current: { text: `${TIER_ES[cur.tier]}${cur.division ? ' ' + cur.division : ''}`, tier: cur.tier, lp: cur.lp, abs: cur.abs },
      points: list.map((x) => ({ t: x.t, abs: x.abs, lp: x.lp, tier: x.tier, division: x.division, delta: x.delta ?? null, win: x.win ?? null })),
      peak: Math.max(...list.map((x) => x.abs)),
      peakLabel: (() => { const p = list.reduce((a, b) => (b.abs > a.abs ? b : a)); return `${TIER_ES[p.tier]}${p.division ? ' ' + p.division : ''} · ${p.lp} LP`; })(),
      today: since(24 * 3600_000),
      week: since(7 * 24 * 3600_000),
      avgWin: tracked.filter((x) => x.win).length ? Math.round(tracked.filter((x) => x.win).reduce((s, x) => s + x.delta, 0) / tracked.filter((x) => x.win).length) : null,
      avgLoss: tracked.filter((x) => x.win === false).length ? Math.round(tracked.filter((x) => x.win === false).reduce((s, x) => s + x.delta, 0) / tracked.filter((x) => x.win === false).length) : null,
      trackedSince: list[0].t,
      // Líneas de división que caen dentro del rango de la gráfica
      ticks: (() => {
        const lo = Math.floor((Math.min(...list.map((x) => x.abs)) - 30) / 100) * 100;
        const hi = Math.max(...list.map((x) => x.abs)) + 30;
        const t = [];
        for (let v = Math.max(0, lo); v <= hi; v += 100) t.push({ abs: v, label: divisionLabel(v) });
        return t;
      })(),
      // gameId -> LP ganados/perdidos, para mostrarlo en las partidas recientes
      games: tracked.filter((x) => x.gameId).map((x) => ({ gameId: x.gameId, delta: x.delta })),
    };
  }
  return out;
}
