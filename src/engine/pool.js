/**
 * Asesor de pool de campeones (como el Champion Pool Builder de iTero).
 * Cruza los counters de los campeones más jugados de tu rol con tu pool, encuentra los
 * matchups que tu pool no cubre y recomienda campeones que los tapen.
 */
import { ddragon } from '../data/ddragon.js';
import { tierList, getBuild, POS_LABEL } from '../data/stats.js';
import { cached } from '../util/cache.js';

const pct = (x) => Math.round(x * 1000) / 10;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]).catch(() => null);
    }
  }));
  return out;
}

export async function poolAdvice({ puuid, role, localMastery, recent, custom = null }) {
  const tl = await tierList();
  const inRole = (id, min = 0.1) => (tl.champions[id]?.[role]?.roleRate || 0) >= min;

  // Tu pool real: lo que juegas en tu rol en la Grieta (la maestría también sube en ARAM, así que no basta)
  const played = {};
  for (const g of recent || []) if (g.sr && g.pos === role && !g.remake) played[g.champId] = (played[g.champId] || 0) + 1;
  const total = Object.values(played).reduce((a, b) => a + b, 0);
  let pool = Object.entries(played).filter(([, n]) => n >= 2 || n / Math.max(1, total) >= 0.2).map(([id]) => Number(id));
  if (!pool.length) pool = localMastery.filter((m) => inRole(m.championId, 0.3)).slice(0, 2).map((m) => m.championId);
  pool = custom ? custom.slice(0, 10) : pool.slice(0, 6);
  // Campeones que ya conoces (maestría) aunque no los juegues en ranked: aprenderlos cuesta menos
  const known = new Map(localMastery.filter((m) => m.championPoints >= 20000 && inRole(m.championId, 0.3)).map((m) => [m.championId, m.championPoints]));

  const key = `pool_${puuid}_${role}_${tl.patch}_${pool.join('-')}`;
  return cached(key, 3 * 3600_000, async () => {
    const meta = Object.entries(tl.champions)
      .filter(([, p]) => p[role]?.roleRate >= 0.3 && p[role]?.play >= 800)
      .sort((a, b) => b[1][role].pickRate - a[1][role].pickRate)
      .slice(0, 25)
      .map(([id, p]) => ({ id: Number(id), pickRate: p[role].pickRate }));

    // Counters de cada rival del meta (desde su lado, invertimos para ver los nuestros)
    const builds = await mapLimit(meta, 5, (m) => getBuild(m.id, role));
    const wrVs = new Map(); // "candidato:rival" -> winrate del candidato
    meta.forEach((m, i) => {
      for (const c of builds[i]?.counters || []) if (c.games >= 60) wrVs.set(`${c.champId}:${m.id}`, { wr: 1 - c.winRate, games: c.games });
    });

    const coverage = meta.filter((m) => !pool.includes(m.id)).map((m) => {
      const answers = pool.map((p) => ({ id: p, ...(wrVs.get(`${p}:${m.id}`) || {}) })).filter((a) => a.wr != null).sort((a, b) => b.wr - a.wr);
      const best = answers[0] || null;
      return { enemy: m.id, pickRate: m.pickRate, best, covered: !!best && best.wr >= 0.5 };
    });
    const totalWeight = coverage.reduce((s, c) => s + c.pickRate, 0) || 1;
    const coveredWeight = coverage.filter((c) => c.covered).reduce((s, c) => s + c.pickRate, 0);
    const holes = coverage.filter((c) => !c.covered);

    // Candidatos: campeones del meta de tu rol que no están en tu pool
    const candidates = Object.entries(tl.champions)
      // Campeones propios del rol (en ADC, solo tiradores): nada de picks raros fuera de su posición
      .filter(([id, p]) => !pool.includes(Number(id)) && p[role]?.roleRate >= 0.5 && p[role]?.play >= 1000 && (role !== 'BOTTOM' || ddragon.champ(Number(id))?.tags?.includes('Marksman')))
      .map(([id, p]) => {
        const cid = Number(id);
        const wins = holes.map((h) => ({ enemy: h.enemy, pickRate: h.pickRate, ...(wrVs.get(`${cid}:${h.enemy}`) || {}) })).filter((x) => x.wr != null && x.wr >= 0.51);
        const info = ddragon.champ(cid)?.info || {};
        const base = p[role].winRate;
        const mastery = known.get(cid) || 0;
        const score = wins.reduce((s, w) => s + w.pickRate * (w.wr - 0.5) * 100, 0) + (base - 0.5) * 40 - Math.max(0, (info.difficulty || 5) - 6) * 0.15 + (mastery >= 100000 ? 0.6 : mastery >= 20000 ? 0.3 : 0);
        return { cid, wins, base, mastery, difficulty: info.difficulty || null, tier: p[role].tier, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((c) => {
        const reasons = [];
        if (c.wins.length) {
          const names = c.wins.sort((a, b) => b.pickRate - a.pickRate).slice(0, 3).map((w) => `${ddragon.champ(w.enemy)?.name} (${pct(w.wr)}%)`);
          reasons.push({ type: 'good', text: `Gana a ${names.join(', ')}: matchups que tu pool pierde` });
        }
        if (c.mastery) reasons.push({ type: 'good', text: `Ya lo conoces: ${Math.round(c.mastery / 1000)}k puntos de maestría` });
        if (c.base >= 0.51) reasons.push({ type: 'good', text: `Está fuerte este parche (${pct(c.base)}% de victorias)` });
        if (c.difficulty != null) reasons.push({ type: c.difficulty <= 4 ? 'good' : c.difficulty >= 8 ? 'warn' : 'info', text: `Dificultad ${c.difficulty <= 4 ? 'baja' : c.difficulty >= 8 ? 'alta: necesita práctica' : 'media'} (${c.difficulty}/10)` });
        return { champ: ddragon.champView(c.cid), tier: c.tier, winRate: pct(c.base), covers: c.wins.length, coversList: c.wins.map((w) => ({ champ: ddragon.champView(w.enemy), wr: pct(w.wr) })), mastery: c.mastery, reasons };
      });

    return {
      role,
      roleLabel: POS_LABEL[role],
      pool: pool.map((id) => ({ champ: ddragon.champView(id), mastery: localMastery.find((m) => m.championId === id)?.championPoints || 0, games: played[id] || 0 })),
      gamesAnalyzed: total,
      coveragePct: Math.round((coveredWeight / totalWeight) * 100),
      coverage: coverage.sort((a, b) => b.pickRate - a.pickRate).map((c) => ({
        enemy: ddragon.champView(c.enemy),
        pickRate: pct(c.pickRate),
        covered: c.covered,
        best: c.best ? { champ: ddragon.champView(c.best.id), wr: pct(c.best.wr) } : null,
      })),
      holes: holes.length,
      recommendations: candidates,
    };
  });
}
