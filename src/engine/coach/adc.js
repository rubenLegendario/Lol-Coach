/**
 * Coach de ADC (tirador). Su visión es el trinket: no se le piden wards de control ni visión de support.
 * Se centra en farmeo (CS/min y CS al minuto 10), muertes (sobre todo en peleas y a mitad de partida),
 * parte del daño del equipo y presencia en dragones y barones.
 */
import { TRINKET, fmtMin, deathsRule, gankRule, laneRule, csRule, cs10Rule, kpRule, dmgRule, kdaGoods, objectivePresenceRule } from './common.js';

export default {
  id: 'adc',
  role: 'BOTTOM',
  label: 'Coach de ADC',
  // Referencias orientativas (estimación propia) para un tirador que quiere subir: CS alto
  targets: { csMin: 8.0, cs10: 75, visionMin: null, kp: 0.5, dmgShare: 0.25 },
  controlWardTarget: () => null,
  backWard: false, // de ADC no se recomienda comprar wards de control al volver a base
  itemSetWards: false,

  live: {
    objective: (kind, label) => kind === 'baron'
      ? { text: `${label} en 1 minuto: deja la línea lateral y júntate con tu equipo; no farmees solo lejos de ellos.`, voice: `${label} en un minuto. Agrúpate.` }
      : { text: `${label} en 1 minuto: empuja tu oleada y llega al río con tu support, no antes ni solo.`, voice: `${label} en un minuto. Empuja y ve con tu support.` },
    oppDead: (opp, secs) => ({ text: `${opp} ha muerto (${secs} s): empuja la oleada con tu support y coge placas de la torre.`, voice: `${opp} ha muerto. Empuja.` }),
  },

  review(c, o, T) {
    deathsRule(c, o, 'Como tirador, cada muerte es la mayor pérdida de daño de tu equipo. Antes de colocarte para farmear o pelear, cuenta cuántos rivales ves en el minimapa: si faltan su jungla o su support, juega como si estuvieran en el arbusto.');

    // Primero en caer en las peleas: el fallo más caro de un tirador en la mitad y el final de la partida
    const first = c.deaths.filter((d) => d.first);
    if (first.length >= 2) {
      o.issue(2 + first.length * 1.5, 'Mueres el primero en las peleas', `En ${first.length} peleas fuiste el primer aliado en caer (${first.map((d) => fmtMin(d.time)).join(', ')}).`, 'Tu sitio en la pelea es detrás de tu frontline: pega al objetivo más cercano que alcances sin entrar en el rango de su engage, y no avances hasta que sus amenazas (asesinos, engage, control) estén gastadas.');
    }
    // Muertes sueltas (fuera de peleas) entre el 14 y el 25: farmeando una línea lateral sin información
    const caught = c.deaths.filter((d) => !d.fight && d.time >= 14 * 60000 && d.time < 25 * 60000);
    if (caught.length >= 2) {
      o.issue(1.5 + caught.length, 'Te pillan solo a mitad de partida', `${caught.length} muertes fuera de una pelea entre el minuto 14 y el 25 (${caught.map((d) => fmtMin(d.time)).join(', ')}).`, 'A partir del minuto 14 no farmees una línea lateral sin visión ni con 2 o más rivales desaparecidos: recoge las oleadas que llegan a mid o cerca de tu equipo, y usa el trinket antes de entrar en zonas oscuras.');
    }
    gankRule(c, o, 'Antes de pelear por el CS lejos de tu torre, mira dónde se vio por última vez al jungla rival. Guarda el trinket para cuando su jungla pueda llegar (hacia el 3:00 y tras su primera vuelta) y ponlo en el río o el tri-bush.');
    laneRule(c, o, 'Si el 2 contra 2 no se puede ganar, juega a no perder CS (último golpe bajo torre) y espera a tu jungla en vez de forzar tradeos; revisa el matchup en la selección.');
    csRule(c, o, T, 'El oro del tirador sale del farmeo: no dejes oleadas al volver a base (empújala antes) y, a mitad de partida, recoge las oleadas laterales seguras entre objetivo y objetivo.');
    cs10Rule(c, o, T, 'Prioriza el último golpe sobre el tradeo en los primeros minutos y practica el farmeo bajo torre: a los cuerpo a cuerpo deja que la torre pegue dos veces; a los de rango, un golpe tuyo antes del de la torre.');
    if (c.lane[10] && T.cs10 && c.lane[10].cs >= T.cs10) o.good(2 + (c.lane[10].cs - T.cs10) / 10, 'Gran CS a los 10 minutos', `${c.lane[10].cs} CS al minuto 10 (objetivo ${T.cs10}).`);
    dmgRule(c, o, T, 'Tu daño sale de pegar sin parar en la pelea: colócate a máximo alcance y pega a lo más cercano (kiteando hacia atrás) en vez de buscar al carry rival; revisa también tu build si tienen varios tanques.');
    objectivePresenceRule(c, o, { min: 0.5, tip: 'Con el dragón o el Barón a 1 minuto, empuja tu oleada y llega con tu support: si el objetivo se pelea sin ti, tu equipo pelea 4 contra 5 contra su tirador.' });
    kpRule(c, o, T, 'Cuando tu equipo se agrupe para un objetivo, llega con la oleada empujada: no persigas oleadas sueltas lejos mientras tu equipo pelea.');
    kdaGoods(c, o);

    // Visión de tirador: solo el trinket. Sugerencias suaves, nunca fallos.
    if (c.min > 15 && c.m.wardsPlaced < c.min / 5) {
      o.suggest('Usa más el trinket', `Pusiste ${c.m.wardsPlaced} wards en ${Math.round(c.min)} minutos. El trinket amarillo se recarga solo: úsalo en el río o el tri-bush en la fase de líneas y antes de farmear una línea lateral.`);
    }
    if (c.min >= 25 && c.m.trinket === TRINKET.YELLOW) {
      o.suggest('Valora cambiar de trinket', 'Terminaste con el trinket amarillo. A mitad de partida, la Alteración de visión lejana te deja mirar arbustos y objetivos sin acercarte, y el barrido te ayuda a no entrar a ciegas. Si usas el amarillo cada vez que se carga, también vale.');
    }
  },
};
