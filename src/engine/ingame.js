import { config } from '../config.js';
import { ddragon } from '../data/ddragon.js';
import { champProfile } from '../data/champinfo.js';
import { normPos } from '../data/stats.js';
import { buildView } from './views.js';
import { coachFor, coachInfo } from './coach/index.js';

// Objetos situacionales por necesidad y por "clase" de tu campeón. Se validan contra el parche actual.
const SITUATIONAL = {
  antiheal: { adc: [3033], assassin: [6609], bruiser: [6609], ap: [3165], tank: [3075], support: [3916] },
  vsAP: { adc: [3139, 3156], assassin: [3156], bruiser: [3156, 6665], ap: [3102], tank: [4401, 2504, 3065], support: [3190, 3222] },
  vsAD: { adc: [3026], assassin: [6333, 3026], bruiser: [6333, 3053], ap: [3157], tank: [3143, 3110, 3075], support: [3109, 3190] },
  vsTank: { adc: [3036, 3153], assassin: [3071], bruiser: [3071, 3153], ap: [3135, 6653], tank: [], support: [] },
  vsCC: { adc: [3139], assassin: [3140], bruiser: [3111], ap: [3111, 3140], tank: [3111], support: [3222, 3111] },
  vsCrit: { tank: [3143], bruiser: [3143], support: [], adc: [], ap: [], assassin: [] },
  vsBurst: { ap: [3157], adc: [3026], support: [3190], bruiser: [3053], assassin: [3026], tank: [] },
};
const BOOTS_VS_AP = 3111;
const BOOTS_VS_AD = 3047;
const IONIAN_BOOTS = 3158;
const DRAGON_ES = { Fire: 'Infernal', Water: 'Océano', Earth: 'Montaña', Air: 'Nube', Hextech: 'Hextech', Chemtech: 'Quimtech' };
const BOOT_IDS =new Set([1001, 3006, 3009, 3020, 3047, 3111, 3117, 3158, 2422]);

function teamOfName(live) {
  const map = new Map();
  for (const p of live.allPlayers) {
    for (const n of [p.riotIdGameName, p.summonerName, p.riotId]) if (n) map.set(n, p.team);
  }
  return map;
}

function findMe(live) {
  const a = live.activePlayer;
  return (
    live.allPlayers.find((p) => p.riotId && p.riotId === a.riotId) ||
    live.allPlayers.find((p) => p.riotIdGameName && p.riotIdGameName === a.riotIdGameName) ||
    live.allPlayers.find((p) => p.summonerName && p.summonerName === a.summonerName) ||
    null
  );
}

function inventoryCounts(player) {
  const inv = new Map();
  for (const it of player.items || []) inv.set(it.itemID, (inv.get(it.itemID) || 0) + (it.count || 1));
  return inv;
}

/**
 * Objetos que cuentan como "ya los tienes": los del inventario y aquello de lo que salen sus mejoras
 * (unas Grebas de metal cuentan como Grebas de berserker, un Muramana como Manamune).
 */
export function ownedSet(inv) {
  const out = new Set();
  const add = (id) => {
    if (out.has(id)) return;
    out.add(id);
    const it = ddragon.item(id);
    // Solo se baja a botas y objetos completos (no a componentes sueltos)
    for (const c of it?.from || []) if (BOOT_IDS.has(c) || (ddragon.item(c)?.gold || 0) >= 2000) add(c);
  };
  for (const id of inv.keys()) add(id);
  return out;
}

/** Las botas que llevas (de nivel 2 o 3), o null. */
export function ownedBoots(owned) {
  const isBoots = (id) => id !== 1001 && (BOOT_IDS.has(id) || (ddragon.item(id)?.from || []).some((c) => c !== 1001 && BOOT_IDS.has(c)));
  const list = [...owned].filter(isBoots);
  return list.find((id) => !BOOT_IDS.has(id)) || list[0] || null; // mejor la de nivel 3 si la llevas
}

