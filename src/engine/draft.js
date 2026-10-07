/**
 * Modelo de probabilidad de victoria del draft, al estilo de iTero.
 *
 * Probabilidad = 50% + suma de factores, cada uno en "puntos de winrate" a favor de tu equipo:
 *  - Fuerza de cada campeón en su posición este parche (winrate de OP.GG, suavizado por nº de partidas).
 *  - Enfrentamientos de línea: lo que el matchup aporta POR ENCIMA de lo que ya explica la fuerza de cada campeón.
 *  - Sinergias entre aliados (top parejas de OP.GG), también solo la parte no explicada por la fuerza individual.
 *  - Experiencia del jugador con su campeón (estudio de iTero sobre 1M de partidas: <10k de maestría ≈ 44% WR,
 *    10k-50k ≈ 50%, >50k ≈ 51,8%; el efecto es mayor en jungla y menor en ADC).
 *  - Composición: daño muy desequilibrado (todo AP/todo AD) o sin frontline.
 */
import { ddragon } from '../data/ddragon.js';
import { champProfile } from '../data/champinfo.js';
import { tierList, aramTierList, getBuild, synergies, POS_LABEL } from '../data/stats.js';
import { compSummary } from './views.js';

const ROLE_MASTERY_WEIGHT = { JUNGLE: 1.3, BOTTOM: 0.5 };
const name = (id) => ddragon.champ(id)?.name || '?';

function masteryText(p, v) {
  const champ = name(p.champId);
  const pts = p.mastery >= 1000 ? `${Math.round(p.mastery / 1000)}k pts` : `${p.mastery} pts`;
  const me = p.label === 'Tú';
  const who = p.label || `El ${champ}`;
  if (v > 0) return me ? `Dominas a ${champ} (${pts})` : `${who} domina a ${champ} (${pts})`;
  if (!p.mastery) return me ? `Nunca has jugado ${champ}` : `${who} nunca ha jugado ${champ}`;
  return me ? `Tienes poca experiencia con ${champ} (${pts})` : `${who} tiene poca experiencia con ${champ} (${pts})`;
}

function masteryEffect(points, pos) {
  if (points == null) return 0;
  const w = ROLE_MASTERY_WEIGHT[pos] || 1;
  if (points < 10000) return -0.04 * w;
  if (points >= 50000) return 0.015 * w;
  return 0;
}

const sum = (fs) => fs.reduce((s, f) => s + f.value, 0);

function compFactors(team, sign, who) {
  team = team.filter((p) => p.champId);
  const c = compSummary(team.map((p) => p.champId));
  const out = [];
  if (!c || c.count < 4) return out;
  if (c.ap <= 15) out.push({ kind: 'comp', value: -0.015 * sign, text: `${who} hace casi todo daño físico: fácil de itemizar contra él` });
  if (c.ap >= 85) out.push({ kind: 'comp', value: -0.015 * sign, text: `${who} hace casi todo daño mágico: fácil de itemizar contra él` });
  if (c.tanks === 0) out.push({ kind: 'comp', value: -0.01 * sign, text: `${who} no tiene frontline` });
  return out;
}

/** Curva de escalado de un campeón: winrate en partidas largas menos en partidas cortas. */
function scalingOf(build) {
  const l = build?.lengths || [];
  const early = l.find((x) => x.minutes === 25) || l[0];
  const late = l[l.length - 1];
  return early && late ? late.winRate - early.winRate : 0;
}

/**
 * @param allies/enemies [{ champId, pos, mastery (puntos o null) }]
 * @param candidate id de campeón que estamos probando (no se descargan sus sinergias para ir rápido)
 */
