/**
 * Posición de un jugador en una partida del historial del LCU. Los campos lane/role que guarda el
 * cliente no son fiables (a menudo marca al top como "JUNGLE"), así que usamos señales más sólidas.
 */
import { ddragon } from '../data/ddragon.js';

const SMITE = 11;

/** Estimación sin línea temporal: Aplastar => jungla; rol de support/carry; si no, la línea. */
export function roughPosition(p) {
  if (p.spell1Id === SMITE || p.spell2Id === SMITE) return 'JUNGLE';
  const { lane, role } = p.timeline || {};
  if (role === 'SUPPORT' || role === 'DUO_SUPPORT') return 'UTILITY';
  if (role === 'CARRY' || role === 'DUO_CARRY') return 'BOTTOM';
  if (lane === 'MIDDLE' || lane === 'MID') return 'MIDDLE';
  if (lane === 'BOTTOM' || lane === 'BOT') return 'BOTTOM';
  if (lane === 'TOP' || lane === 'JUNGLE') {
    // Un "JUNGLE" sin Aplastar suele ser el top; pero un tirador marcado así casi siempre jugó ADC
    return ddragon.champ(p.championId)?.tags?.[0] === 'Marksman' ? 'BOTTOM' : 'TOP';
  }
  return null;
}

function region(frames, pid) {
  let top = 0, mid = 0, bot = 0;
  for (const f of frames.slice(3, 11)) {
    const pos = f.participantFrames?.[pid]?.position;
    if (!pos) continue;
    const d = pos.x - pos.y;
    if (d < -3500) top++;
    else if (d > 3500) bot++;
    else mid++;
  }
  const max = Math.max(top, mid, bot);
  if (!max) return null;
  return max === top ? 'TOP' : max === bot ? 'BOT' : 'MIDDLE';
}

/**
 * Asigna posiciones a todos los participantes de una partida con su línea temporal.
 * Devuelve Map participantId -> posición.
 */
export function assignPositions(game, timeline) {
  const out = new Map();
  const frames = timeline?.frames || [];
  for (const teamId of [100, 200]) {
    const team = game.participants.filter((p) => p.teamId === teamId);
    const free = [];
    for (const p of team) {
      if (p.spell1Id === SMITE || p.spell2Id === SMITE) out.set(p.participantId, 'JUNGLE');
      else free.push(p);
    }
    if (!frames.length) {
      for (const p of free) out.set(p.participantId, roughPosition(p));
      continue;
    }
    const bots = [];
    for (const p of free) {
      const r = region(frames, String(p.participantId));
      if (r === 'TOP') out.set(p.participantId, 'TOP');
      else if (r === 'MIDDLE') out.set(p.participantId, 'MIDDLE');
      else if (r === 'BOT') bots.push(p);
      else out.set(p.participantId, roughPosition(p));
    }
    const cs = (p) => (p.stats.totalMinionsKilled || 0) + (p.stats.neutralMinionsKilled || 0);
    bots.sort((a, b) => cs(b) - cs(a));
    bots.forEach((p, i) => out.set(p.participantId, i === 0 ? 'BOTTOM' : 'UTILITY'));
  }
  return out;
}