/** Oro que falta para completar `id` teniendo en cuenta los componentes que ya llevas. */
function remainingCost(id, inv) {
  if ((inv.get(id) || 0) > 0) {
    inv.set(id, inv.get(id) - 1);
    return 0;
  }
  const it = ddragon.item(id);
  if (!it) return 0;
  const compsTotal = it.from.reduce((s, c) => s + (ddragon.item(c)?.gold || 0), 0);
  return it.gold - compsTotal + it.from.reduce((s, c) => s + remainingCost(c, inv), 0);
}

/** Qué comprar ahora mismo hacia `id` con `budget` de oro (el objeto entero o los componentes más caros que quepan). */
function shopFor(id, inv, budget) {
  if ((inv.get(id) || 0) > 0) {
    inv.set(id, inv.get(id) - 1);
    return { buy: [], spent: 0 };
  }
  const cost = remainingCost(id, new Map(inv));
  if (cost <= budget) {
    remainingCost(id, inv); // consume los componentes del inventario
    return { buy: [id], spent: cost };
  }
  const it = ddragon.item(id);
  const buy = [];
  let spent = 0;
  for (const c of [...(it?.from || [])].sort((a, b) => (ddragon.item(b)?.gold || 0) - (ddragon.item(a)?.gold || 0))) {
    const r = shopFor(c, inv, budget - spent);
    buy.push(...r.buy);
    spent += r.spent;
  }
  return { buy, spent };
}

function itemGold(player) {
  return (player.items || []).reduce((s, it) => s + (ddragon.item(it.itemID)?.gold || 0) * (it.count || 1), 0);
}

const DAMAGE_TAGS = ['SpellDamage', 'Damage', 'AttackSpeed', 'CriticalStrike'];

/** Oro en objetos puramente defensivos (los de daño con algo de vida no cuentan). */
function defensiveGold(player) {
  return (player.items || []).reduce((s, it) => {
    const item = ddragon.item(it.itemID);
    if (!item || item.tags.includes('Boots') || item.tags.some((t) => DAMAGE_TAGS.includes(t))) return s;
    return item.tags.some((t) => ['Health', 'Armor', 'SpellBlock'].includes(t)) ? s + item.gold : s;
  }, 0);
}

function tagGold(player, tags) {
  return (player.items || []).reduce((s, it) => {
    const item = ddragon.item(it.itemID);
    return item && item.tags.some((t) => tags.includes(t)) ? s + item.gold : s;
  }, 0);
}

/** Perfil de un equipo: reparto de daño, tanques, asesinos, curación, CC, oro y quién va fed. */
function teamProfile(players) {
  let apW = 0, adW = 0;
  const healers = [], tanks = [], assassins = [], mages = [], marksmen = [], fed = [];
  let highCc = 0, critCarriers = 0, kills = 0, gold = 0, defGoldTotal = 0;
  for (const p of players) {
    const prof = champProfile(ddragon.champOfPlayer(p)?.key) || { damage: 'AD', cc: 1, cls: 'bruiser' };
    const name = ddragon.champOfPlayer(p)?.name || p.championName;
    const base = prof.damage === 'AP' ? 1 : prof.damage === 'MIXED' ? 0.5 : 0;
    const ap = tagGold(p, ['SpellDamage']);
    const ad = tagGold(p, ['Damage', 'AttackSpeed', 'CriticalStrike']);
    const apFrac = ap + ad > 800 ? 0.5 * base + (0.5 * ap) / (ap + ad) : base;
    const k = p.scores?.kills || 0;
    const d = p.scores?.deaths || 0;
    const g = itemGold(p);
    kills += k;
    gold += g;
    const w = 1 + k * 0.15 + g / 4000;
    apW += w * apFrac;
    adW += w * (1 - apFrac);
    const defGold = defensiveGold(p);
    defGoldTotal += defGold;
    if (prof.healer || tagGold(p, ['LifeSteal', 'SpellVamp']) >= 2500) healers.push(name);
    if (prof.tank || defGold >= 5000) tanks.push(name);
    else if (prof.cls === 'assassin') assassins.push(name);
    else if (prof.cls === 'ap') mages.push(name);
    else if (prof.cls === 'adc') marksmen.push(name);
    if (prof.cc >= 3) highCc++;
    if ((p.items || []).filter((it) => ddragon.item(it.itemID)?.tags.includes('CriticalStrike')).length >= 2) critCarriers++;
    if (k - d >= 4 || (k >= 7 && k >= d * 1.5)) fed.push({ name, kills: k, deaths: d, burst: prof.cls === 'assassin' || prof.damage === 'AP' });
  }
  const total = apW + adW || 1;
  const ap = Math.round((apW / total) * 100);
  const style = [];
  if (tanks.length >= 2) style.push('Muy tanque');
  if (assassins.length >= 2) style.push('Asesinos / burst');
  if (ap >= 65) style.push('Mayoría AP');
  else if (ap <= 35) style.push('Mayoría AD');
  else style.push('Daño mixto');
  if (healers.length >= 2) style.push('Mucha curación');
  if (highCc >= 3) style.push('Mucho CC');
  if (marksmen.length >= 2) style.push('Daño sostenido');
  return { ap, ad: 100 - ap, healers, tanks, assassins, mages, marksmen, highCc, critCarriers, fed, kills, gold, defGold: defGoldTotal, style };
}

