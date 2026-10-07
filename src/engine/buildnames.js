/**
 * Pone nombre y etiquetas legibles a cada build ("Crítico", "Burst AP", "Tanque"...), como hace iTero,
 * para que se entienda en qué se diferencian sin mirar los objetos uno a uno.
 */
import { ddragon } from '../data/ddragon.js';

const BURST_AP = new Set([6655, 4645, 4646, 3089, 3135, 3100, 6657]); // Luden, Llamasombría, Tormenta, Rabadon, Vacío, Lich Bane, Vara de las edades
const DOT_AP = new Set([6653, 3116, 4633, 3118, 3137, 2503]); // Liandry, Rylai, Riftmaker, Malignancia, Florescencia, Antorcha
const ANTIHEAL = new Set([3033, 3165, 3075, 6609, 3123, 3916, 3076]);

const has = (it, tag) => it.tags.includes(tag);

function classify(items) {
  const n = (fn) => items.filter(fn).length;
  const crit = n((it) => has(it, 'CriticalStrike'));
  const onhit = n((it) => has(it, 'OnHit') && has(it, 'AttackSpeed'));
  const leth = n((it) => has(it, 'ArmorPenetration') && !has(it, 'CriticalStrike') && has(it, 'Damage') && !has(it, 'Health'));
  const ap = n((it) => has(it, 'SpellDamage'));
  const burst = n((it) => BURST_AP.has(it.id));
  const dot = n((it) => DOT_AP.has(it.id));
  const tank = n((it) => !has(it, 'Damage') && !has(it, 'SpellDamage') && (has(it, 'Armor') || has(it, 'SpellBlock') || has(it, 'Health')));
  const bruiser = n((it) => has(it, 'Health') && has(it, 'Damage'));
  const support = n((it) => has(it, 'ManaRegen') && (has(it, 'Active') || has(it, 'Aura') || has(it, 'CooldownReduction')) && !BURST_AP.has(it.id));

  if (tank >= 2) return { name: 'Tanque', icon: 'shield' };
  if (support >= 2) return { name: 'Encantador', icon: 'sparkles' };
  if (crit >= 2) return { name: onhit ? 'Crítico + on-hit' : 'Crítico', icon: 'crosshair' };
  if (onhit >= 2) return { name: 'On-hit', icon: 'zap' };
  if (leth >= 2) return { name: 'Letalidad', icon: 'sword' };
  if (bruiser >= 2) return { name: 'Bruiser', icon: 'swords' };
  if (ap >= 2 && dot > burst) return { name: 'Daño sostenido AP', icon: 'flame' };
  if (ap >= 2) return { name: 'Burst AP', icon: 'burst' };
  if (bruiser >= 1 && tank >= 1) return { name: 'Bruiser', icon: 'swords' };
  if (n((it) => has(it, 'Damage')) >= 2 && n((it) => has(it, 'AbilityHaste')) >= 2) return { name: 'AD + celeridad', icon: 'clock' };
  if (ap >= 1) return { name: 'AP', icon: 'wand' };
  return { name: 'AD', icon: 'sword' };
}

/** builds: [{ ids, winRate, pickRate, games }] ordenadas por popularidad */
export function nameBuilds(builds) {
  const bestWr = Math.max(...builds.filter((b) => b.games >= 300).map((b) => b.winRate ?? 0), 0);
  const named = builds.map((b, i) => {
    const items = b.ids.map((id) => ddragon.item(id)).filter(Boolean);
    const c = classify(items);
    const tags = [];
    if (i === 0) tags.push('La más jugada');
    if (b.games >= 300 && b.winRate === bestWr && builds.length > 1) tags.push('Mayor winrate');
    if (items.some((it) => ANTIHEAL.has(it.id))) tags.push('Con antiheal');
    if (items.some((it) => has(it, 'Active') && (has(it, 'Armor') || has(it, 'SpellBlock')))) tags.push('Con objeto defensivo');
    if (items.filter((it) => has(it, 'AbilityHaste')).length >= 2) tags.push('Mucha celeridad');
    if (items.some((it) => has(it, 'NonbootsMovement'))) tags.push('Movilidad');
    if (b.games < 300) tags.push('Pocas partidas');
    return { ...b, name: c.name, icon: c.icon, tags };
  });
  // Las alternativas dicen qué cambia respecto a la más jugada ("Crítico · con Soberbia")
  const first = new Set(named[0]?.ids || []);
  for (const b of named.slice(1)) {
    const diff = b.ids.filter((id) => !first.has(id)).map((id) => ddragon.item(id)?.name).filter(Boolean);
    if (diff.length) b.name = `${b.name} · con ${diff.join(' y ')}`;
  }
  return named;
}
