/**
 * Coach de top: farmeo, oro al minuto 14 frente a tu rival (incluye las placas), ganks, presión en la
 * línea lateral (daño a torres) y muertes haciendo split push. Ward de control ocasional, como sugerencia.
 */
import { deathsRule, gankRule, sideDeathsRule, laneRule, csRule, cs10Rule, kpRule, dmgRule, visionRule, kdaGoods, pct } from './common.js';

export default {
  id: 'top',
  role: 'TOP',
  label: 'Coach de top',
  targets: { csMin: 7.0, cs10: 65, visionMin: 0.7, kp: 0.45, dmgShare: 0.2 },
  controlWardTarget: () => null,
  backWard: false,
  itemSetWards: false,

  live: {
    objective: (kind, label) => kind === 'baron'
      ? { text: `${label} en 1 minuto: empuja top para tener prioridad en el lado del Barón y júntate con tu equipo.`, voice: `${label} en un minuto. Empuja top.` }
      : { text: `${label} en 1 minuto: si tienes Teleport, guárdalo para la pelea; si no, presiona tu línea para que el rival tenga que elegir.`, voice: `${label} en un minuto. Guarda el Teleport.` },
    oppDead: (opp, secs) => ({ text: `${opp} ha muerto (${secs} s): empuja la oleada contra su torre y coge placas.`, voice: `${opp} ha muerto. Placas.` }),
  },

  review(c, o, T) {
    laneRule(c, o, 'Revisa el matchup antes de jugar y gestiona la oleada: si pierdes los tradeos, deja que la oleada llegue a tu torre en lugar de pelearla lejos, y no regales placas.', { goldNote: ' (incluye el oro de las placas)' });
    gankRule(c, o, 'Si vas por delante en la línea sin saber dónde está su jungla, estás expuesto: ten un ward en el tri-bush o en el río y empuja sobre todo cuando su jungla se haya mostrado en bot.');
    csRule(c, o, T, 'No dejes oleadas al volver a base (empújala antes) y, si vas por detrás, farmea bajo torre en vez de pelear la oleada en medio de la línea.');
    cs10Rule(c, o, T, 'En los primeros minutos prioriza el último golpe sobre el tradeo; practica el farmeo bajo torre en la Herramienta de práctica.');
    sideDeathsRule(c, o, 'Mueres haciendo split push', 'Al empujar solo, mira cuántos rivales se ven en el mapa: si faltan 2 o más, retrocede hasta tu torre. Empuja cuando tu equipo amenace un objetivo al otro lado, para que el rival tenga que elegir.');
    deathsRule(c, o, 'En top una muerte es oleada y placas perdidas. Antes de tradear o empujar, comprueba en el minimapa dónde está su jungla.');
    if (c.turretShare != null && c.turretShare >= 0.3 && c.m.turretDmg >= 3000) o.good(2 + c.turretShare * 3, 'Presión en la línea lateral', `${c.m.turretDmg} de daño a torres (${pct(c.turretShare)}% del de tu equipo).`);
    // Un tanque de top no tiene por qué hacer mucho daño: solo se le pide a los demás
    if (!c.tank) dmgRule(c, o, T, 'Llega a las peleas a tiempo (si llevas Teleport, guárdalo para los objetivos) y pega a quien alcances sin quedar expuesto; revisa tu build contra la composición rival.');
    kpRule(c, o, T, 'Si llevas Teleport, úsalo para llegar a las peleas por dragón y larvas; si no, empuja tu oleada antes de que empiece el objetivo para poder moverte.');
    kdaGoods(c, o);
    visionRule(c, o, T, { soft: true, softTitle: 'Más wards en top', tip: 'Pon el trinket en el tri-bush o en el río de top hacia el minuto 3 y tras cada vuelta: en top, esa visión es lo que te salva de los ganks.' });
    if (c.sr && c.min > 20 && c.m.controlWards === 0) {
      o.suggest('Un ward de control de vez en cuando', 'No compraste ninguno. Uno en el tri-bush o en el río de top te protege de ganks y te da información de las larvas y el heraldo.');
    }
  },
};