/** Frases comparando los dos equipos. */
function compareTeams(a, e) {
  const out = [];
  const diff = a.gold - e.gold;
  if (Math.abs(diff) >= 1000) out.push({ type: diff > 0 ? 'good' : 'bad', text: `${diff > 0 ? 'Tu equipo saca' : 'El rival os saca'} ${(Math.abs(diff) / 1000).toFixed(1)}k de oro en objetos` });
  else out.push({ type: 'info', text: 'El oro está igualado' });
  if (e.tanks.length > a.tanks.length) out.push({ type: 'warn', text: `El rival va más tanque (${e.tanks.length} vs ${a.tanks.length}): penetración y daño sostenido` });
  else if (a.tanks.length > e.tanks.length) out.push({ type: 'good', text: `Tu equipo tiene más frontline (${a.tanks.length} vs ${e.tanks.length})` });
  if (e.assassins.length >= 2) out.push({ type: 'warn', text: `El rival tiene asesinos (${e.assassins.join(', ')}): no vayas solo y ten Zhonya/Ángel a mano` });
  if (e.ap >= 65) out.push({ type: 'warn', text: `El rival hace ${e.ap}% de daño mágico: resistencia mágica rinde mucho` });
  else if (e.ad >= 65) out.push({ type: 'warn', text: `El rival hace ${e.ad}% de daño físico: armadura rinde mucho` });
  if (a.ap >= 75) out.push({ type: 'info', text: 'Tu equipo es casi todo AP: el rival puede comprar resistencia mágica' });
  else if (a.ad >= 75) out.push({ type: 'info', text: 'Tu equipo es casi todo AD: el rival puede comprar armadura' });
  if (e.healers.length) out.push({ type: 'warn', text: `Curación rival: ${e.healers.join(', ')} → antiheal` });
  for (const f of e.fed) out.push({ type: 'bad', text: `${f.name} va fed (${f.kills}/${f.deaths}): cuidado` });
  return out;
}

/** Empareja jugadores aliados y rivales: por posición si la hay; si no (ARAM), por oro. */
function pairPlayers(players, myTeam) {
  const allies = players.filter((p) => p.team === myTeam);
  const enemies = players.filter((p) => p.team !== myTeam);
  const withPos = (list) => list.filter((p) => p.pos).length >= 4;
  const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  let A, E;
  if (withPos(allies) && withPos(enemies)) {
    const byPos = (list) => [...list].sort((x, y) => order.indexOf(x.pos) - order.indexOf(y.pos));
    A = byPos(allies);
    E = byPos(enemies);
  } else {
    const byGold = (list) => [...list].sort((x, y) => y.gold - x.gold);
    A = byGold(allies);
    E = byGold(enemies);
  }
  const n = Math.max(A.length, E.length);
  return Array.from({ length: n }, (_, i) => ({
    ally: A[i] ? players.indexOf(A[i]) : -1,
    enemy: E[i] ? players.indexOf(E[i]) : -1,
    diff: (A[i]?.gold || 0) - (E[i]?.gold || 0),
  }));
}

