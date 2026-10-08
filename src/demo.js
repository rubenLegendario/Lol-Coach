/**
 * Datos simulados para ver el panel sin estar en partida:
 *   npm run demo            -> selección de campeón
 *   npm run demo -- ingame  -> partida
 *   npm run demo -- aram / aram-ingame
 *   npm run demo -- loading [rojo] [3]  -> pantalla de carga (rojo: tu equipo en el lado rojo, abajo;
 *                                          un número: jugadores por equipo, para ver las cartas centradas)
 */
import { analyzeChampSelect, analyzeAramSelect } from './engine/champselect.js';
import { analyzeInGame } from './engine/ingame.js';
import { dodgeAdvice } from './engine/dodge.js';
import { getBuild } from './data/stats.js';

const session = {
  localPlayerCellId: 3,
  timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 25000 },
  myTeam: [
    { cellId: 0, championId: 86, assignedPosition: 'top' },
    { cellId: 1, championId: 64, assignedPosition: 'jungle' },
    { cellId: 2, championId: 0, championPickIntent: 103, assignedPosition: 'middle' },
    { cellId: 3, championId: 0, championPickIntent: 202, assignedPosition: 'bottom' },
    { cellId: 4, championId: 0, assignedPosition: 'utility' },
  ],
  theirTeam: [{ cellId: 5, championId: 51 }, { cellId: 6, championId: 16 }, { cellId: 7, championId: 122 }, { cellId: 8 }, { cellId: 9 }],
  actions: [[{ actorCellId: 3, type: 'pick', championId: 202, completed: false, isInProgress: true }]],
  bans: { myTeamBans: [157, 238], theirTeamBans: [555, 145] },
};

const player = (riotId, champ, team, pos, items, [k, d, a], spells = ['SummonerFlash', 'SummonerHeal']) => ({
  riotId,
  riotIdGameName: riotId.split('#')[0],
  rawChampionName: `game_character_displayname_${champ}`,
  championName: champ,
  team,
  position: pos,
  level: 9,
  isDead: champ === 'Lux',
  respawnTimer: champ === 'Lux' ? 18 : 0,
  scores: { kills: k, deaths: d, assists: a, creepScore: 120, wardScore: 8.4 },
  items: items.map((id, slot) => ({ itemID: id, slot, count: 1 })),
  summonerSpells: {
    summonerSpellOne: { rawDisplayName: `GeneratedTip_SummonerSpell_${spells[0]}_DisplayName` },
    summonerSpellTwo: { rawDisplayName: `GeneratedTip_SummonerSpell_${spells[1]}_DisplayName` },
  },
});

function liveGame(gameTime, aram = false) {
  const game = {
    activePlayer: {
      riotId: 'Tú#DEMO', level: 9, currentGold: 1400,
      abilities: { Q: { abilityLevel: 4 }, W: { abilityLevel: 2 }, E: { abilityLevel: 1 }, R: { abilityLevel: 1 } },
    },
    allPlayers: [
      player('Tú#DEMO', 'Jhin', 'ORDER', 'BOTTOM', [1055, 1036, 3363], [3, 2, 4]),
      player('Aliado1#1', 'Quinn', 'ORDER', 'TOP', [3071], [2, 3, 1], ['SummonerFlash', 'SummonerTeleport']),
      player('Aliado2#1', 'LeeSin', 'ORDER', 'JUNGLE', [6692], [1, 2, 5], ['SummonerFlash', 'SummonerSmite']),
      player('Aliado3#1', 'Ahri', 'ORDER', 'MIDDLE', [3118], [2, 1, 2], ['SummonerFlash', 'SummonerDot']),
      player('Aliado4#1', 'Thresh', 'ORDER', 'UTILITY', [3877], [0, 2, 6], ['SummonerFlash', 'SummonerDot']),
      player('Rival1#1', 'Caitlyn', 'CHAOS', 'BOTTOM', [3031, 3006], [4, 2, 1]),
      player('Rival2#1', 'Soraka', 'CHAOS', 'UTILITY', [3877], [0, 1, 7], ['SummonerFlash', 'SummonerExhaust']),
      player('Rival3#1', 'Darius', 'CHAOS', 'TOP', [3078, 3047], [7, 1, 1], ['SummonerFlash', 'SummonerTeleport']),
      player('Rival4#1', 'Lux', 'CHAOS', 'MIDDLE', [6655, 3020], [2, 2, 3], ['SummonerFlash', 'SummonerDot']),
      player('Rival5#1', 'Sejuani', 'CHAOS', 'JUNGLE', [3068], [1, 2, 6], ['SummonerFlash', 'SummonerSmite']),
    ],
    events: {
      Events: [
        { EventName: 'DragonKill', EventTime: 400, DragonType: 'Fire', KillerName: 'Aliado2' },
        { EventName: 'DragonKill', EventTime: 760, DragonType: 'Water', KillerName: 'Rival5' },
      ],
    },
    gameData: { gameTime, gameMode: aram ? 'ARAM' : 'CLASSIC', mapNumber: aram ? 12 : 11 },
  };
  if (aram) for (const p of game.allPlayers) { p.position = ''; p.summonerSpells.summonerSpellTwo.rawDisplayName = 'GeneratedTip_SummonerSpell_SummonerSnowball_DisplayName'; }
  return game;
}

