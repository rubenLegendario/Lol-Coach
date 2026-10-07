/**
 * Logros de una partida (al estilo de las insignias de Blitz): MVP/ACE, primera sangre, multikills,
 * más farm, más daño… Todo sale de las estadísticas del cliente; solo la clasificación MVP es una estimación propia.
 */

const sum = (list, f) => list.reduce((a, p) => a + (f(p.stats) || 0), 0);
const cs = (st) => (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0);
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n));

/**
 * Puntuación estimada de cada jugador (para MVP/ACE y la clasificación 1º-10º).
 * Mezcla participación en kills y el reparto dentro de su equipo de daño, oro, visión, objetivos y aguante.
 * @returns Map participantId → { score, rank (1-10), teamRank, mvp, ace }
 */
export function mvpRanking(game) {
  const out = new Map();
  const rows = game.participants.map((p) => {
    const team = game.participants.filter((x) => x.teamId === p.teamId);
    const s = p.stats;
    const share = (f) => (f(s) || 0) / Math.max(1, sum(team, f));
    const tk = sum(team, (x) => x.kills);
    const kp = tk ? (s.kills + s.assists) / tk : 0;
    const kda = (s.kills + s.assists) / Math.max(1, s.deaths);
    const score = 3 * kp
      + 2.5 * share((x) => x.totalDamageDealtToChampions)
      + 1.5 * share((x) => x.goldEarned)
      + 1 * share((x) => x.visionScore)
      + 0.5 * share((x) => x.damageDealtToObjectives)
      + 0.8 * share((x) => x.totalDamageTaken + (x.damageSelfMitigated || 0))
      + 0.15 * Math.min(kda, 8)
      - 0.06 * s.deaths;
    return { id: p.participantId, teamId: p.teamId, win: !!s.win, score };
  });
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  for (const r of rows) {
    const mates = sorted.filter((x) => x.teamId === r.teamId);
    const teamRank = mates.indexOf(r) + 1;
    out.set(r.id, {
      score: Math.round(r.score * 100) / 100,
      rank: sorted.indexOf(r) + 1,
      teamRank,
      mvp: teamRank === 1 && r.win,
      ace: teamRank === 1 && !r.win,
    });
  }
  return out;
}

/**
 * Logros del jugador `pid` en la partida.
 * extra: { sr, minutes, events (línea temporal), goldChart, lane14, csTarget, pos, other }
 * other: true si el jugador no es el usuario (partidas de otros): los textos van en tercera persona.
 * @returns [{ id, title, detail, tier: 'epic'|'rare'|'common', icon }] de más a menos raro
 */
