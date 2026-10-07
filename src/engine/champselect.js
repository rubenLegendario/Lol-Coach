import { ddragon } from '../data/ddragon.js';
import { tierList, getBuild, mainPosition, normPos, POSITIONS, aramTierList, getAramBuild } from '../data/stats.js';
import { evaluateDraft, rankCandidates, factorsView } from './draft.js';
import { buildView, compSummary, pct } from './views.js';

/** Asigna una posición probable a cada campeón enemigo (en ranked el LCU no la da). */
function guessPositions(champIds, tl) {
  const pairs = [];
  for (const id of champIds) {
    for (const pos of POSITIONS) {
      const rr = tl.champions[id]?.[pos]?.roleRate || 0;
      pairs.push({ id, pos, rr });
    }
  }
  pairs.sort((a, b) => b.rr - a.rr);
  const byChamp = new Map();
  const taken = new Set();
  for (const p of pairs) {
    if (byChamp.has(p.id) || taken.has(p.pos) || p.rr < 0.02) continue;
    byChamp.set(p.id, p.pos);
    taken.add(p.pos);
  }
  return byChamp;
}

/**
 * Analiza la sesión de selección de campeón del LCU.
 * Devuelve la vista para el panel y el "plan" (campeón, posición, rival, build) para la partida.
 */
