/**
 * Coach neutro: sin posición fiable (o fuera de la Grieta). No da consejos de rol (ni visión, ni wards,
 * ni farmeo): solo muertes y KDA. En ARAM la regla de muertes tiene su propio texto.
 */
import { deathsRule, kdaGoods } from './common.js';

const silentLive = {
  objective: (kind, label) => ({ text: `${label} en 1 minuto.`, voice: `${label} en un minuto.` }),
  oppDead: (opp, secs) => ({ text: `${opp} ha muerto (${secs} s).`, voice: `${opp} ha muerto.` }),
};

export const neutral = {
  id: 'neutral',
  role: null,
  label: null,
  targets: { csMin: null, cs10: null, visionMin: null, kp: null, dmgShare: null },
  controlWardTarget: () => null,
  backWard: false,
  itemSetWards: false,
  live: silentLive,
  review(c, o) {
    if (c.sr) deathsRule(c, o, 'Cada muerte regala oro y tiempo de mapa. Antes de entrar en una pelea, cuenta cuántos rivales ves en el minimapa; si faltan 2 o más, no avances.');
    kdaGoods(c, o);
  },
};

export const aram = {
  ...neutral,
  id: 'aram',
  review(c, o) {
    if (c.m.deaths >= 10) o.issue(c.m.deaths / 3, 'Mueres demasiado', `${c.m.deaths} muertes.`, 'En ARAM también: si no puedes pegar sin morir, espera a que tu frontline entre primero.');
    kdaGoods(c, o);
  },
};
