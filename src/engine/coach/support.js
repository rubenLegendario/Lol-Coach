/**
 * Coach de support: visión (visión/min, wards de control, barrido y wards quitados), participación,
 * roams y muertes poniendo visión.
 */
import { TRINKET, deathsRule, gankRule, sideDeathsRule, visionRule, kpRule, kdaGoods, earlyPresenceRule } from './common.js';

/** Wards de control de referencia: ~1 por vuelta a base, que en support viene a ser una cada 6 min (mín. 2). */
export const supportControlWards = (min) => Math.max(2, Math.round(min / 6));

export default {
  id: 'support',
  role: 'UTILITY',
  label: 'Coach de support',
  targets: { csMin: null, cs10: null, visionMin: 2.0, kp: 0.55, dmgShare: 0.08 },
  controlWardTarget: supportControlWards,
  backWard: true, // el ward de control tiene su propia ranura de rol en el support
  itemSetWards: true,

  live: {
    objective: (kind, label) => kind === 'baron'
      ? { text: `${label} en 1 minuto: entra con tu jungla a quitar su visión y pon un ward de control cerca del foso.`, voice: `${label} en un minuto. Visión.` }
      : { text: `${label} en 1 minuto: con tu ADC a salvo, entra con tu jungla a poner visión en el río y un ward de control en el foso.`, voice: `${label} en un minuto. Pon visión.` },
    oppDead: (opp, secs) => ({ text: `${opp} ha muerto (${secs} s): presiona a su tirador con tu ADC o aprovecha para poner visión en su jungla.`, voice: `${opp} ha muerto. Presiona.` }),
  },

  review(c, o, T) {
    deathsRule(c, o, 'Como support, cada muerte deja a tu tirador solo y sin visión. No entres en arbustos sin visión (usa el barrido o un ward, o deja que entre un aliado más resistente).');
    gankRule(c, o, 'Mantén un ward en el río o en el tri-bush durante la fase de líneas y renuévalo al volver de base; si se acaba y su jungla no se ha visto, retrocede con tu ADC.');
    sideDeathsRule(c, o, 'Mueres poniendo visión', 'Pon la visión profunda cuando tus líneas tengan prioridad (oleadas empujadas) y sepas dónde está su jungla; si no, wardea desde tu lado del río.');
    visionRule(c, o, T, { tip: 'Gasta las cargas del objeto de support en cuanto se llenen, lleva siempre un ward de control y cambia al barrido al completar la misión del objeto de support.' });

    // Wards de control: aquí sí cuentan como fallo
    const cwT = supportControlWards(c.min);
    const cw = c.m.controlWards;
    if (c.sr && c.min > 15 && cw < Math.ceil(cwT / 2)) {
      o.issue(cw === 0 ? 3 : 2, cw === 0 ? 'No compraste ningún ward de control' : 'Pocos wards de control', `${cw} en ${Math.round(c.min)} minutos (referencia ~${cwT}: uno por vuelta a base).`, 'Tienes una ranura de rol para el ward de control: rellénala en cada vuelta a base y colócalo en el arbusto del río o en el foso antes de cada dragón.');
    } else if (cw >= cwT) {
      o.good(2, 'Buenos wards de control', `${cw} wards de control comprados.`);
    }
    // Trinket: el support termina con el barrido
    if (c.min >= 20 && c.m.trinket === TRINKET.YELLOW) {
      o.issue(2, 'No cambiaste al barrido', 'Terminaste la partida con el trinket amarillo.', 'Al completar la misión del objeto de support, cambia al barrido (Lente del oráculo): quitar su visión antes de los objetivos es parte de tu trabajo.');
    }
    if (c.min > 15 && c.m.wardsKilled >= c.min / 4) o.good(1.5, 'Limpias su visión', `${c.m.wardsKilled} wards rivales destruidos.`);

    earlyPresenceRule(c, o, { min: 0.35, title: 'Poca presencia en la fase de líneas', tip: 'Acompaña a tu jungla en el scuttle y en los objetivos, y roamea a mid cuando tu ADC tenga la oleada a salvo (empujada o al volver a base).' });
    if (c.roams >= 2) o.good(1.5 + c.roams / 2, 'Buenos roams', `Participaste en ${c.roams} kills en otras líneas antes del minuto 14.`);
    kpRule(c, o, T, 'Como support tu oro no depende de la línea: muévete con tu jungla hacia los objetivos y a las peleas de mid en cuanto tu ADC pueda quedarse solo.');
    kdaGoods(c, o);
  },
};
