/**
 * Alertas en partida: compara cada foto de la partida con la anterior y avisa solo de lo que
 * acaba de cambiar (power spikes, niveles clave, muertes del rival, objetivos, oro para comprar).
 * Cada alerta trae un texto corto para leerlo en voz alta.
 */
import { ddragon } from '../data/ddragon.js';
import { coachFor } from './coach/index.js';

const MAX = 12;

export class AlertTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.prev = null;
    this.alerts = [];
    this.seq = 0;
    this.fired = new Set(); // avisos que solo deben salir una vez (objetivos, etc.)
  }

  push(t, type, icon, text, voice) {
    this.alerts.unshift({ id: ++this.seq, t: Math.round(t), type, icon, text, voice: voice || text, cat: this.cat });
    this.alerts = this.alerts.slice(0, MAX);
  }

  once(key, ...args) {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    this.push(...args);
  }

  /** Devuelve la lista de alertas (las más recientes primero). */
  update(view) {
    const t = view.gameTime || 0;
    // Partida nueva (o reconexión): el tiempo ha ido hacia atrás
    if (this.prev && t + 5 < this.prev.t) this.reset();

    const pw = view.power;
    const snap = {
      t,
      myLevel: view.me.level,
      oppLevel: pw?.them?.level ?? null,
      oppName: pw?.opp?.name || null,
      myItems: new Set((pw?.spikes?.me?.completed || []).map((i) => i.id)),
      oppDead: !!pw?.oppDead,
      verdict: pw?.verdict || null,
      canBuy: !!view.shopping && view.shopping.missing === 0,
      buyName: view.shopping?.target?.name || null,
      enemyItems: new Map(view.players.filter((p) => p.team !== view.myTeam).map((p) => [p.champ?.name, new Set(p.items.filter((i) => i.gold >= 2200).map((i) => i.id))])),
      fed: new Set((view.teams?.enemy?.fed || []).map((f) => f.name)),
    };
    const prev = this.prev;
    this.prev = snap;
    if (!prev) return this.alerts; // primera foto: solo memorizamos

    const opp = snap.oppName;
    // Los textos de objetivos y de la muerte del rival dependen del rol (coach de tu posición)
    const coach = coachFor(view.me?.pos, { aram: view.aram });
    // Objetos completos del rival de línea (su power spike)
    if (pw && opp) {
      this.cat = 'oppItems';
      const now = snap.enemyItems.get(opp) || new Set();
      const before = prev.enemyItems.get(opp) || new Set();
      for (const id of now) {
        if (before.has(id)) continue;
        const name = ddragon.item(id)?.name || 'un objeto';
        const two = now.size >= 2;
        this.push(t, 'bad', 'alert', `${opp} ha completado ${name}${two ? `: ya lleva ${now.size} objetos grandes, es su gran power spike` : ': es su power spike'}. Juega con más cuidado.`, `${opp} ha completado ${name}. Cuidado.`);
      }
      // Niveles clave: quién tiene la R (o la R mejorada) primero
      this.cat = 'levels';
      for (const lvl of [6, 11, 16]) {
        const iGot = prev.myLevel < lvl && snap.myLevel >= lvl;
        const heGot = prev.oppLevel < lvl && snap.oppLevel >= lvl;
        if (iGot && snap.oppLevel < lvl) this.push(t, 'good', 'zap', lvl === 6 ? `Tienes la R y ${opp} todavía no: es tu momento para el all-in.` : `Llegas a nivel ${lvl} antes que ${opp}: tu R es más fuerte ahora.`, lvl === 6 ? `Tienes la ulti antes que ${opp}. Busca el all-in.` : `Nivel ${lvl} antes que ${opp}.`);
        else if (heGot && snap.myLevel < lvl) this.push(t, 'bad', 'alert', lvl === 6 ? `${opp} ya tiene la R y tú no: cuidado con su all-in.` : `${opp} llega a nivel ${lvl} antes que tú.`, lvl === 6 ? `${opp} tiene la ulti y tú no. Cuidado.` : `${opp} es nivel ${lvl}.`);
      }
      // Tu rival muere
      this.cat = 'oppDeath';
      if (!prev.oppDead && snap.oppDead) {
        const m = coach.live.oppDead(opp, pw.oppRespawn);
        this.push(t, 'good', 'skull', m.text, m.voice);
      }
      // Cambio de quién manda en la línea
      this.cat = 'advantage';
      if (prev.verdict && snap.verdict !== prev.verdict) {
        if (snap.verdict === 'ahead') this.push(t, 'good', 'up', `Ahora tienes ventaja sobre ${opp}: busca pelea.`, `Ventaja sobre ${opp}. Busca pelea.`);
        else if (snap.verdict === 'behind') this.push(t, 'bad', 'down', `${opp} te ha pasado: juega seguro hasta tu próximo objeto.`, `Desventaja. Juega seguro.`);
      }
    }
    // Tus propios objetos completados
    this.cat = 'myItems';
    for (const it of pw?.spikes?.me?.completed || []) {
      if (!prev.myItems.has(it.id)) this.push(t, 'good', 'star', `Has completado ${it.name}: tu power spike. ${snap.verdict === 'ahead' ? 'Ahora eres más fuerte que tu rival.' : ''}`.trim(), `Has completado ${it.name}.`);
    }
    // Rivales "fed" que completan un objeto grande
    this.cat = 'fedEnemies';
    for (const [name, items] of snap.enemyItems) {
      if (name === opp || !snap.fed.has(name)) continue;
      const before = prev.enemyItems.get(name) || new Set();
      for (const id of items) {
        if (!before.has(id)) this.push(t, 'warn', 'flame', `${name} va fed y acaba de completar ${ddragon.item(id)?.name || 'un objeto'}.`, `${name} va fed y tiene ${ddragon.item(id)?.name || 'un objeto nuevo'}.`);
      }
    }
    // Ya te llega para tu siguiente objeto
    this.cat = 'canBuy';
    if (!prev.canBuy && snap.canBuy && snap.buyName) this.push(t, 'info', 'cart', `Tienes oro para ${snap.buyName}: vuelve a base cuando puedas.`, `Tienes oro para ${snap.buyName}.`);
    // Objetivos
    this.cat = 'objectives';
    for (const key of ['dragon', 'baron']) {
      const o = view.objectives?.[key];
      if (!o) continue;
      const left = o.at - t;
      if (left <= 60 && left > 30) {
        const m = coach.live.objective(key, o.label);
        this.once(`${key}-60-${o.at}`, t, 'info', key === 'dragon' ? 'flame' : 'crown', m.text, m.voice);
      }
      if (left <= 0 && left > -20) this.once(`${key}-up-${o.at}`, t, 'warn', key === 'dragon' ? 'flame' : 'crown', `${o.label} ha aparecido.`, `${o.label} vivo.`);
    }
    return this.alerts;
  }
}