function situationalAdvice(threat, cls, owned, gameTime, mapId) {
  const out = [];
  const add = (need, reason, priority) => {
    for (const id of SITUATIONAL[need]?.[cls] || []) {
      const it = ddragon.item(id);
      if (!it || !ddragon.buyable(id, mapId) || owned.has(id) || out.some((o) => o.id === id)) continue;
      out.push({ id, reason, priority });
      break; // la primera opción válida de cada necesidad
    }
  };
  if (threat.healers.length) add('antiheal', `Curación enemiga: ${threat.healers.join(', ')}`, threat.healers.length >= 2 ? 3 : 2);
  if (threat.ap >= 60) add('vsAP', `Su daño es ${threat.ap}% mágico`, threat.ap >= 70 ? 3 : 2);
  if (threat.ad >= 65) add('vsAD', `Su daño es ${threat.ad}% físico`, threat.ad >= 75 ? 3 : 2);
  if (threat.tanks.length >= 2) add('vsTank', `Tanques: ${threat.tanks.join(', ')}`, 2);
  if (threat.highCc >= 3) add('vsCC', 'Mucho control de masas enemigo', 2);
  if (threat.critCarriers >= 1) add('vsCrit', 'Llevan builds de crítico', 1);
  const burst = threat.fed.find((f) => f.burst);
  if (burst) add('vsBurst', `${burst.name} va fed (${burst.kills}/${burst.deaths})`, 3);
  if (gameTime < 240) for (const o of out) o.priority = Math.min(o.priority, 1);
  return out.sort((a, b) => b.priority - a.priority);
}

function bootsAdvice(threat, owned, planBoots, cls) {
  if (cls === 'adc' && threat.ap < 75) return null; // los ADC suelen ir con sus botas de velocidad de ataque
  if (ownedBoots(owned)) return null;
  if ((threat.ap >= 60 || threat.highCc >= 3) && planBoots !== BOOTS_VS_AP) return { id: BOOTS_VS_AP, reason: threat.highCc >= 3 ? 'Mucho CC enemigo' : 'Daño enemigo mayoritariamente mágico' };
  if (threat.ad >= 70 && planBoots !== BOOTS_VS_AD) return { id: BOOTS_VS_AD, reason: 'Daño enemigo mayoritariamente físico' };
  return null;
}

/** Siguiente habilidad a subir según el orden recomendado. */
function nextSkill(order, level, abilities) {
  if (!order?.length || !abilities) return null;
  const cur = { Q: abilities.Q?.abilityLevel || 0, W: abilities.W?.abilityLevel || 0, E: abilities.E?.abilityLevel || 0, R: abilities.R?.abilityLevel || 0 };
  const spent = cur.Q + cur.W + cur.E + cur.R;
  if (spent >= level) return null;
  const want = { Q: 0, W: 0, E: 0, R: 0 };
  for (let i = 0; i < Math.min(level, order.length); i++) {
    want[order[i]]++;
    if (want[order[i]] > cur[order[i]]) return order[i];
  }
  return null;
}

