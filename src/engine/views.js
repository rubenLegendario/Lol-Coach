import { ddragon } from '../data/ddragon.js';
import { champProfile } from '../data/champinfo.js';
import { nameBuilds } from './buildnames.js';

export const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);

/** Convierte una build normalizada (ids) en algo listo para pintar (nombres + iconos). */
export function buildView(b) {
  if (!b) return null;
  const items = (ids) => ids.map((id) => ddragon.itemView(id)).filter(Boolean);
  return {
    champ: ddragon.champView(b.champId),
    pos: b.pos,
    games: b.games,
    winRate: pct(b.winRate),
    pickRate: pct(b.pickRate),
    banRate: pct(b.banRate),
    tier: b.tier,
    matchup: b.matchup
      ? { vs: ddragon.champView(b.matchup.vs), games: b.matchup.games, winRate: pct(b.matchup.winRate), specific: b.matchup.specific }
      : null,
    spells: b.spells.map((s) => ({ spells: s.ids.map((k) => ddragon.spellView(k)).filter(Boolean), winRate: pct(s.winRate), pickRate: pct(s.pickRate) })),
    runes: b.runes.map((r) => ({
      primaryStyle: ddragon.runeView(r.primaryStyle),
      subStyle: ddragon.runeView(r.subStyle),
      primary: r.primary.map((id) => ddragon.runeView(id)),
      secondary: r.secondary.map((id) => ddragon.runeView(id)),
      shards: r.shards.map((id) => ddragon.runeView(id)),
      winRate: pct(r.winRate),
      pickRate: pct(r.pickRate),
      games: r.games,
    })),
    starter: b.starter.map((s) => ({ items: items(s.ids), winRate: pct(s.winRate), pickRate: pct(s.pickRate) })),
    boots: b.boots.map((x) => ({ item: ddragon.itemView(x.id), winRate: pct(x.winRate), pickRate: pct(x.pickRate) })).filter((x) => x.item),
    core: b.core.map((c) => ({ items: items(c.ids), winRate: pct(c.winRate), pickRate: pct(c.pickRate), games: c.games })),
    situational: items(b.situational),
    // Builds alternativas con nombre y etiquetas (sin repetir las que solo cambian el orden)
    builds: nameBuilds(
      (b.core_all || b.core).filter((c, i, arr) => arr.findIndex((x) => [...x.ids].sort().join() === [...c.ids].sort().join()) === i).slice(0, 4),
    )
      .filter((x, i, arr) => arr.findIndex((y) => y.name === x.name) === i)
      .map((x) => ({ name: x.name, icon: x.icon, tags: x.tags, items: items(x.ids), winRate: pct(x.winRate), pickRate: pct(x.pickRate), games: x.games })),
    skills: b.skills,
  };
}

/** Resumen de la composición de un equipo a partir de sus campeones. */
export function compSummary(champIds) {
  const profiles = champIds.map(champProfile).filter(Boolean);
  if (!profiles.length) return null;
  let ap = 0, ad = 0;
  for (const p of profiles) {
    if (p.damage === 'AP') ap += 1;
    else if (p.damage === 'AD') ad += 1;
    else { ap += 0.5; ad += 0.5; }
  }
  const total = ap + ad || 1;
  return {
    ap: Math.round((ap / total) * 100),
    ad: Math.round((ad / total) * 100),
    tanks: profiles.filter((p) => p.tank).length,
    healers: profiles.filter((p) => p.healer).map((p) => p.id),
    highCc: profiles.filter((p) => p.cc >= 3).length,
    count: profiles.length,
  };
}