export function computeBadges(game, pid, extra = {}) {
  const { sr = game.mapId === 11, minutes = game.gameDuration / 60, events = [], goldChart = [], lane14 = null, csTarget = null, pos = null, other = false } = extra;
  /** Texto en segunda persona (tú) o en tercera (otro jugador). */
  const t = (you, them) => (other ? them : you);
  const me = game.participants.find((p) => p.participantId === pid);
  if (!me) return [];
  const s = me.stats;
  const all = game.participants;
  const team = all.filter((p) => p.teamId === me.teamId);
  const out = [];
  const add = (tier, id, icon, title, detail) => out.push({ id, tier, icon, title, detail });
  /** ¿Es el máximo de la lista (sin empatar a la baja) y supera un mínimo? */
  const top = (list, f, min = 1) => {
    const v = f(s) || 0;
    return v >= min && list.every((p) => p.participantId === pid || (f(p.stats) || 0) < v);
  };

  // MVP / ACE (estimación)
  const r = all.length === 10 ? mvpRanking(game).get(pid) : null; // solo en partidas de 5 contra 5
  if (r?.mvp && r.rank === 1) add('epic', 'mvp', 'crown', 'MVP', 'La mejor actuación de la partida (puntuación estimada).');
  else if (r?.mvp) add('epic', 'mvp', 'crown', 'MVP', 'La mejor actuación del equipo ganador (puntuación estimada).');
  else if (r?.ace) add('epic', 'ace', 'star', 'ACE', t('La mejor actuación de tu equipo aunque perdisteis (puntuación estimada).', 'La mejor actuación de su equipo aunque perdieron (puntuación estimada).'));

  // Multikills: solo la mayor
  if (s.pentaKills) add('epic', 'penta', 'burst', s.pentaKills > 1 ? `${s.pentaKills} pentakills` : 'Pentakill', '¡Los cinco rivales seguidos!');
  else if (s.quadraKills) add('epic', 'quadra', 'burst', s.quadraKills > 1 ? `${s.quadraKills} cuádruples` : 'Cuádruple', 'Cuatro kills seguidas.');
  else if (s.tripleKills) add('rare', 'triple', 'burst', s.tripleKills > 1 ? `${s.tripleKills} triples` : 'Triple', 'Tres kills seguidas.');
  else if (s.doubleKills) add('common', 'double', 'burst', s.doubleKills > 1 ? `${s.doubleKills} dobles` : 'Doble', 'Dos kills seguidas.');

  if (s.deaths === 0 && minutes >= 15) add('epic', 'deathless', 'shield', 'Inmortal', `0 muertes en ${Math.round(minutes)} minutos.`);

  // Remontada: ganar después de ir muy por detrás en oro
  const worst = Math.min(0, ...goldChart.map((g) => g.team));
  if (s.win && worst <= -3000) add('epic', 'comeback', 'up', 'Remontada', `${t('Ganasteis', 'Ganaron')} yendo ${(Math.abs(worst) / 1000).toFixed(1).replace('.', ',')}k de oro por detrás.`);

  if (s.largestKillingSpree >= 8) add('epic', 'legendary', 'flame', 'Legendario', `Racha de ${s.largestKillingSpree} kills sin morir.`);
  else if (s.largestKillingSpree >= 5) add('rare', 'spree', 'flame', 'Imparable', `Racha de ${s.largestKillingSpree} kills sin morir.`);

  if (s.firstBloodKill) add('rare', 'firstblood', 'sword', 'Primera sangre', t('La primera kill de la partida fue tuya.', 'La primera kill de la partida fue suya.'));
  else if (s.firstBloodAssist) add('common', 'firstblood-a', 'sword', 'Primera sangre (asistencia)', t('Ayudaste en la primera kill de la partida.', 'Ayudó en la primera kill de la partida.'));

  if (sr && s.firstTowerKill) add('rare', 'firsttower', 'flag', 'Primera torre', t('Destruiste la primera torre de la partida.', 'Destruyó la primera torre de la partida.'));
  else if (sr && s.firstTowerAssist) add('common', 'firsttower-a', 'flag', 'Primera torre (asistencia)', t('Participaste en la primera torre de la partida.', 'Participó en la primera torre de la partida.'));

  // Remates de objetivos (línea temporal)
  const mine = (type) => events.filter((e) => e.type === 'ELITE_MONSTER_KILL' && e.killerId === pid && e.monsterType === type).length;
  const barons = mine('BARON_NASHOR');
  const dragons = mine('DRAGON');
  if (barons) add('rare', 'baron', 'crown', t('Rematas el Barón', 'Remata el Barón'), `${t('Te llevaste', 'Se llevó')} el último golpe del Barón${barons > 1 ? ` ${barons} veces` : ''}.`);
  if (dragons >= 2) add('rare', 'dragons', 'flame', 'Cazadragones', `${t('Remataste', 'Remató')} ${dragons} dragones.`);

  // Farm
  const isSupport = pos === 'UTILITY';
  const csMin = cs(s) / Math.max(1, minutes);
  if (!isSupport && top(all, cs, 50)) add('rare', 'cs-top', 'coins', 'Rey del farmeo', `Más CS de la partida: ${cs(s)} (${csMin.toFixed(1).replace('.', ',')}/min).`);
  else if (!isSupport && sr && (csTarget ? csMin >= csTarget + 0.5 : csMin >= 8)) add('common', 'cs-good', 'coins', 'Buen farmeo', `${csMin.toFixed(1).replace('.', ',')} CS por minuto${csTarget ? ` (objetivo ${String(csTarget).replace('.', ',')})` : ''}.`);

  // Daño
  const dmg = (x) => x.totalDamageDealtToChampions;
  const dmgShare = Math.round((s.totalDamageDealtToChampions / Math.max(1, sum(team, dmg))) * 100);
  if (top(all, dmg, 1000)) add('rare', 'dmg-top', 'zap', 'Más daño de la partida', `${fmtK(s.totalDamageDealtToChampions)} de daño a campeones (${dmgShare}% de ${t('tu', 'su')} equipo).`);
  else if (top(team, dmg, 1000)) add('common', 'dmg-team', 'zap', t('Más daño de tu equipo', 'Más daño de su equipo'), `${fmtK(s.totalDamageDealtToChampions)} de daño a campeones (${dmgShare}%).`);

  const tk = sum(team, (x) => x.kills);
  const kp = tk ? (s.kills + s.assists) / tk : 0;
  if (tk >= 10 && kp >= 0.7) add('rare', 'kp', 'users', 'Siempre presente', `${t('Participaste', 'Participó')} en el ${Math.round(kp * 100)}% de las kills de ${t('tu', 'su')} equipo.`);

  if (lane14?.goldDiff >= 1000) add('rare', 'lane', 'swords', 'Dominio de línea', `+${lane14.goldDiff} de oro sobre ${t('tu', 'su')} rival al minuto 14.`);

  if (sr && top(all, (x) => x.visionScore, 15)) add('rare', 'vision', 'target', 'Ojos en todo el mapa', `Más puntuación de visión de la partida (${s.visionScore}).`);
  if (sr && top(all, (x) => x.wardsKilled, 5)) add('common', 'wardkill', 'crosshair', 'Cazawards', `Más wards destruidos de la partida (${s.wardsKilled}).`);

  if (sr && (top(all, (x) => x.damageDealtToTurrets, 3000) || s.turretKills >= 3)) add('rare', 'towers', 'flag', 'Demoledor', s.turretKills ? `${s.turretKills} torre${s.turretKills === 1 ? '' : 's'} rematada${s.turretKills === 1 ? '' : 's'} y ${fmtK(s.damageDealtToTurrets)} de daño a torres.` : `Más daño a torres de la partida (${fmtK(s.damageDealtToTurrets)}).`);

  if (top(all, (x) => x.totalDamageTaken + (x.damageSelfMitigated || 0), 10000)) add('common', 'tank', 'shield', 'Muro', `Más daño recibido y mitigado de la partida (${fmtK(s.totalDamageTaken + (s.damageSelfMitigated || 0))}).`);
  if (top(all, (x) => x.timeCCingOthers, 15)) add('common', 'cc', 'lock', 'Control de masas', `Más tiempo de control a rivales de la partida (${s.timeCCingOthers} s).`);
  if (top(all, (x) => x.goldEarned, 5000)) add('common', 'gold', 'coins', 'Más oro de la partida', `${fmtK(s.goldEarned)} de oro.`);

  const order = { epic: 0, rare: 1, common: 2 };
  return out.sort((a, b) => order[a.tier] - order[b.tier]);
}