function objectives(live, myTeam) {
  const gameTime = live.gameData?.gameTime || 0;
  const teamOf = teamOfName(live);
  const events = live.events?.Events || [];
  const drakes = { ally: [], enemy: [] };
  let lastDragon = null;
  let lastBaron = null;
  for (const ev of events) {
    if (ev.EventName === 'DragonKill') {
      lastDragon = ev;
      if (ev.DragonType !== 'Elder') drakes[teamOf.get(ev.KillerName) === myTeam ? 'ally' : 'enemy'].push(DRAGON_ES[ev.DragonType] || ev.DragonType);
    } else if (ev.EventName === 'BaronKill') lastBaron = ev;
  }
  const soulTaken = drakes.ally.length >= 4 || drakes.enemy.length >= 4;
  const dragonAt = lastDragon ? lastDragon.EventTime + (soulTaken ? 360 : 300) : 300;
  const baronAt = lastBaron ? lastBaron.EventTime + 360 : config.baronFirstSpawn;

  // Larvas y heraldo: aparecen una vez; desaparecen del timer cuando alguien los mata
  const grubsKilled = events.some((e) => /horde|grub/i.test(e.EventName));
  const heraldKilled = events.some((e) => e.EventName === 'HeraldKill');
  const grubs = !grubsKilled && gameTime < config.heraldSpawn - 15 ? { label: 'Larvas del Vacío', at: config.grubsSpawn, up: gameTime >= config.grubsSpawn } : null;
  const herald = !heraldKilled && gameTime < config.heraldDespawn ? { label: 'Heraldo', at: config.heraldSpawn, up: gameTime >= config.heraldSpawn } : null;

  // Inhibidores destruidos que van a reaparecer ("Barracks_T1_L1": T1 = equipo azul, L/C/R = top/mid/bot)
  const inhibs = [];
  const lastInhib = new Map();
  for (const e of events) {
    if (e.EventName === 'InhibKilled' && e.InhibKilled) lastInhib.set(e.InhibKilled, e.EventTime);
    if (e.EventName === 'InhibRespawned' && e.InhibRespawned) lastInhib.delete(e.InhibRespawned);
  }
  for (const [name, time] of lastInhib) {
    const at = time + config.inhibRespawn;
    if (at <= gameTime) continue;
    const blue = /_T1_/.test(name);
    const lane = /_L\d/.test(name) ? 'top' : /_C\d/.test(name) ? 'mid' : /_R\d/.test(name) ? 'bot' : '';
    const mine = (myTeam === 'ORDER') === blue;
    inhibs.push({ label: mine ? `Tu inhibidor${lane ? ' de ' + lane : ''}` : `Inhibidor rival${lane ? ' de ' + lane : ''}`, team: mine ? 'ally' : 'enemy', at });
  }
  return {
    dragon: { label: soulTaken ? 'Dragón ancestral' : 'Dragón', at: dragonAt, up: gameTime >= dragonAt },
    baron: { label: 'Barón Nashor', at: baronAt, up: gameTime >= baronAt },
    grubs,
    herald,
    inhibs,
    drakes,
  };
}

function summonerSpells(p) {
  const haste = (p.items || []).some((it) => it.itemID === IONIAN_BOOTS) ? 10 : 0;
  return ['summonerSpellOne', 'summonerSpellTwo']
    .map((k) => ddragon.spellByRaw(p.summonerSpells?.[k]?.rawDisplayName))
    .filter(Boolean)
    .map((s) => ({ ...s, cooldown: Math.round((s.cooldown * 100) / (100 + haste)) }));
}

function playerView(p, meName) {
  const champ = ddragon.champOfPlayer(p);
  return {
    name: p.riotId || p.summonerName,
    isMe: (p.riotId || p.summonerName) === meName,
    team: p.team,
    pos: normPos(p.position),
    champ: champ ? ddragon.champView(champ.key) : { name: p.championName, icon: null },
    champKey: champ?.key || null,
    level: p.level,
    kills: p.scores?.kills || 0,
    deaths: p.scores?.deaths || 0,
    assists: p.scores?.assists || 0,
    cs: p.scores?.creepScore || 0,
    vision: Math.round((p.scores?.wardScore || 0) * 10) / 10,
    gold: itemGold(p),
    items: (p.items || []).sort((a, b) => a.slot - b.slot).map((it) => ddragon.itemView(it.itemID)).filter(Boolean),
    isDead: !!p.isDead,
    respawn: p.respawnTimer ? Math.ceil(p.respawnTimer) : 0,
    spells: summonerSpells(p),
  };
}

/** Apunta en el registro tus objetos con su ranura cuando cambian (para comprobar la ranura de la misión de rol). */
let lastItemsLog = '';
function logItems(p) {
  const txt = (p.items || []).map((it) => `${it.slot}:${it.itemID}`).join(' ');
  if (txt === lastItemsLog) return;
  lastItemsLog = txt;
  console.log(`[objetos] ${normPos(p.position) || '?'} · ${txt || 'vacío'}`);
}