export async function analyzeChampSelect(session, { localMastery = [], getMastery = () => null, customPool = null, champRecord = null } = {}) {
  const tl = await tierList();
  const actions = (session.actions || []).flat();
  const me = session.myTeam.find((p) => p.cellId === session.localPlayerCellId) || {};
  const myPick = actions.find((a) => a.actorCellId === me.cellId && a.type === 'pick');
  const myBan = actions.find((a) => a.actorCellId === me.cellId && a.type === 'ban' && a.isInProgress);
  const myChamp = me.championId || myPick?.championId || me.championPickIntent || 0;
  const locked = !!myPick?.completed;
  const myPos = normPos(me.assignedPosition) || (myChamp ? await mainPosition(myChamp) : null);

  const allies = session.myTeam.map((p) => {
    const champId = p.championId || p.championPickIntent || 0;
    return {
      cellId: p.cellId,
      isMe: p.cellId === me.cellId,
      champId,
      champ: ddragon.champView(champId),
      hovering: !p.championId && !!p.championPickIntent,
      pos: normPos(p.assignedPosition),
      puuid: p.puuid || null,
      name: p.gameName ? `${p.gameName}#${p.tagLine}` : null,
    };
  });

  const enemyIds = new Set(session.theirTeam.map((p) => p.championId).filter(Boolean));
  const enemyCells = new Set(session.theirTeam.map((p) => p.cellId));
  for (const a of actions) if (a.type === 'pick' && a.completed && enemyCells.has(a.actorCellId) && a.championId) enemyIds.add(a.championId);

  const bans = new Set([...(session.bans?.myTeamBans || []), ...(session.bans?.theirTeamBans || [])].filter(Boolean));
  for (const a of actions) if (a.type === 'ban' && a.completed && a.championId) bans.add(a.championId);

  const enemyPos = guessPositions([...enemyIds], tl);
  const enemies = [...enemyIds].map((id) => ({ champId: id, champ: ddragon.champView(id), pos: enemyPos.get(id) || null }));
  const laneOpp = myPos ? enemies.find((e) => e.pos === myPos)?.champId || null : null;

  const unavailable = new Set([...bans, ...enemyIds, ...allies.filter((a) => !a.isMe && a.champId).map((a) => a.champId)]);

  // Modelo de draft: probabilidad de victoria con lo que hay elegido (o en hover) ahora mismo
  const masteryPts = (id) => (id ? localMastery.find((m) => m.championId === id)?.championPoints ?? 0 : null);
  for (const a of allies) if (!a.pos && a.champId) a.pos = await mainPosition(a.champId);
  const draftAllies = allies.map((a) => ({
    champId: a.champId,
    pos: a.isMe ? myPos : a.pos,
    mastery: a.isMe ? masteryPts(a.champId) : getMastery(a.puuid, a.champId),
    label: a.isMe ? 'Tú' : a.name?.split('#')[0] || null,
  }));
  const draftEnemies = enemies.map((e) => ({ champId: e.champId, pos: e.pos, mastery: null }));
  let draft = null;
  try {
    const ev = await evaluateDraft({ allies: draftAllies, enemies: draftEnemies });
    draft = { winProb: pct(ev.winProb), factors: factorsView(ev.factors), scaling: ev.scaling?.text || null };
  } catch (err) {
    console.warn('[draft]', err.message);
  }

  // Picks recomendados: cada candidato se evalúa con el modelo completo y se explica por qué
  let picks = null;
  if (!locked && myPos) {
    const meIndex = allies.findIndex((a) => a.isMe);
    const metaIds = Object.entries(tl.champions)
      .filter(([id, p]) => p[myPos]?.roleRate >= 0.35 && p[myPos]?.play >= 1000 && !unavailable.has(Number(id)))
      .sort((a, b) => b[1][myPos].winRate - a[1][myPos].winRate)
      .slice(0, 12)
      .map(([id]) => Number(id));
    // Tu pool: el que has elegido en "Campeones" para este rol; si no hay, tus campeones con más maestría
    const custom = customPool?.[myPos]?.length ? customPool[myPos] : null;
    const poolIds = custom
      ? custom.filter((id) => !unavailable.has(id))
      : localMastery
        .filter((m) => tl.champions[m.championId]?.[myPos]?.roleRate >= 0.05 && !unavailable.has(m.championId))
        .slice(0, 8)
        .map((m) => m.championId);
    const poolTaken = custom ? custom.filter((id) => unavailable.has(id)).map((id) => ({
      champ: ddragon.champView(id),
      why: bans.has(id) ? 'Baneado' : enemyIds.has(id) ? 'Lo tiene el rival' : 'Lo tiene un aliado',
    })) : [];
    const ids = [...new Set([...poolIds, ...metaIds])];
    const ranked = await rankCandidates({
      allies: draftAllies,
      enemies: draftEnemies,
      meIndex,
      myPos,
      candidates: ids.map((id) => ({ champId: id, mastery: masteryPts(id) })),
    });
    const view = (r) => ({
      champ: ddragon.champView(r.champId),
      winProb: pct(r.winProb),
      delta: draft ? Math.round((r.winProb * 100 - draft.winProb) * 10) / 10 : null,
      reasons: r.reasons,
      masteryPoints: r.mastery,
      inPool: poolIds.includes(r.champId),
      breakdown: r.breakdown,
      record: champRecord ? champRecord(r.champId, laneOpp) : null,
      patchWr: tl.champions[r.champId]?.[myPos]?.winRate != null ? pct(tl.champions[r.champId][myPos].winRate) : null,
    });
    picks = {
      vs: ddragon.champView(laneOpp),
      meta: ranked.filter((r) => metaIds.includes(r.champId) && !poolIds.includes(r.champId)).slice(0, 5).map(view),
      pool: ranked.filter((r) => poolIds.includes(r.champId)).slice(0, custom ? 10 : 5).map(view),
      customPool: !!custom,
      poolTaken,
    };
  }

  // Build del campeón elegido / en hover
  let build = null;
  if (myChamp) {
    try {
      build = await getBuild(myChamp, myPos, laneOpp);
    } catch (err) {
      console.warn('[stats] no se pudo cargar la build:', err.message);
    }
  }

  // Sugerencias de baneo: lo más fuerte de tu línea y lo que más countea a tu campeón
  let banSuggestions = null;
  if (!locked && myPos) {
    // Estadísticas del parche de un campeón (en su rol principal si no se indica)
    const statsOf = (id, pos = null) => {
      const ps = tl.champions[id] || {};
      const p = pos ? ps[pos] : Object.values(ps).sort((a, b) => b.roleRate - a.roleRate)[0];
      return p ? { winRate: pct(p.winRate), banRate: p.banRate != null ? pct(p.banRate) : null, pickRate: pct(p.pickRate), tier: p.tier ?? null } : {};
    };
    const strong = Object.entries(tl.champions)
      .filter(([id, p]) => p[myPos]?.roleRate >= 0.2 && !unavailable.has(Number(id)) && Number(id) !== myChamp)
      .map(([id, p]) => ({ id: Number(id), s: p[myPos].winRate - 0.5 + 0.4 * p[myPos].pickRate + 0.3 * (p[myPos].banRate || 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => ({ champ: ddragon.champView(x.id), ...statsOf(x.id, myPos), reason: 'Fuerte en tu línea' }));
    const counters = (build?.counters || [])
      .filter((c) => c.games >= 100 && c.winRate < 0.48 && !unavailable.has(c.champId))
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 4)
      .map((c) => ({ champ: ddragon.champView(c.champId), ...statsOf(c.champId), vsWinRate: pct(1 - c.winRate), reason: `Gana a ${ddragon.champ(myChamp)?.name} el ${pct(1 - c.winRate)}%` }));
    // Los más baneados del parche (cualquier rol)
    const banOf = (ps) => Object.values(ps).reduce((m, p) => Math.max(m, p.banRate || 0), 0);
    const mostBanned = Object.entries(tl.champions)
      .filter(([id]) => !unavailable.has(Number(id)) && Number(id) !== myChamp)
      .sort((a, b) => banOf(b[1]) - banOf(a[1]))
      .slice(0, 6)
      .map(([id]) => ({ champ: ddragon.champView(Number(id)), ...statsOf(Number(id)), reason: 'De los más baneados del parche' }));
    banSuggestions = { counters, strong, mostBanned };
  }

  const matchups = build
    ? {
        hard: build.counters.filter((c) => c.games >= 100).sort((a, b) => a.winRate - b.winRate).slice(0, 5)
          .map((c) => ({ champ: ddragon.champView(c.champId), winRate: pct(c.winRate) })),
        easy: build.counters.filter((c) => c.games >= 100).sort((a, b) => b.winRate - a.winRate).slice(0, 5)
          .map((c) => ({ champ: ddragon.champView(c.champId), winRate: pct(c.winRate) })),
      }
    : null;

  // Análisis de composiciones
  const allyComp = compSummary(allies.map((a) => a.champId).filter(Boolean));
  const enemyComp = compSummary([...enemyIds]);
  const warnings = [];
  if (allyComp && allyComp.count >= 3) {
    if (allyComp.ad >= 75) warnings.push('Tu equipo es casi todo daño físico (AD): un pick AP haría su build mucho más difícil.');
    if (allyComp.ap >= 75) warnings.push('Tu equipo es casi todo daño mágico (AP): un pick AD equilibraría el daño.');
    if (allyComp.tanks === 0 && allyComp.count >= 4) warnings.push('Tu equipo no tiene tanque/frontline.');
  }
  if (enemyComp && enemyComp.healers.length >= 2) warnings.push(`El rival tiene mucha curación (${enemyComp.healers.join(', ')}): plantéate antiheal pronto.`);

  const phase = session.timer?.phase;
  return {
    view: {
      phase,
      timeLeft: session.timer?.adjustedTimeLeftInPhase ?? null,
      banning: !!myBan,
      locked,
      myPos,
      myChamp: ddragon.champView(myChamp),
      laneOpp: ddragon.champView(laneOpp),
      allies,
      enemies,
      bans: [...bans].map((id) => ddragon.champView(id)).filter(Boolean),
      draft,
      picks,
      banSuggestions,
      build: buildView(build),
      matchups,
      allyComp,
      enemyComp,
      warnings,
    },
    plan: myChamp ? { champId: myChamp, pos: myPos, vs: laneOpp, build } : null,
  };
}

/**
 * Selección de ARAM: no hay posiciones ni baneos. Comparamos tu campeón con los del banquillo
 * (y los de tus aliados, por si te lo cambian) usando el winrate de ARAM.
 */
export async function analyzeAramSelect(session) {
  const tl = await aramTierList();
  const me = session.myTeam.find((p) => p.cellId === session.localPlayerCellId) || {};
  const myChamp = me.championId || 0;
  const bench = (session.benchChampions || []).map((b) => b.championId).filter(Boolean);

  // Cada opción (tu campeón, banquillo, campeones de aliados) evaluada con el modelo de draft
  const meIndex = session.myTeam.findIndex((p) => p.cellId === me.cellId);
  const draftAllies = session.myTeam.map((p) => ({ champId: p.championId || 0, pos: null, mastery: null }));
  const cands = [
    ...(myChamp ? [{ champId: myChamp, where: 'Tu campeón' }] : []),
    ...bench.map((id) => ({ champId: id, where: 'Banquillo' })),
    ...session.myTeam.filter((p) => p.cellId !== me.cellId && p.championId).map((p) => ({ champId: p.championId, where: 'Aliado (pide cambio)' })),
  ];
  const ranked = await rankCandidates({ allies: draftAllies, enemies: [], meIndex, myPos: null, candidates: cands, aram: true });
  const options = ranked.map((r) => ({
    champ: ddragon.champView(r.champId),
    where: r.where,
    winRate: pct(tl[r.champId]?.winRate),
    tier: tl[r.champId]?.tier ?? null,
    winProb: pct(r.winProb),
    reasons: r.reasons,
    score: r.winProb,
  })).filter((o) => o.champ);
  const mine = options.find((o) => o.where === 'Tu campeón');

  const curEval = await evaluateDraft({ allies: draftAllies, enemies: [], aram: true });
  const draft = { winProb: pct(curEval.winProb), factors: factorsView(curEval.factors), scaling: null };

  const best = options[0];
  let advice = null;
  if (best && mine && best !== mine && best.score - mine.score >= 0.01) {
    advice = `${best.champ.name} (${best.where.toLowerCase()}) os daría un ${best.winProb}% de victoria frente al ${mine.winProb}% con tu campeón.`;
  }

  let build = null;
  if (myChamp) {
    try {
      build = await getAramBuild(myChamp);
    } catch (err) {
      console.warn('[stats] build ARAM:', err.message);
    }
  }

  const allies = session.myTeam.map((p) => ({
    cellId: p.cellId,
    isMe: p.cellId === me.cellId,
    champId: p.championId || 0,
    champ: ddragon.champView(p.championId),
    pos: null,
    puuid: p.puuid || null,
    name: p.gameName ? `${p.gameName}#${p.tagLine}` : null,
  }));
  const allyComp = compSummary(allies.map((a) => a.champId).filter(Boolean));
  const warnings = [];
  if (allyComp?.count >= 4) {
    if (allyComp.ad >= 75) warnings.push('Tu equipo es casi todo AD: si puedes, coge un campeón AP del banquillo.');
    if (allyComp.ap >= 75) warnings.push('Tu equipo es casi todo AP: si puedes, coge un campeón AD del banquillo.');
    if (allyComp.tanks === 0) warnings.push('Tu equipo no tiene tanque: uno del banquillo ayudaría mucho.');
  }

  return {
    view: {
      aram: true,
      phase: session.timer?.phase,
      myChamp: ddragon.champView(myChamp),
      rerolls: session.rerollsRemaining ?? null,
      draft,
      options,
      advice,
      allies,
      build: buildView(build),
      allyComp,
      warnings,
    },
    plan: myChamp ? { champId: myChamp, pos: 'ARAM', vs: null, build, aram: true } : null,
  };
}
