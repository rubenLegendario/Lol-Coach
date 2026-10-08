/**
 * Coach de mid: farmeo, fase de líneas, ganks por los dos lados del río, roams y daño.
 * Visión del río con el trinket y el ward de control, como sugerencia ligera.
 */
import { deathsRule, gankRule, sideDeathsRule, laneRule, csRule, cs10Rule, kpRule, dmgRule, visionRule, kdaGoods, earlyPresenceRule } from './common.js';

export default {
  id: 'mid',
  role: 'MIDDLE',
  label: 'Coach de mid',
  targets: { csMin: 7.3, cs10: 70, visionMin: 0.7, kp: 0.5, dmgShare: 0.25 },
  controlWardTarget: () => null,
  backWard: false,
  itemSetWards: false,

  live: {
    objective: (kind, label) => ({ text: `${label} en 1 minuto: empuja tu oleada para llegar el primero al río y tener prioridad.`, voice: `${label} en un minuto. Empuja mid.` }),
    oppDead: (opp, secs) => ({ text: `${opp} ha muerto (${secs} s): empuja la oleada y muévete a ayudar a tu jungla o a otra línea.`, voice: `${opp} ha muerto. Empuja y muévete.` }),
  },

  review(c, o, T) {
    gankRule(c, o, 'En mid te pueden gankear por los dos lados del río: ten un ward en el lado por el que empezó su jungla (hacia el 2:45-3:00) y no empujes más allá de la mitad de la línea si no sabes dónde está.');
    deathsRule(c, o, 'Cada muerte en mid deja libre al rival para moverse por el mapa. Antes de tradear o empujar, cuenta cuántos rivales ves en el minimapa; si faltan 2 o más, no avances.');
    sideDeathsRule(c, o, 'Mueres en territorio enemigo', 'Si vas a meterte en su jungla o en una línea lateral, hazlo solo cuando veas a sus jugadores clave en otro sitio del mapa.');
    laneRule(c, o, 'Revisa el matchup antes de jugar (la app te lo enseña en la selección) y céntrate en no perder oleadas: un CS perdido por minuto son ~200 de oro cada 10 minutos.');
    csRule(c, o, T, 'No dejes oleadas al moverte: empuja tu oleada antes de roamear o volver a base y, a mitad de partida, recoge las oleadas laterales que lleguen al centro.');
    cs10Rule(c, o, T, 'En los primeros minutos prioriza el último golpe y el control de la oleada sobre el tradeo; practica el farmeo bajo torre en la Herramienta de práctica.');
    earlyPresenceRule(c, o, { min: 0.3, title: 'No te mueves por el mapa', tip: 'Cuando empujes tu oleada hasta su torre tienes ventana para moverte: ayuda a tu jungla en el scuttle o en una invasión, o roamea a una línea lateral; si tu rival se mueve primero, avisa o síguelo.' });
    if (c.roams >= 2) o.good(1.5 + c.roams / 2, 'Buenos roams', `Participaste en ${c.roams} kills en otras líneas antes del minuto 14.`);
    dmgRule(c, o, T, 'En las peleas busca lanzar tu combo sobre los objetivos que alcanzas sin quedar expuesto, y revisa que tu build vaya acorde a la composición rival.');
    kpRule(c, o, T, 'Desde mid llegas antes que nadie a los dos ríos: con la oleada empujada, ve a las peleas por dragón y larvas con tu jungla.');
    kdaGoods(c, o);
    visionRule(c, o, T, { soft: true, softTitle: 'Más wards en el río', tip: 'Pon el trinket en los arbustos del río de los dos lados: en mid, esa visión te avisa de ganks y de los roams de tu rival.' });
    if (c.sr && c.min > 20 && c.m.controlWards === 0) {
      o.suggest('Un ward de control de vez en cuando', 'No compraste ninguno. Uno en el arbusto del río del lado de su jungla te protege de ganks durante la fase de líneas.');
    }
  },
};