function completedItems(player) {
  return (player.items || []).filter((it) => {
    const item = ddragon.item(it.itemID);
    return item && !item.into.length && item.gold >= 2000 && !item.tags.includes('Boots') && !item.tags.includes('Consumable');
  }).length;
}

/** Winrate del campeón en el tramo de duración de la partida (curva de OP.GG). */
function curveAt(lengths, minute) {
  if (!lengths?.length) return null;
  const sorted = [...lengths].sort((a, b) => a.minutes - b.minutes);
  let pick = sorted[0];
  for (const l of sorted) if (l.minutes <= minute) pick = l;
  return pick.winRate;
}

const SPIKE_LEVELS = [6, 11, 16];
const SPIKE_NAMES = ['primer objeto', 'segundo objeto', 'tercer objeto'];

/**
 * Próximo power spike de un jugador: el siguiente objeto de su build (con cuánto oro le falta,
 * teniendo en cuenta los componentes que ya lleva) y el siguiente nivel clave.
 */
function spikeTrack(player, core, currentGold = null) {
  const inv = inventoryCounts(player);
  const owned = ownedSet(inv);
  const list = (core || []).filter((id) => ddragon.item(id));
  const done = list.filter((id) => owned.has(id)).length;
  const nextId = list.find((id) => !owned.has(id)) || null;
  const next = nextId ? ddragon.item(nextId) : null;
  const remaining = nextId ? remainingCost(nextId, new Map(inv)) : 0;
  const idx = nextId ? list.indexOf(nextId) : -1;
  return {
    level: player.level,
    nextLevel: SPIKE_LEVELS.find((l) => player.level < l) || null,
    hasUlt: player.level >= 6,
    itemsDone: done,
    itemsTotal: list.length,
    completed: list.filter((id) => owned.has(id)).map((id) => ddragon.itemView(id)),
    next: next ? { ...ddragon.itemView(nextId), spike: SPIKE_NAMES[idx] || 'siguiente objeto', twoItem: idx === 1 } : null,
    remaining,
    missing: currentGold != null ? Math.max(0, remaining - currentGold) : null,
    progress: next ? Math.max(0, Math.min(100, Math.round((1 - remaining / next.gold) * 100))) : 100,
  };
}

/**
 * Ventana de poder contra tu rival de línea: niveles (y quién tiene la R), objetos completos,
 * oro en objetos y la curva de fuerza de cada campeón según el minuto de la partida.
 */