export async function evaluateDraft({ allies, enemies, aram = false, candidate = null }) {
  allies = allies.filter((p) => p.champId);
  enemies = enemies.filter((p) => p.champId);
  const factors = [];
  const add = (f) => {
    if (Math.abs(f.value) >= 0.002) factors.push(f);
  };

  if (aram) {
    const tl = await aramTierList();
    for (const [team, sign] of [[allies, 1], [enemies, -1]]) {
      for (const p of team) {
        const s = tl[p.champId];
        if (!s) continue;
        const v = (s.winRate - 0.5) * (s.play / (s.play + 3000));
        add({ kind: 'strength', champs: [p.champId], value: v * sign, text: `${name(p.champId)} ${v >= 0 ? 'es fuerte' : 'es flojo'} en ARAM (${(s.winRate * 100).toFixed(1)}%)` });
      }
    }
  } else {
    const tl = await tierList();
    const base = (p) => tl.champions[p.champId]?.[p.pos];

    // Fuerza en el parche
    for (const [team, sign] of [[allies, 1], [enemies, -1]]) {
      for (const p of team) {
        const b = base(p);
        if (!b) continue;
        const v = (b.winRate - 0.5) * (b.play / (b.play + 3000));
        add({ kind: 'strength', champs: [p.champId], value: v * sign, text: `${name(p.champId)} ${v >= 0 ? 'está fuerte' : 'está flojo'} en ${POS_LABEL[p.pos] || '?'} este parche (${(b.winRate * 100).toFixed(1)}%)` });
      }
    }

    // Enfrentamientos de línea (vía los counters del rival, que sirven para cualquier candidato)
    for (const a of allies) {
      const e = enemies.find((x) => x.pos && x.pos === a.pos);
      if (!e || !a.pos) continue;
      const eb = await getBuild(e.champId, e.pos).catch(() => null);
      const c = eb?.counters.find((x) => x.champId === a.champId);
      if (!c || c.games < 50) continue;
      const mu = 1 - c.winRate;
      const expected = 0.5 + ((base(a)?.winRate ?? 0.5) - 0.5) - ((base(e)?.winRate ?? 0.5) - 0.5);
      const v = (mu - expected) * (c.games / (c.games + 400));
      add({ kind: 'matchup', champs: [a.champId, e.champId], value: v, text: `${name(a.champId)} ${v >= 0 ? 'gana' : 'pierde'} el matchup contra ${name(e.champId)} (${(mu * 100).toFixed(1)}%)` });
    }

    // Sinergias
    for (const [team, sign, who] of [[allies, 1, 'tu equipo'], [enemies, -1, 'el rival']]) {
      const lists = new Map();
      for (const p of team) if (p.pos && p.champId !== candidate) lists.set(p.champId, await synergies(p.champId, p.pos));
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const a = team[i], b = team[j];
          if (!a.pos || !b.pos) continue;
          const s = lists.get(a.champId)?.get(`${b.champId}:${b.pos}`) || lists.get(b.champId)?.get(`${a.champId}:${a.pos}`);
          if (!s) continue;
          const expected = 0.5 + ((base(a)?.winRate ?? 0.5) - 0.5) + ((base(b)?.winRate ?? 0.5) - 0.5);
          // Peso reducido: OP.GG solo da las ~10 parejas más populares (muestra sesgada)
          const v = 0.5 * (s.winRate - expected) * (s.games / (s.games + 1000));
          add({ kind: 'synergy', champs: [a.champId, b.champId], value: v * sign, text: `${name(a.champId)} y ${name(b.champId)} combinan ${v >= 0 ? 'bien' : 'mal'}${sign < 0 ? ' (rival)' : ''} (${(s.winRate * 100).toFixed(1)}% juntos)` });
        }
      }
    }
  }

  // Experiencia con el campeón
  for (const [team, sign] of [[allies, 1], [enemies, -1]]) {
    for (const p of team) {
      const v = masteryEffect(p.mastery, aram ? null : p.pos);
      if (!v) continue;
      add({ kind: 'mastery', champs: [p.champId], value: v * sign, text: masteryText(p, v) });
    }
  }

  // Composición
  for (const f of [...compFactors(allies, 1, 'Tu equipo'), ...compFactors(enemies, -1, 'El rival')]) add(f);

  const total = factors.reduce((s, f) => s + f.value, 0);
  const winProb = Math.min(0.7, Math.max(0.3, 0.5 + total));
  factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  // Escalado (no suma a la probabilidad, es un consejo de plan de juego)
  let scaling = null;
  if (!aram && !candidate && allies.length >= 3 && enemies.length >= 3) {
    const avg = async (team) => {
      const vals = await Promise.all(team.filter((p) => p.pos).map((p) => getBuild(p.champId, p.pos).then(scalingOf).catch(() => 0)));
      return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
    };
    const [a, e] = await Promise.all([avg(allies), avg(enemies)]);
    const d = a - e;
    scaling = {
      diff: d,
      text: Math.abs(d) < 0.008 ? 'Los dos equipos escalan parecido.'
        : d > 0 ? 'Tu equipo escala mejor: juega seguro al principio y busca alargar la partida.'
        : 'El rival escala mejor: intentad ganar ventaja pronto y cerrar antes del minuto 30.',
    };
  }

  return { winProb, factors, scaling };
}

/** Prepara la vista de los factores (porcentajes legibles). */
export function factorsView(factors, limit = 8) {
  return factors.slice(0, limit).map((f) => ({ kind: f.kind, text: f.text, value: Math.round(f.value * 1000) / 10 }));
}

/**
 * Evalúa candidatos para tu hueco: probabilidad del draft si eliges cada uno y las razones
 * que más lo explican (solo los factores en los que participa el candidato).
 */
export async function rankCandidates({ allies, enemies, meIndex, myPos, candidates, aram = false }) {
  const results = [];
  for (const c of candidates) {
    const team = allies.map((p, i) => (i === meIndex ? { ...p, champId: c.champId, pos: myPos, mastery: c.mastery ?? null } : p));
    const ev = await evaluateDraft({ allies: team, enemies, aram, candidate: c.champId });
    const reasons = ev.factors.filter((f) => f.champs?.includes(c.champId));
    // ¿Equilibra o desequilibra la composición respecto a no tenerlo?
    const others = team.filter((_, i) => i !== meIndex && team[i].champId);
    const compDelta = sum(compFactors(team.filter((p) => p.champId), 1, '')) - sum(compFactors([...others, { champId: 0 }], 1, ''));
    if (others.length >= 3 && Math.abs(compDelta) >= 0.005) {
      reasons.push({ kind: 'comp', value: compDelta, text: compDelta > 0 ? 'Equilibra el daño/frontline de tu equipo' : 'Desequilibra la composición de tu equipo' });
    }
    reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    // Desglose: cuánto aporta cada cosa (counter de línea, sinergias con tus aliados, fuerza en el parche, composición, maestría)
    const breakdown = { matchup: 0, synergy: 0, strength: 0, comp: 0, mastery: 0 };
    for (const f of reasons) if (f.kind in breakdown) breakdown[f.kind] += f.value;
    for (const f of ev.factors) if (f.champs?.includes(c.champId) && f.kind in breakdown && !reasons.includes(f)) breakdown[f.kind] += f.value;
    for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k] * 1000) / 10;
    const profile = champProfile(c.champId);
    results.push({
      champId: c.champId,
      winProb: ev.winProb,
      reasons: factorsView(reasons.slice(0, 3), 3),
      breakdown,
      where: c.where || null,
      mastery: c.mastery ?? null,
      damage: profile?.damage || null,
    });
  }
  return results.sort((a, b) => b.winProb - a.winProb);
}
