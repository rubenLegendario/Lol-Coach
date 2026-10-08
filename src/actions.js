/** Acciones que modifican el cliente del LoL: runas, hechizos de invocador y set de objetos. */
import { ddragon } from './data/ddragon.js';
import { POS_LABEL } from './data/stats.js';
import { coachFor } from './engine/coach/index.js';

const PAGE_PREFIX = 'LoL Coach';
const FLASH = 4;

function requireBuild(plan) {
  if (!plan?.build) throw new Error('Todavía no hay campeón elegido');
  return plan.build;
}

export async function applyRunes(lcu, plan, index = 0) {
  const build = requireBuild(plan);
  const r = build.runes[index] || build.runes[0];
  if (!r) throw new Error('No hay runas para este campeón');

  const pages = (await lcu.get('/lol-perks/v1/pages')) || [];
  const inv = await lcu.get('/lol-perks/v1/inventory');
  const custom = pages.filter((p) => p.isDeletable);

  let replaced = null;
  const ours = custom.find((p) => p.name.startsWith(PAGE_PREFIX));
  if (ours) {
    await lcu.delete(`/lol-perks/v1/pages/${ours.id}`);
  } else if (inv && custom.length >= inv.ownedPageCount) {
    // Sin huecos libres: sustituimos la página activa (o la primera editable).
    const victim = custom.find((p) => p.current) || custom[0];
    if (!victim) throw new Error('No hay páginas de runas editables');
    await lcu.delete(`/lol-perks/v1/pages/${victim.id}`);
    replaced = victim.name;
  }

  const champ = ddragon.champ(plan.champId)?.name || '';
  await lcu.post('/lol-perks/v1/pages', {
    name: `${PAGE_PREFIX}: ${champ} ${POS_LABEL[plan.pos] || ''}`.trim().slice(0, 25),
    primaryStyleId: r.primaryStyle,
    subStyleId: r.subStyle,
    selectedPerkIds: [...r.primary, ...r.secondary, ...r.shards],
    current: true,
  });
  return replaced ? `Runas aplicadas (se sustituyó la página «${replaced}»)` : 'Runas aplicadas';
}

export async function applySpells(lcu, plan, index = 0) {
  const build = requireBuild(plan);
  const ids = (build.spells[index] || build.spells[0])?.ids;
  if (!ids?.length) throw new Error('No hay hechizos recomendados');
  let [a, b] = ids;

  // Respetamos en qué tecla sueles llevar Flash.
  const session = await lcu.get('/lol-champ-select/v1/session');
  const me = session?.myTeam?.find((p) => p.cellId === session.localPlayerCellId);
  if (me && (a === FLASH || b === FLASH)) {
    const other = a === FLASH ? b : a;
    if (me.spell2Id === FLASH) [a, b] = [other, FLASH];
    else if (me.spell1Id === FLASH) [a, b] = [FLASH, other];
  }
  await lcu.patch('/lol-champ-select/v1/session/my-selection', { spell1Id: a, spell2Id: b });
  return 'Hechizos aplicados';
}

export async function applyItemSet(lcu, plan, summonerId) {
  const build = requireBuild(plan);
  const champ = ddragon.champ(plan.champId);
  const block = (type, ids) => ({ type, items: ids.filter((id) => ddragon.item(id)).map((id) => ({ id: String(id), count: 1 })) });
  const uniq = (ids) => [...new Set(ids)];
  const coreIds = build.core[0]?.ids || [];

  const blocks = [
    block('Inicio', build.starter[0]?.ids || []),
    block('Botas', build.boots.map((b) => b.id)),
    block('Core (más jugado)', coreIds),
    block('Alternativas del core', uniq(build.core.slice(1).flatMap((c) => c.ids)).filter((id) => !coreIds.includes(id))),
    block('Situacionales', build.situational),
    // El ward de control solo en los roles cuyo coach lo pide (support y jungla)
    block('Consumibles', coachFor(plan.pos, { aram: plan.aram }).itemSetWards ? [2003, 2055] : [2003]),
  ].filter((b) => b.items.length);

  const sets = await lcu.get(`/lol-item-sets/v1/item-sets/${summonerId}/sets`);
  const title = `${PAGE_PREFIX}: ${champ?.name} ${POS_LABEL[plan.pos] || ''}`.trim();
  const uid = `lolcoach-${plan.champId}-${plan.pos || 'any'}`;
  const others = (sets?.itemSets || []).filter((s) => s.uid !== uid);
  others.push({
    title,
    associatedChampions: [plan.champId],
    associatedMaps: [plan.aram ? 12 : 11],
    blocks,
    map: 'any',
    mode: 'any',
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: 'blank',
    type: 'custom',
    uid,
  });
  await lcu.put(`/lol-item-sets/v1/item-sets/${summonerId}/sets`, { ...(sets || {}), itemSets: others });
  return 'Set de objetos creado: lo verás en la tienda del juego';
}