const aramSession = {
  localPlayerCellId: 3,
  benchEnabled: true,
  rerollsRemaining: 1,
  timer: { phase: 'BAN_PICK' },
  benchChampions: [{ championId: 99 }, { championId: 267 }, { championId: 54 }],
  myTeam: [{ cellId: 0, championId: 86 }, { cellId: 1, championId: 64 }, { cellId: 2, championId: 103 }, { cellId: 3, championId: 202 }, { cellId: 4, championId: 412 }],
  theirTeam: [],
  actions: [],
};

export async function runDemo(app, mode, file) {
  // Reproduce una captura real de la Live Client API: npm run demo -- replay captura.json
  if (mode === 'replay') {
    const fs = await import('node:fs');
    const live = JSON.parse(fs.readFileSync(file, 'utf8'));
    await app.ensurePlan(live);
    app.state.client = true;
    app.state.status = 'ingame';
    app.state.phase = 'InProgress';
    app.state.inGame = analyzeInGame(live, app.plan);
    app.publish();
    console.log(`  MODO REPLAY: ${file}\n`);
    return;
  }
  const aram = mode?.startsWith('aram');
  const { view, plan } = aram
    ? await analyzeAramSelect(aramSession)
    : await analyzeChampSelect(session, { localMastery: [{ championId: 202, championPoints: 1281789 }, { championId: 222, championPoints: 90000 }], customPool: mode === 'pool' ? { BOTTOM: [202, 51, 81, 222, 145] } : null, champRecord: (id, vs) => (id === 202 ? { games: 21, wins: 12, vsGames: 3, vsWins: 2 } : { games: 0, wins: 0, vsGames: 0, vsWins: 0 }) });
  if (plan && !aram) {
    const ob = await getBuild(51, 'BOTTOM').catch(() => null);
    plan.oppLengths = ob?.lengths || null;
    plan.oppCore = ob?.core?.[0]?.ids || null;
  }
  const startedAt = Date.now();
  const fakeScout = (rank, wr, streak, tags) => ({
    rank: { text: rank, winRate: wr, wins: 120, losses: 100 },
    recent: Array.from({ length: 10 }, (_, i) => ({ win: i % 3 !== 0 })),
    tags, kda: 2.8, champGames: 4, champWinRate: 0.75, champKda: 3.1, sampleGames: 20, sampleRanked: false, champMastery: { level: 12, points: 150000 },
  });

  const update = () => {
    app.state.client = true;
    app.state.summoner = { name: 'Demo#DEMO', level: 100, icon: '', scout: null };
    if (mode === 'ingame' || mode === 'aram-ingame') {
      const g = analyzeInGame(liveGame(905 + (Date.now() - startedAt) / 1000, aram), plan);
      app.attachGameDraft(g);
      app.attachItero(g);
      app.trackProb(g);
      g.alerts = [
        { id: 3, t: Math.round(g.gameTime) - 2, type: 'bad', icon: 'alert', text: 'Caitlyn ha completado Óptica hextech C44: es su power spike. Juega con más cuidado.', voice: 'Caitlyn ha completado Óptica hextech. Cuidado.' },
        { id: 2, t: 545, type: 'info', icon: 'cart', text: 'Tienes oro para Soberbia: vuelve a base cuando puedas.', voice: 'Tienes oro para Soberbia.' },
        { id: 1, t: 460, type: 'good', icon: 'zap', text: 'Tienes la R y Caitlyn todavía no: es tu momento para el all-in.', voice: 'Tienes la ulti antes que Caitlyn.' },
      ];
      g.players[5].scout = fakeScout('Esmeralda IV · 40 LP', 0.56, 4, [{ type: 'strong', text: '🔥 4 victorias seguidas' }, { type: 'strong', text: 'Main (450k puntos)' }]);
      g.players[7].scout = fakeScout('Platino I · 80 LP', 0.48, -3, [{ type: 'weak', text: '🥶 3 derrotas seguidas' }]);
      app.state.status = 'ingame';
      app.state.phase = 'InProgress';
      app.state.inGame = g;
    } else if (mode === 'loading') {
      const g = analyzeInGame(liveGame(0, false), plan);
      const scouts = [
        fakeScout('Oro II · 14 LP', 0.51, 1, [{ type: 'weak', text: 'Poca experiencia con el campeón' }]),
        fakeScout('Oro I · 62 LP', 0.55, 3, [{ type: 'strong', text: '3 victorias seguidas' }]),
        fakeScout('Plata I · 90 LP', 0.47, -2, [{ type: 'weak', text: 'Muere mucho (7.4 por partida)' }]),
        null,
        fakeScout('Oro III · 30 LP', 0.5, 2, [{ type: 'info', text: 'Agresivo early (primera sangre en 41%)' }]),
        fakeScout('Esmeralda IV · 40 LP', 0.56, 4, [{ type: 'strong', text: 'OTP de Darius' }, { type: 'strong', text: '4 victorias seguidas' }]),
        fakeScout('Oro II · 50 LP', 0.52, 1, [{ type: 'weak', text: 'Primera vez con el campeón' }]),
        fakeScout('Platino IV · 10 LP', 0.48, -3, [{ type: 'weak', text: '3 derrotas seguidas' }]),
        fakeScout('Oro IV · 0 LP', 0.44, -1, [{ type: 'weak', text: 'Farmea poco (5.1 CS/min)' }]),
        fakeScout('Oro I · 20 LP', 0.58, 2, [{ type: 'strong', text: 'Juega seguro, muere poco' }]),
      ];
      const mk = (p, i) => ({ isMe: p.isMe, name: p.name, champ: p.champ, pos: p.pos, premade: [7, 9].includes(i) ? 1 : 0, scout: scouts[i] });
      const ps = g.players.map(mk);
      ps[3].scout = scouts[3] || { ...fakeScout('Oro II · 33 LP', 0.53, 1, []), champGames: 9, champWinRate: 0.61, champKda: 4.2, sampleGames: 14, sampleRanked: true };
      ps[8].scout = { ...ps[8].scout, champGames: 0, champWinRate: null, champKda: null, champMastery: null };
      const opts = String([file, ...process.argv.slice(process.argv.indexOf('--demo') + 3)].join(' '));
      const n = Math.min(5, Math.max(1, Number(opts.match(/\d/)?.[0]) || 5));
      const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
      const byPos = (a, b) => order.indexOf(a.pos) - order.indexOf(b.pos);
      const allies = ps.slice(0, 5).sort(byPos).slice(0, n);
      if (!allies.some((p) => p.isMe)) allies[allies.length - 1] = ps.find((p) => p.isMe);
      const enemies = ps.slice(5).sort(byPos).slice(0, n);
      app.state.loadingGame = { allySide: /rojo|red/.test(opts) ? 'red' : 'blue', allies, enemies, loaded: n * 2, total: n * 2 };
      app.state.status = 'loading';
      app.state.phase = 'InProgress';
      app.state.inGame = null;
    } else {
      if (!aram) view.allies[1].puuid = 'demo';
      if (!aram) view.dodge = dodgeAdvice({ winProb: view.draft.winProb, allies: view.allies, lp: { avgWin: 21, avgLoss: -19 } });
      view.allies[1].scout = fakeScout('Oro II · 14 LP', 0.51, 3, [{ type: 'weak', text: 'Poca experiencia con el campeón' }]);
      app.state.status = 'champselect';
      app.state.phase = 'ChampSelect';
      app.state.champSelect = view;
    }
    app.publish();
  };
  update();
  setInterval(update, 1500);
  console.log(`  MODO DEMO (${mode || 'selección de campeón'}): datos simulados, no se conecta al LoL.\n`);
}
