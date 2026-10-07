/**
 * Asesor de dodge para clasificatorias: compara lo que esperas ganar jugando (según la probabilidad
 * del draft y tus LP medios por victoria/derrota) con lo que cuesta esquivar.
 *
 * Penalización por esquivar en ranked (aprox., escala si repites en 24 h): 1.º −5 LP, 2.º y siguientes −15 LP.
 */
const DODGE_LP = 5;
const DEFAULT_WIN = 20;
const DEFAULT_LOSS = -20;

export function dodgeAdvice({ winProb, allies, lp, session }) {
  if (winProb == null) return null;
  let p = winProb / 100;
  const reasons = [];

  // Señales que el modelo de draft no tiene en cuenta
  for (const a of allies) {
    if (a.isMe || !a.scout) continue;
    const who = a.champ?.name || a.name?.split('#')[0] || 'Un aliado';
    if (a.scout.tags.some((t) => t.text.startsWith('Fuera de su rol'))) {
      p -= 0.015;
      reasons.push({ type: 'bad', text: `${who} juega fuera de su rol` });
    }
    if (a.scout.tags.some((t) => t.text === 'Primera vez con el campeón')) reasons.push({ type: 'bad', text: `${who} nunca ha jugado ${a.champ?.name || 'su campeón'}` });
    if (a.scout.streak <= -4) {
      p -= 0.01;
      reasons.push({ type: 'bad', text: `${who} lleva ${-a.scout.streak} derrotas seguidas` });
    }
  }
  if (session?.lossStreak >= 3) reasons.push({ type: 'warn', text: `Tú llevas ${session.lossStreak} derrotas seguidas hoy` });

  p = Math.max(0.25, Math.min(0.75, p));
  const win = lp?.avgWin ?? DEFAULT_WIN;
  const loss = lp?.avgLoss ?? DEFAULT_LOSS;
  const evPlay = p * win + (1 - p) * loss;
  const evDodge = -DODGE_LP;
  const margin = evPlay - evDodge;

  let verdict = 'play';
  if (margin < 0) verdict = 'dodge';
  else if (p < 0.46 || margin < 4 || reasons.filter((r) => r.type === 'bad').length >= 2) verdict = 'consider';

  const text = {
    play: 'El draft no justifica esquivar: lo que esperas ganar jugando supera el coste del dodge.',
    consider: 'Draft complicado: piénsatelo, sobre todo si es tu primer dodge del día.',
    dodge: 'Esquivar te sale más barato que jugar esta partida (si es tu primer dodge del día).',
  }[verdict];

  return {
    verdict,
    text,
    winProb: Math.round(p * 1000) / 10,
    evPlay: Math.round(evPlay * 10) / 10,
    evDodge,
    lpWin: win,
    lpLoss: loss,
    reasons,
    note: 'El 1.er dodge en 24 h cuesta 5 LP; a partir del 2.º, 15 LP y más tiempo de espera.',
  };
}
