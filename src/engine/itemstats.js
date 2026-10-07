/**
 * Estadísticas de objetos por campeón (al estilo de DPM.LOL): sets de objetos, objeto en cada posición
 * de la build (1.º…6.º), botas, iniciales y hechizos, con winrate, pickrate y partidas.
 * Fuente: la API JSON pública de OP.GG (endpoints del campeón y /builds).
 */
import { config } from '../config.js';
import { fetchJson } from '../util/http.js';
import { cached } from '../util/cache.js';
import { ddragon } from '../data/ddragon.js';
import { normPos, patchKey, POS_LABEL, mainPosition } from '../data/stats.js';

const BASE = 'https://lol-api-champion.op.gg/api';
const TTL = 3 * 3600_000;
const TO_API = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };
// Solo valores que acepta OP.GG (silver_plus, por ejemplo, devuelve 422)
export const TIERS = {
  all: 'Todos', iron: 'Hierro', bronze: 'Bronce', silver: 'Plata', gold: 'Oro', gold_plus: 'Oro+', platinum: 'Platino', platinum_plus: 'Platino+',
  emerald: 'Esmeralda', emerald_plus: 'Esmeralda+', diamond: 'Diamante', diamond_plus: 'Diamante+', master: 'Maestro', master_plus: 'Maestro+', grandmaster: 'Gran Maestro', challenger: 'Aspirante',
};
export const REGIONS = { [config.statsRegion]: config.statsRegion.toUpperCase(), global: 'Global' };

const r1 = (x) => Math.round(x * 1000) / 10;

function rows(list, kind = 'item') {
  return (list || []).map((x) => {
    const objs = x.ids.map((id) => (kind === 'spell' ? ddragon.spellView(id) : ddragon.itemView(id))).filter(Boolean);
    if (!objs.length) return null;
    return { items: objs, games: x.play, winRate: x.play ? r1(x.win / x.play) : null, pickRate: r1(x.pick_rate) };
  }).filter(Boolean);
}

export async function itemStats({ champId, pos = null, tier = config.statsTier, region = config.statsRegion, mode = 'ranked' }) {
  const champ = ddragon.champView(champId);
  if (!champ) throw new Error('Campeón desconocido');
  if (!TIERS[tier]) tier = config.statsTier;
  if (!REGIONS[region]) region = config.statsRegion;
  const aram = mode === 'aram';

  const url = (p, extra = '') => (aram
    ? `${BASE}/${region}/champions/aram/${champId}/none${extra}`
    : `${BASE}/${region}/champions/ranked/${champId}/${TO_API[p]}${extra}?tier=${tier}`);
  const get = (p, extra) => cached(`opgg_items_${region}_${aram ? 'aram' : tier}_${patchKey()}_${champId}_${aram ? 'none' : p}${extra}`, TTL,
    async () => (await fetchJson(url(p, extra))).data);

  // Rol: el pedido o el más jugado del campeón
  if (!aram && (!pos || !TO_API[pos])) pos = (await mainPosition(champId)) || 'MIDDLE';
  const detail = await get(pos, '');
  const builds = await get(pos, '/builds').catch(() => null);

  const positions = aram ? [] : (detail?.summary?.positions || [])
    .map((p) => ({ pos: normPos(p.name), label: POS_LABEL[normPos(p.name)], roleRate: r1(p.stats.role_rate) }))
    .filter((p) => p.pos && p.roleRate >= 3)
    .sort((a, b) => b.roleRate - a.roleRate);
  const st = aram ? detail?.summary?.average_stats : detail?.summary?.positions?.find((p) => normPos(p.name) === pos)?.stats;

  const byDepth = (list) => Object.fromEntries((list || []).map((d) => [d.depth, rows(d.items)]));
  const slots = byDepth(builds?.single_items);
  const combos = byDepth(builds?.combination_items); // depth 1 = 2 objetos … depth 5 = 6 objetos

  return {
    champ,
    mode: aram ? 'aram' : 'ranked',
    pos: aram ? null : pos,
    posLabel: aram ? 'ARAM' : POS_LABEL[pos],
    tier, tierLabel: TIERS[tier], tiers: TIERS,
    region, regions: REGIONS,
    positions,
    summary: st ? {
      games: st.play,
      winRate: r1(st.win_rate),
      pickRate: r1(st.pick_rate),
      banRate: st.ban_rate != null ? r1(st.ban_rate) : null,
      tier: st.tier_data?.tier ?? st.tier ?? null,
      rank: st.tier_data?.rank ?? st.rank ?? null,
    } : null,
    sets: Object.fromEntries(Object.entries(combos).map(([d, list]) => [Number(d) + 1, list])),
    slots: [1, 2, 3, 4, 5, 6].map((d) => slots[d] || []),
    boots: rows(detail?.boots),
    starters: rows(detail?.starter_items),
    spells: rows(detail?.summoner_spells, 'spell'),
    // Si OP.GG no tiene /builds para este campeón, al menos los cores de 3 objetos
    fallbackCore: builds ? null : rows(detail?.core_items),
  };
}

/**
 * Tier list (pestaña "Campeones" de Builds): cada campeón en cada rol con su tier, winrate, pick rate,
 * ban rate y partidas. En ARAM no hay roles.
 */
export async function tierListView({ tier = config.statsTier, region = config.statsRegion, mode = 'ranked' } = {}) {
  if (!TIERS[tier]) tier = config.statsTier;
  if (!REGIONS[region]) region = config.statsRegion;
  const aram = mode === 'aram';
  const url = aram ? `${BASE}/${region}/champions/aram` : `${BASE}/${region}/champions/ranked?tier=${tier}`;
  const data = await cached(`opgg_tl_${region}_${aram ? 'aram' : tier}_${patchKey()}`, TTL, async () => (await fetchJson(url)).data);
  const rows = [];
  for (const c of data || []) {
    const champ = ddragon.champView(c.id);
    if (!champ) continue;
    const list = aram ? [{ name: null, stats: { ...c.average_stats, role_rate: 1 } }] : c.positions || [];
    for (const p of list) {
      const st = p.stats || {};
      if (!aram && (st.role_rate || 0) < 0.05) continue; // roles raros (menos del 5% de sus partidas)
      rows.push({
        champ,
        pos: aram ? null : normPos(p.name),
        tier: st.tier_data?.tier ?? st.tier ?? null,
        rank: st.tier_data?.rank ?? st.rank ?? null,
        winRate: st.win_rate != null ? r1(st.win_rate) : null,
        pickRate: st.pick_rate != null ? r1(st.pick_rate) : null,
        banRate: st.ban_rate != null ? r1(st.ban_rate) : null,
        roleRate: r1(st.role_rate || 0),
        games: st.play || 0,
      });
    }
  }
  return { mode: aram ? 'aram' : 'ranked', tier, tierLabel: TIERS[tier], tiers: TIERS, region, regions: REGIONS, rows };
}