function powerWindow(meP, opp, gameTime, plan, currentGold = null, coach = coachFor(null)) {
  if (!opp) return null;
  const reasons = [];
  let score = 0;
  const oppName = ddragon.champOfPlayer(opp)?.name || opp.championName;
  const lv = meP.level - opp.level;
  if (lv) {
    score += lv * 0.8;
    reasons.push({ type: lv > 0 ? 'good' : 'bad', text: lv > 0 ? `Le sacas ${lv} nivel${lv > 1 ? 'es' : ''}` : `Te saca ${-lv} nivel${lv < -1 ? 'es' : ''}` });
  }
  for (const k of [6, 11, 16]) {
    if (meP.level >= k && opp.level < k) { score += 1.5; reasons.push({ type: 'good', text: k === 6 ? `Tienes la R y ${oppName} no: busca all-in` : `Tienes la R mejorada (nivel ${k}) antes que él` }); break; }
    if (opp.level >= k && meP.level < k) { score -= 1.5; reasons.push({ type: 'bad', text: k === 6 ? `${oppName} ya tiene la R y tú no: cuidado con su all-in` : `${oppName} tiene la R mejorada (nivel ${k}) antes que tú` }); break; }
  }
  const items = completedItems(meP) - completedItems(opp);
  if (items) {
    score += items * 1.5;
    reasons.push({ type: items > 0 ? 'good' : 'bad', text: items > 0 ? `Llevas ${items} objeto${items > 1 ? 's' : ''} completo${items > 1 ? 's' : ''} más` : `Lleva ${-items} objeto${items < -1 ? 's' : ''} completo${items < -1 ? 's' : ''} más que tú` });
  }
  const gold = itemGold(meP) - itemGold(opp);
  if (Math.abs(gold) >= 400) {
    score += gold / 1000;
    reasons.push({ type: gold > 0 ? 'good' : 'bad', text: `${gold > 0 ? '+' : '−'}${Math.abs(gold)} de oro en objetos` });
  }
  const minute = gameTime / 60;
  const mine = curveAt(plan?.build?.lengths, minute);
  const theirs = curveAt(plan?.oppLengths, minute);
  if (mine != null && theirs != null) {
    const d = mine - theirs;
    if (Math.abs(d) >= 0.01) {
      score += d * 40;
      reasons.push({ type: d > 0 ? 'good' : 'bad', text: d > 0 ? `A estas alturas tu campeón rinde más que ${oppName}` : `A estas alturas ${oppName} rinde más que tu campeón` });
    }
    const lateMine = curveAt(plan.build.lengths, 40);
    const lateTheirs = curveAt(plan.oppLengths, 40);
    if (lateMine != null && lateTheirs != null && minute < 25) {
      const late = lateMine - lateTheirs;
      if (late - d >= 0.015) reasons.push({ type: 'info', text: 'Escalas mejor que él: no fuerces, el tiempo juega a tu favor' });
      else if (d - late >= 0.015) reasons.push({ type: 'warn', text: 'Él escala mejor: aprovecha tu ventana antes de que se cierre' });
    }
  }
  if (opp.isDead) {
    score += 1;
    // Qué hacer mientras está muerto depende de tu rol (texto del coach, sin el punto final)
    reasons.push({ type: 'good', text: coach.live.oppDead(oppName, Math.ceil(opp.respawnTimer || 0)).text.replace(/\.$/, '') });
  }
  const verdict = score >= 1.5 ? 'ahead' : score <= -1.5 ? 'behind' : 'even';
  return {
    opp: ddragon.champView(ddragon.champOfPlayer(opp)?.key),
    verdict,
    title: { ahead: 'Ventaja: busca pelea', even: 'Igualado: juega a tu ritmo', behind: 'Desventaja: juega seguro' }[verdict],
    score: Math.round(score * 10) / 10,
    reasons,
    me: { level: meP.level, items: completedItems(meP), gold: itemGold(meP) },
    them: { level: opp.level, items: completedItems(opp), gold: itemGold(opp) },
    spikes: {
      me: spikeTrack(meP, plan?.build?.core?.[0]?.ids, currentGold),
      them: spikeTrack(opp, plan?.oppCore),
    },
    oppDead: !!opp.isDead,
    oppRespawn: opp.respawnTimer ? Math.ceil(opp.respawnTimer) : 0,
  };
}

