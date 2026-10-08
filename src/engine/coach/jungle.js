/**
 * Coach de jungla: control de objetivos (dragones, larvas, heraldo, Barón), presencia en la fase de
 * líneas, farmeo, barrido y muertes invadiendo. Los wards de control, como sugerencia.
 */
import { TRINKET, deathsRule, sideDeathsRule, csRule, visionRule, kpRule, kdaGoods, earlyPresenceRule, objectivePresenceRule } from './common.js';

/**
 * Balance de objetivos entre equipos (positivo = a favor): cada dragón 1, cada Barón 2, cada heraldo 1
 * y cada larva 1/3 (salen de 3 en 3). Ponderación propia.
 */
export function objectiveBalance(obj) {
  if (!obj) return null;
  const d = (k) => (obj.ally[k] || 0) - (obj.enemy[k] || 0);
  return d('dragons') + d('barons') * 2 + d('heralds') + d('grubs') / 3;
}

export default {
  id: 'jungle',
  role: 'JUNGLE',
  label: 'Coach de jungla',
  targets: { csMin: 5.8, cs10: 55, visionMin: 1.1, kp: 0.55, dmgShare: 0.15 },
  controlWardTarget: () => null, // sugerencia, no objetivo
  backWard: true,
  itemSetWards: true,

  live: {
    objective: (kind, label) => kind === 'baron'
      ? { text: `${label} en 1 minuto: limpia hacia ese lado, barre su visión y avisa a tu equipo antes de empezarlo.`, voice: `${label} en un minuto. Prepáralo.` }
      : { text: `${label} en 1 minuto: limpia la jungla hacia ese lado para llegar a tiempo, avisa a bot y mid y barre su visión.`, voice: `${label} en un minuto. Prepáralo.` },
    oppDead: (opp, secs) => ({ text: `${opp}, su jungla, ha muerto (${secs} s): invade su jungla o haz el objetivo más cercano.`, voice: `Su jungla ha muerto. Objetivo.` }),
  },

  review(c, o, T) {
    const bal = objectiveBalance(c.objectives);
    if (bal != null && c.objectives) {
      const a = c.objectives.ally, e = c.objectives.enemy;
      const detail = `Dragones ${a.dragons}-${e.dragons}, Barones ${a.barons}-${e.barons}, heraldos ${a.heralds}-${e.heralds}, larvas ${a.grubs}-${e.grubs}.`;
      if (bal <= -2) o.issue(2 + Math.abs(bal), 'El rival se llevó los objetivos', detail, 'Prepara cada objetivo con antelación: limpia hacia ese lado para llegar 30-45 s antes de que salga, avisa a las líneas con prioridad y barre su visión; si no puedes disputarlo, cámbialo por otro al otro lado del mapa.');
      else if (bal >= 2) o.good(2 + bal / 2, 'Controlaste los objetivos', detail);
    }
    objectivePresenceRule(c, o, { min: 0.6, title: 'No estás en los objetivos de tu equipo', tip: 'El castigo es tuyo: organiza tu ruta para estar en cada dragón y Barón que haga tu equipo, y no los dejes en manos de otro aliado sin castigo.' });
    earlyPresenceRule(c, o, { min: 0.4, title: 'Poco impacto en la fase de líneas', tip: 'Tras el primer clear, mira qué línea tiene la oleada empujando hacia su torre y control para seguir tu gank; si no hay un gank bueno, haz contragank cerca de donde esté el jungla rival o farmea hacia el siguiente objetivo.' });
    csRule(c, o, T, 'Entre gank y gank vuelve a tus campamentos cuando reaparecen, y planifica la ruta para no perder campamentos al ir a un objetivo: un jungla sin farmeo llega sin objetos a la mitad de partida.');
    deathsRule(c, o, 'Tu muerte cuesta objetivos: antes de invadir o pelear en el río, asegúrate de que tus líneas cercanas pueden llegar antes que las suyas.');
    sideDeathsRule(c, o, 'Mueres invadiendo', 'Invade solo cuando sepas dónde está el jungla rival y tus líneas tengan prioridad para seguirte; si no, farmea tu lado y vigila sus movimientos.');
    visionRule(c, o, T, { tip: 'Cambia al barrido pronto (lo habitual es en la primera vuelta a base) y úsalo antes de cada objetivo y en las entradas de tu jungla.' });
    if (c.min >= 20 && c.m.trinket === TRINKET.YELLOW) {
      o.issue(1.5, 'Sin barrido', 'Terminaste la partida con el trinket amarillo.', 'Como jungla, el barrido te deja limpiar la visión del objetivo antes de hacerlo y entrar en su jungla sin que te vean.');
    }
    kpRule(c, o, T, 'Cuando tus líneas peleen cerca del río, llega tú también: la jungla con más kills y asistencias en el early suele ser la que gana el mapa.');
    kdaGoods(c, o);
    if (c.sr && c.min > 20 && c.m.controlWards === 0) {
      o.suggest('Un ward de control en los objetivos', 'No compraste ninguno. Uno colocado en el foso del dragón o del Barón antes de que salga te da visión y niega la suya.');
    }
  },
};
