/**
 * Un coach por rol (top, jungla, mid, ADC, support). Cada uno define:
 *  - targets: referencias orientativas de sus métricas (estimación propia; null = no se le pide)
 *  - controlWardTarget(min): wards de control de referencia en la partida (null = no se le piden)
 *  - review(ctx, out, targets): qué es fallo, acierto o sugerencia en el post-partida y cómo decirlo
 *  - backWard / itemSetWards: si el aviso de volver a base y el set de objetos incluyen el ward de control
 *  - live: textos propios del rol para las alertas en partida
 * Sin posición fiable, o en ARAM, se usa un coach neutro sin consejos de rol.
 */
import top from './top.js';
import jungle from './jungle.js';
import mid from './mid.js';
import adc from './adc.js';
import support from './support.js';
import { neutral, aram } from './neutral.js';
import { collector } from './common.js';

const BY_POS = { TOP: top, JUNGLE: jungle, MIDDLE: mid, BOTTOM: adc, UTILITY: support };
// Otras formas de escribir la posición (LCU, OP.GG, textos)
const ALIAS = { MID: 'MIDDLE', BOT: 'BOTTOM', ADC: 'BOTTOM', SUPPORT: 'UTILITY', SUP: 'UTILITY', JUNGLA: 'JUNGLE', JG: 'JUNGLE' };

export const COACHES = { top, jungle, mid, adc, support, neutral, aram };

/** El coach de una posición ("BOTTOM", "utility", "MID"…). ARAM o sin posición: el neutro. */
export function coachFor(pos, { aram: isAram = false } = {}) {
  if (isAram) return aram;
  const p = String(pos || '').toUpperCase();
  return BY_POS[ALIAS[p] || p] || neutral;
}

/** Lo que ve la interfaz: { role: 'adc', label: 'Coach de ADC' } (label null en el neutro). */
export const coachInfo = (coach) => ({ role: coach.id, label: coach.label });

/**
 * Revisión post-partida: aplica las reglas del coach al contexto de la partida y devuelve las 3 cosas
 * que más costaron (por gravedad), los 3 aciertos principales y las sugerencias suaves.
 */
export function reviewGame(coach, ctx) {
  const o = collector();
  coach.review(ctx, o, coach.targets);
  o.issues.sort((a, b) => b.severity - a.severity);
  o.goods.sort((a, b) => b.score - a.score);
  return { improve: o.issues.slice(0, 3), strengths: o.goods.slice(0, 3), suggestions: o.suggestions.slice(0, 3) };
}