/** Recomendaciones en partida a partir de la Live Client API y el plan (build) del campeón. */
export function analyzeInGame(live, plan) {
  const meP = findMe(live);
  if (!meP) return null;
  const myTeam = meP.team;
  const gameTime = live.gameData?.gameTime || 0;
  const gold = Math.floor(live.activePlayer.currentGold || 0);
  const level = live.activePlayer.level || meP.level;
  const myKey = ddragon.champOfPlayer(meP)?.key;
  const prof = champProfile(myKey);
  const mapId = live.gameData?.mapNumber || 11;
  const aram = live.gameData?.gameMode === 'ARAM' || mapId === 12;
  // Si no reconocemos tu campeón, mejor no recomendar situacionales que recomendar los de otra clase
  let cls = !prof ? null : normPos(meP.position) === 'UTILITY' ? 'support' : prof.cls;
  // Un "support" que no juega de support (p. ej. Seraphine en ARAM) y va con objetos de AP es un mago
  if (cls === 'support' && normPos(meP.position) !== 'UTILITY') {
    const ids = [...(meP.items || []).map((it) => it.itemID), ...(plan?.champId === myKey ? plan.build?.core?.[0]?.ids || [] : [])];
    const apItems = ids.filter((id) => { const t = ddragon.item(id)?.tags || []; return t.includes('SpellDamage') && !t.includes('ManaRegen'); });
    if (apItems.length >= 2) cls = 'ap';
  }

  const enemies = live.allPlayers.filter((p) => p.team !== myTeam);
  const allies = live.allPlayers.filter((p) => p.team === myTeam);
  const inv = inventoryCounts(meP);
  const owned = ownedSet(inv);
  logItems(meP);
  const threat = teamProfile(enemies);
  const allyProfile = teamProfile(allies);
  const build = plan?.build && plan.champId === myKey ? plan.build : null;

  // Orden de compra: primer objeto del core, botas, resto del core y después situacionales/opciones de OP.GG
  const core = build?.core?.[0]?.ids || [];
  const planBoots = build?.boots?.[0]?.id || null;
  const sit = cls ? situationalAdvice(threat, cls, owned, aram ? gameTime + 600 : gameTime, mapId) : [];
  const bootsSwap = cls ? bootsAdvice(threat, owned, planBoots, cls) : null;
  // Si ya llevas botas (las que sean, también las de la ranura de la misión de rol), cuentan como hechas
  const boots = ownedBoots(owned) || bootsSwap?.id || planBoots;
  const order = [core[0], boots, ...core.slice(1), ...sit.filter((s) => s.priority >= 2).map((s) => s.id), ...(build?.situational || [])]
    .filter((id, i, arr) => id && arr.indexOf(id) === i && ddragon.buyable(id, mapId));

  const target = order.find((id) => !owned.has(id)) || null;
  let shopping = null;
  if (target) {
    const { buy, spent } = shopFor(target, new Map(inv), gold);
    const remaining = remainingCost(target, new Map(inv));
    shopping = {
      target: ddragon.itemView(target),
      remaining,
      missing: Math.max(0, remaining - gold),
      buyNow: buy.map((id) => ddragon.itemView(id)).filter(Boolean),
      spend: spent,
      why: bootsSwap && target === bootsSwap.id ? bootsSwap.reason : sit.find((s) => s.id === target)?.reason || null,
    };
  }

  const opp = enemies.find((e) => normPos(e.position) && normPos(e.position) === normPos(meP.position));
  const meName = meP.riotId || meP.summonerName;
  const players = live.allPlayers.map((p) => playerView(p, meName));
  const skill = nextSkill(build?.skills?.order, level, live.activePlayer.abilities);

  return {
    gameTime,
    gameMode: live.gameData?.gameMode,
    me: { champ: ddragon.champView(myKey), level, gold, pos: normPos(meP.position), cls },
    build: buildView(build),
    buildOrder: order.slice(0, 7).map((id) => ({ ...ddragon.itemView(id), owned: owned.has(id) })),
    shopping,
    situational: sit.map((s) => ({ item: ddragon.itemView(s.id), reason: s.reason, priority: s.priority })),
    bootsSwap: bootsSwap ? { item: ddragon.itemView(bootsSwap.id), reason: bootsSwap.reason } : null,
    skill: skill ? { key: skill, order: build?.skills?.order || [] } : null,
    skillOrder: build?.skills?.order || [],
    skillMax: build?.skills?.max || [],
    threat,
    teams: { ally: allyProfile, enemy: threat, insights: compareTeams(allyProfile, threat), pairs: pairPlayers(players, myTeam) },
    unknownChamp: !prof,
    aram,
    objectives: aram ? null : objectives(live, myTeam),
    goldDiff: allyProfile.gold - threat.gold,
    laneOppIndex: opp ? live.allPlayers.indexOf(opp) : -1,
    power: aram ? null : powerWindow(meP, opp, gameTime, plan?.champId === myKey ? plan : null, gold, coachFor(normPos(meP.position))),
    coach: coachInfo(coachFor(normPos(meP.position), { aram })),
    players,
    myTeam,
  };
}
