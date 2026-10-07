/**
 * Datos de la pantalla de partida al estilo de iTero: puntuaciones de 0 a 5 (2.5 = normal) para
 * tu campeón, la fase de líneas, las sinergias con cada aliado, los counters contra cada rival y
 * la fuerza de cada equipo en early / mid / late.
 *
 * Se calcula una vez por partida (los campeones no cambian) con datos de OP.GG ya cacheados.
 */
import { ddragon } from '../data/ddragon.js';
import { tierList, getBuild, synergies } from '../data/stats.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (x) => Math.round(x * 10) / 10;
/** Winrate (0-1) → puntuación 0-5: 45% = 0, 50% = 2.5, 55% = 5. */
export const wrScore = (wr) => (wr == null ? null : r1(clamp(((wr - 0.45) / 0.1) * 5, 0, 5)));
/** Ventaja (diferencia de winrate entre equipos, 0-1) → 0-5. */
const advScore = (d) => (d == null ? null : r1(clamp(2.5 + d * 50, 0, 5)));
const avg = (list) => { const v = list.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

/** Winrate de un campeón según la duración de la partida: early (≤25'), mid (25-35'), late (35'+). */
function phases(lengths) {
  const at = (lo, hi) => avg((lengths || []).filter((l) => l.minutes > lo && l.minutes <= hi).map((l) => l.winRate));
  return { early: at(0, 25), mid: at(25, 35), late: at(35, 99) };
}

export async function iteroView(g, { mastery = 0 } = {}) {
  const me = g.players.find((p) => p.isMe);
  if (!me) return null;
  const allies = g.players.filter((p) => p.team === g.myTeam && !p.isMe);
  const enemies = g.players.filter((p) => p.team !== g.myTeam);
  const all = [me, ...allies, ...enemies];
  const info = (p) => ddragon.champ(p.champKey)?.info || {};

  // Daño y tanqueza de cada equipo a partir de las valoraciones de Riot (0-10)
  const dmg = (team) => r1(avg(team.map((p) => Math.max(info(p).attack || 0, info(p).magic || 0))) / 2);
  const tank = (team) => r1(avg(team.map((p) => info(p).defense || 0)) / 2);
  const myTeam = [me, ...allies];
  const team = {
    ad: { my: g.teams.ally.ad, enemy: g.teams.enemy.ad },
    damage: { my: dmg(myTeam), enemy: dmg(enemies) },
    tankiness: { my: tank(myTeam), enemy: tank(enemies) },
  };

  if (g.aram) {
    return { aram: true, me: { champ: me.champ, mastery }, team };
  }

  const tl = await tierList();
  const builds = new Map(await Promise.all(all.map(async (p) => [p.champKey, p.pos ? await getBuild(p.champKey, p.pos).catch(() => null) : null])));
  const myBuild = builds.get(me.champKey);

  // Counters: tu winrate contra cada rival (desde tus counters o, si no, desde los suyos)
  const vsWr = (e) => {
    const c = myBuild?.counters?.find((x) => x.champId === e.champKey && x.games >= 30);
    if (c) return { wr: c.winRate, games: c.games };
    const o = builds.get(e.champKey)?.counters?.find((x) => x.champId === me.champKey && x.games >= 30);
    return o ? { wr: 1 - o.winRate, games: o.games } : null;
  };
  const counters = enemies.map((e) => { const v = vsWr(e); return { champ: e.champ, pos: e.pos, wr: v ? r1(v.wr * 100) : null, games: v?.games || 0, score: wrScore(v?.wr) }; });

  // Sinergias: tu winrate jugando junto a cada aliado
  const mySyn = me.pos ? await synergies(me.champKey, me.pos).catch(() => null) : null;
  const synergy = [];
  for (const a of allies) {
    let s = a.pos ? mySyn?.get(`${a.champKey}:${a.pos}`) : null;
    if (!s && a.pos && me.pos) s = (await synergies(a.champKey, a.pos).catch(() => null))?.get(`${me.champKey}:${me.pos}`);
    synergy.push({ champ: a.champ, pos: a.pos, wr: s ? r1(s.winRate * 100) : null, games: s?.games || 0, score: wrScore(s?.winRate) });
  }

  // Fuerza por fase de la partida (media del equipo) y ventaja frente al rival
  const ph = (list) => { const p = list.map((x) => phases(builds.get(x.champKey)?.lengths)); return { early: avg(p.map((x) => x.early)), mid: avg(p.map((x) => x.mid)), late: avg(p.map((x) => x.late)) }; };
  const mine = ph(myTeam);
  const theirs = ph(enemies);
  const adv = (k) => (mine[k] != null && theirs[k] != null ? mine[k] - theirs[k] : null);
  team.early = advScore(adv('early'));
  team.mid = advScore(adv('mid'));
  team.late = advScore(adv('late'));

  // Fase de líneas
  const opp = enemies.find((e) => e.pos && e.pos === me.pos) || null;
  const oppMu = opp ? counters.find((c) => c.champ?.key === opp.champKey) : null;
  const myPh = phases(myBuild?.lengths);
  const patch = tl.champions[me.champKey]?.[me.pos];
  const laningStrength = wrScore(myPh.early ?? patch?.winRate);
  const laning = {
    strength: laningStrength,
    opp: opp ? { champ: opp.champ, score: oppMu?.score ?? null, wr: oppMu?.wr ?? null, games: oppMu?.games || 0 } : null,
    score: r1(avg([laningStrength, oppMu?.score]) ?? 2.5),
  };

  const synAvg = avg(synergy.map((s) => s.score));
  const cntAvg = avg(counters.map((c) => c.score));
  const draftScore = g.teams.draft ? r1(clamp(((g.teams.draft.winProb - 40) / 20) * 5, 0, 5)) : null;
  return {
    me: {
      champ: me.champ,
      pos: me.pos,
      mastery,
      champWr: patch ? r1(patch.winRate * 100) : null,
      overall: draftScore,
      laning: laning.score,
      synergyAvg: synAvg != null ? r1(synAvg) : null,
      counterAvg: cntAvg != null ? r1(cntAvg) : null,
      adRatio: g.teams.ally.ad,
      earlyAdv: team.early,
    },
    laning,
    team,
    synergy,
    counters,
  };
}
