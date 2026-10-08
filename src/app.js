import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { LCU } from './lcu.js';
import { getLiveGame } from './liveclient.js';
import { ddragon } from './data/ddragon.js';
import { buildForecast, benchAt } from './engine/forecast.js';
import { itemStats, tierListView } from './engine/itemstats.js';
import { liveStatus, spectateFriend, friends } from './engine/livestatus.js';
import { iteroView } from './engine/iterolive.js';
import { initChampInfo } from './data/champinfo.js';
import { tierList, getBuild, getAramBuild, normPos, setGamePatch } from './data/stats.js';
import { patchOf, installedGameVersion, clientGameVersion } from './gameversion.js';
import { scoutPlayer, champLineText } from './players.js';
import { analyzeChampSelect, analyzeAramSelect } from './engine/champselect.js';
import { analyzeInGame } from './engine/ingame.js';
import { AlertTracker } from './engine/alerts.js';
import { coachFor } from './engine/coach/index.js';
import { evaluateDraft, factorsView } from './engine/draft.js';
import { applyRunes, applySpells, applyItemSet } from './actions.js';
import { listGames, analyzeGame, gameSummary } from './engine/postgame.js';
import { forget } from './util/cache.js';
import { buildProfile, buildCoach, buildSession, buildTrends } from './engine/profile.js';
import { replayStatus, openReplay, controlReplay, playbackState } from './replay.js';
import { dodgeAdvice } from './engine/dodge.js';
import { recordLp, lpSummary, absoluteLp } from './lp.js';
import { buildGoal } from './engine/goal.js';
import { getNotes, setNote, allNotes, matchupHistory, getGoal, setGoal, getTrends, getSettings, setSetting, getMyPool, updateMyPool, champRecord, archiveGames, archivedGames } from './store.js';
import { poolAdvice } from './engine/pool.js';
import { gameMapData } from './engine/gamemap.js';

const IN_GAME_PHASES = new Set(['InProgress', 'GameStart', 'Reconnect']);
const POST_GAME_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);

export class App extends EventEmitter {
  lcu = new LCU();
  plan = null;
  summoner = null;
  localMastery = [];
  scouts = new Map(); // puuid -> info
  scoutPending = new Set();
  gamePlayers = new Map(); // championId -> puuid (de la sesión de gameflow)
  state = { status: 'starting', phase: null, client: false, summoner: null, patch: null, champSelect: null, inGame: null, error: null };
  selectIsAram = null; // se detecta una vez por selección de campeón
  alertTracker = new AlertTracker();
  lastJson = '';
  busy = false;

  gamePatch = null;

  async init() {
    this.state.settings = getSettings();
    // Versión del juego: primero el cliente abierto; si está cerrado, el ejecutable instalado.
    let version = (await this.lcu.discover()) ? await clientGameVersion(this.lcu) : null;
    version = version || (await installedGameVersion());
    await this.applyGamePatch(version);
    await initChampInfo();
  }

  /** Alinea Data Dragon y las estadísticas con el parche del juego. */
  async applyGamePatch(version) {
    const patch = patchOf(version);
    if (version) {
      // "16.19.8230722+branch..." (cliente) o "16.19.823.722" (ejecutable)
      const build = version.match(/^\d+\.\d+\.([\d.]+?)(?:\+|$)/)?.[1] || null;
      this.state.clientPatch = { patch, build };
    }
    if (!patch && this.gamePatch) return;
    if (patch === this.gamePatch && ddragon.version) return;
    this.gamePatch = patch;
    setGamePatch(patch);
    await ddragon.load(patch);
    await this.refreshStatsPatch();
    console.log(`[versión] juego ${patch || '¿?'} · datos ${ddragon.version}${ddragon.matchesGame ? '' : ' (aún sin publicar el del juego)'} · estadísticas ${this.statsPatch || '¿?'}`);
  }

  async start() {
    await this.init();
    this.loop();
  }

  async refreshStatsPatch() {
    this.statsPatch = (await tierList().catch(() => null))?.patch || null;
  }

  async loop() {
    if (!this.busy) {
      this.busy = true;
      try {
        await this.tick();
        this.state.error = null;
      } catch (err) {
        this.state.error = err.message;
        console.warn('[tick]', err.message);
      } finally {
        this.busy = false;
      }
      this.publish();
    }
    setTimeout(() => this.loop(), config.pollMs);
  }

  publish() {
    this.state.patch = ddragon.version;
    this.state.statsPatch = this.statsPatch || null;
    this.state.dataMatchesGame = ddragon.matchesGame;
    this.state.updatedAt = Date.now();
    const { updatedAt, ...rest } = this.state;
    const json = JSON.stringify(rest);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.emit('state', this.state);
    }
  }

  /** Lanza el scouting de un jugador en segundo plano y vuelve a publicar cuando llega. */
  scout(puuid, champId, pos = null) {
    const key = `${puuid}:${champId || 0}`;
    if (!puuid || this.scouts.has(key) || this.scoutPending.has(key)) return this.scouts.get(key) || null;
    this.scoutPending.add(key);
    scoutPlayer(this.lcu, puuid, champId, pos)
      .then((info) => this.scouts.set(key, info))
      .catch(() => this.scouts.set(key, null))
      .finally(() => this.scoutPending.delete(key));
    return null;
  }

  async tick() {
    await ddragon.load();
    await this.refreshStatsPatch();
    let phase = null;
    if (this.lcu.connected || (await this.lcu.discover())) {
      phase = await this.lcu.get('/lol-gameflow/v1/gameflow-phase').catch(() => null);
    }
    this.state.client = this.lcu.connected;
    this.state.phase = phase;

    if (this.lcu.connected && !this.summoner) await this.loadSummoner();
    if (!this.lcu.connected) this.summoner = null;
    if (this.summoner) {
      this.state.summoner = { ...this.summoner, scout: this.scout(this.summoner.puuid) };
    }

    if (phase === 'ChampSelect') {
      this.state.inGame = null;
      this.gamePlayers.clear();
      this.alertTracker.reset();
      this.gameDraft = null;
      this.gameDraftKey = null;
      const session = await this.lcu.get('/lol-champ-select/v1/session');
      if (session) {
        if (this.selectIsAram === null) {
          const flow = await this.lcu.get('/lol-gameflow/v1/session').catch(() => null);
          this.selectIsAram = flow?.map?.id === 12 || flow?.gameData?.queue?.gameMode === 'ARAM' || (!flow && !!session.benchEnabled);
          this.selectQueueId = flow?.gameData?.queue?.id ?? null;
        }
        const { view, plan } = this.selectIsAram
          ? await analyzeAramSelect(session)
          : await analyzeChampSelect(session, {
            localMastery: this.localMastery,
            getMastery: (puuid, champId) => this.masteryOf(puuid, champId),
            customPool: this.summoner ? getMyPool(this.summoner.puuid) : null,
            champRecord: this.summoner ? (champId, vs) => champRecord(this.summoner.puuid, champId, vs) : null,
          });
        for (const a of view.allies) {
          if (a.puuid) a.scout = this.scout(a.puuid, a.champId, a.pos);
        }
        // Asesor de dodge: solo en clasificatorias (Solo/Dúo 420, Flexible 440)
        if (!view.aram && [420, 440].includes(this.selectQueueId) && view.draft) {
          const lp = this.summoner ? lpSummary(this.summoner.puuid)[this.selectQueueId === 440 ? 'flex' : 'solo'] : null;
          view.dodge = dodgeAdvice({ winProb: view.draft.winProb, allies: view.allies, lp, session: this.session });
        }
        view.session = this.session?.active ? this.session : null;
        if (view.laneOpp && this.summoner) view.notes = await this.notes(view.myChamp?.key || 0, view.laneOpp.key);
        this.state.champSelect = view;
        this.plan = plan;
        this.autoImport(session, view, plan);
        if (this.autoResult?.key?.startsWith(`${session.gameId}:`)) view.autoImport = this.autoResult;
      }
      this.state.status = 'champselect';
      return;
    }
    this.state.champSelect = null;
    this.autoDoneKey = null; // la próxima selección vuelve a importar
    this.autoSeen = null;
    this.selectIsAram = null;
    this.selectQueueId = null;

    if (phase === null || IN_GAME_PHASES.has(phase) || this.spectateTarget) {
      const live = await getLiveGame();
      const spectating = live && this.asSpectator(live);
      if (!live && this.spectateTarget && Date.now() - this.spectateTarget.at > 4 * 60_000) this.spectateTarget = null; // la partida terminó o se cerró
      if (live) {
        await this.ensurePlan(live);
        const view = analyzeInGame(live, this.plan);
        if (view) {
          await this.attachGameScouting(view);
          this.attachGameDraft(view);
          this.attachItero(view);
          this.trackProb(view);
          const all = spectating ? [] : this.alertTracker.update(view);
          const al = this.state.settings.alerts;
          view.alerts = al.enabled ? all.filter((x) => al[x.cat] !== false) : [];
          if (spectating) {
            view.spectator = spectating;
            view.skill = null; // sus puntos de habilidad no los da el modo espectador
          }
          if (view.power?.opp && this.summoner) view.notes = await this.notes(view.me.champ?.key || 0, view.power.opp.key);
          this.state.inGame = view;
          this.state.status = 'ingame';
          return;
        }
      }
      if (IN_GAME_PHASES.has(phase)) {
        this.state.status = 'loading';
        this.state.loadingGame = await this.loadingView().catch((err) => {
          console.warn('[carga]', err.message);
          return null;
        });
        return;
      }
    }

    this.state.inGame = null;
    this.state.loadingGame = null;
    if (POST_GAME_PHASES.has(phase)) {
      this.state.status = 'postgame';
      return;
    }
    if (this.state.status === 'ingame' || this.state.status === 'postgame' || this.state.status === 'loading') this.gameEndedAt = Date.now();
    this.state.status = this.lcu.connected ? 'idle' : 'noclient';
    if (this.summoner) {
      this.trackLp();
      this.trackHistory();
    }
  }

  /**
   * El historial del cliente tarda un rato en incluir la partida que acabas de jugar. Mientras estás en el
   * cliente se mira cuál es la última (cada 15 s los 10 minutos siguientes a una partida, si no cada minuto)
   * y, cuando cambia, se borran las cachés que dependen de ella y se avisa al panel (historyVersion).
   */
  trackHistory() {
    const recent = Date.now() - (this.gameEndedAt || 0) < 10 * 60_000;
    if (this.historyBusy || Date.now() - (this.historyAt || 0) < (recent ? 15_000 : 60_000)) return;
    this.historyBusy = true;
    this.historyAt = Date.now();
    const puuid = this.summoner.puuid;
    this.lcu.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=1`)
      .then((res) => {
        const last = res?.games?.games?.[0]?.gameId;
        if (!last) return;
        if (this.lastHistoryId && last !== this.lastHistoryId) {
          console.log(`[historial] partida nueva ${last}`);
          forget(`coach_${puuid}`);
          forget(`trends_${puuid}`);
          this.trackLp(true);
          this.state.historyVersion = Date.now();
        }
        this.lastHistoryId = last;
      })
      .catch(() => null)
      .finally(() => (this.historyBusy = false));
  }

  /** Apunta los LP cada 30 s mientras estás en el cliente (así se captura el cambio de cada partida). */
  trackLp(force = false) {
    if (this.lpBusy || (!force && Date.now() - (this.lpAt || 0) < 30_000)) return;
    this.lpBusy = true;
    this.lpAt = Date.now();
    recordLp(this.lcu, this.summoner.puuid)
      .then((changed) => {
        if (changed) {
          console.log('[lp] LP apuntados');
          this.state.lpVersion = Date.now(); // avisa al panel de que hay datos nuevos
        }
      })
      .catch((err) => console.warn('[lp]', err.message))
      .finally(() => (this.lpBusy = false));
  }

  async profile(opts = {}) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    await recordLp(this.lcu, this.summoner.puuid).catch(() => null);
    const puuid = this.summoner.puuid;
    const p = await buildProfile(this.lcu, puuid, { ...opts, archive: (rows) => archiveGames(puuid, rows) });
    const lp = lpSummary(this.summoner.puuid);
    this.session = buildSession(p.recentAll || p.recent, lp);
    const g = getGoal(this.summoner.puuid);
    const goal = g ? buildGoal(g, lp[g.queue || 'solo'], { games: archivedGames(puuid), season: p.ranks?.[g.queue === 'flex' ? 1 : 0] }) : null;
    const forecast = buildForecast(p, lp);
    return { ...p, lp, goal, forecast, session: this.session, summoner: this.summoner };
  }

  // ---------- Notas, objetivo y pool ----------
  async notes(me, vs) {
    if (!this.summoner || !vs) return null;
    return { ...getNotes(this.summoner.puuid, me, vs), history: matchupHistory(this.summoner.puuid, me, vs), me: ddragon.champView(me), vs: ddragon.champView(vs) };
  }

  async saveNote({ me, vs, text }) {
    if (!this.summoner || !vs) throw new Error('Faltan datos');
    return setNote(this.summoner.puuid, Number(me) || 0, Number(vs), text);
  }

  async allNotes() {
    if (!this.summoner) return [];
    return allNotes(this.summoner.puuid);
  }

  async saveGoal(body) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    if (!body || !body.tier) return setGoal(this.summoner.puuid, null);
    const queue = body.queue === 'flex' ? 'flex' : 'solo';
    const cur = lpSummary(this.summoner.puuid)[queue]?.current;
    return setGoal(this.summoner.puuid, {
      queue,
      tier: String(body.tier),
      division: body.division || 'IV',
      deadline: body.deadline ? Number(body.deadline) : null,
      startAbs: cur?.abs ?? null,
    });
  }

  async pool(roleParam = null) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    const p = await buildProfile(this.lcu, this.summoner.puuid);
    const mainRole = p.roles[0]?.pos || 'BOTTOM';
    const role = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(roleParam) ? roleParam : mainRole;
    const custom = getMyPool(this.summoner.puuid)[role];
    const advice = await poolAdvice({ puuid: this.summoner.puuid, role, localMastery: this.localMastery, recent: p.recent, custom: custom.length ? custom : null });
    return { ...advice, mainRole };
  }

  /** Tu pool elegido, por rol, con datos del parche y tu récord con cada campeón. */
  async myPool() {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    const tl = await tierList();
    const pools = getMyPool(this.summoner.puuid);
    const view = (role) => pools[role].map((id) => {
      const st = tl.champions[id]?.[role];
      const rec = champRecord(this.summoner.puuid, id);
      return {
        champ: ddragon.champView(id),
        winRate: st ? Math.round(st.winRate * 1000) / 10 : null,
        tier: st?.tier ?? null,
        offRole: !st || st.roleRate < 0.05,
        games: rec.games,
        wins: rec.wins,
        mastery: this.localMastery.find((m) => m.championId === id)?.championPoints || 0,
      };
    });
    return Object.fromEntries(Object.keys(pools).map((r) => [r, view(r)]));
  }

  async editMyPool({ role, champId, action }) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    updateMyPool(this.summoner.puuid, role, champId, action);
    return this.myPool();
  }

  /** Todos los campeones con su presencia en cada rol (para el buscador de "Añadir a tu pool"). */
  async championList() {
    const tl = await tierList();
    return [...ddragon.champions.values()].map((c) => ({
      ...ddragon.champView(c.key),
      roles: Object.fromEntries(Object.entries(tl.champions[c.key] || {}).map(([pos, st]) => [pos, Math.round((st.roleRate || 0) * 100)])),
    })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async coach() {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    const puuid = this.summoner.puuid;
    // El cliente a veces da muy pocas partidas: se completa con las archivadas de tu cuenta
    return buildCoach(this.lcu, puuid, { archived: archivedGames(puuid) });
  }

  async gameList() {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    return listGames(this.lcu, this.summoner.puuid);
  }

  /** { gameId: resumen | null } para las filas del historial (de una en una: el cliente del LoL no agradece ráfagas). */
  async gameSummaries(ids, puuid = null) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    const out = {};
    const other = !!puuid && puuid !== this.summoner.puuid;
    for (const id of ids) out[id] = await gameSummary(this.lcu, id, puuid || this.summoner.puuid, { other }).catch(() => null);
    return out;
  }

  async gameMap(gameId, puuid = null) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    return gameMapData(this.lcu, gameId, puuid || this.summoner.puuid);
  }

  async gameAnalysis(gameId, puuid = null) {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    const mine = !puuid || puuid === this.summoner.puuid;
    return analyzeGame(this.lcu, gameId, mine ? this.summoner.puuid : puuid, { record: mine, other: !mine });
  }

  // ---------- Ajustes ----------
  updateSetting(pathKey, value) {
    this.state.settings = setSetting(pathKey, value);
    this.publish();
    return this.state.settings;
  }

  // ---------- Partidas de otros jugadores ----------
  /**
   * En modo espectador el juego no tiene "jugador activo": hacemos como si lo fuera el jugador que estás viendo
   * (el que elegiste en la app o, si no, el primero), para reutilizar todo el análisis de partida.
   */
  asSpectator(live) {
    const a = live.activePlayer || {};
    if (a.riotId || a.summonerName) return null; // estás jugando tú
    if (!this.spectateTarget && IN_GAME_PHASES.has(this.state.phase)) return null; // tu partida aún cargando
    const t = this.spectateTarget;
    const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, '');
    const p = (t && live.allPlayers.find((x) => norm(x.riotId) === norm(t.name) || norm(x.riotIdGameName) === norm(t.name?.split('#')[0]))) || live.allPlayers[0];
    if (!p) return null;
    live.activePlayer = { riotId: p.riotId, riotIdGameName: p.riotIdGameName, summonerName: p.summonerName, level: p.level, currentGold: 0, championStats: {}, abilities: {}, fullRunes: {} };
    if (t) t.at = Date.now();
    return { name: p.riotId || p.summonerName, champ: ddragon.champOfPlayer(p)?.name || '' };
  }

  async liveOf(puuid) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    const tl = await tierList();
    const pos = (id) => Object.entries(tl.champions[id] || {}).sort((a, b) => b[1].roleRate - a[1].roleRate)[0]?.[0] || null;
    return liveStatus(this.lcu, puuid, {
      apiKey: this.state.settings.riot?.apiKey || '',
      scout: (p, champId) => this.scout(p, champId),
      draft: async (allyIds, enemyIds) => {
        const ev = await evaluateDraft({ allies: allyIds.map((id) => ({ champId: id, pos: pos(id) })), enemies: enemyIds.map((id) => ({ champId: id, pos: pos(id) })) });
        return Math.round(ev.winProb * 1000) / 10;
      },
    });
  }

  async spectate(puuid) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    const r = await spectateFriend(this.lcu, puuid);
    this.spectateTarget = { puuid, name: r.name, at: Date.now() };
    return r;
  }

  // ---------- Overlay en partida ----------
  /**
   * Rango con el que te compara el overlay: el de tu objetivo si tienes uno; si no, tu rango actual de Solo/Dúo.
   * Se recalcula como mucho cada minuto (el overlay pide datos varias veces por segundo).
   */
  benchRank() {
    if (!this.summoner) return this.state.summoner?.name === 'Demo#DEMO' ? 1600 : null; // demo: Platino de ejemplo
    if (this.benchCache && Date.now() - this.benchCache.at < 60_000) return this.benchCache.abs;
    const goal = getGoal(this.summoner.puuid);
    const lp = lpSummary(this.summoner.puuid);
    const abs = goal?.tier ? absoluteLp(goal.tier, goal.division || 'IV', 0) : lp.solo?.current?.abs ?? lp.flex?.current?.abs ?? null;
    this.benchCache = { at: Date.now(), abs };
    return abs;
  }

  /** Comparativa en directo: tus números frente a lo habitual en ese rango para tu rol (desde el minuto 5). */
  liveBench(me, role, t) {
    const abs = this.benchRank();
    if (abs == null || !role || t < 300) return null;
    const ref = benchAt(role, abs);
    const min = t / 60;
    const row = (key, label, value, refV, digits = 1) => ({ key, label, value: Math.round(value * 10 ** digits) / 10 ** digits, ref: Math.round(refV * 10 ** digits) / 10 ** digits, ratio: refV ? Math.round((value / refV) * 100) / 100 : null });
    return {
      tier: ref.tierLabel,
      rows: [
        ...(role === 'UTILITY' ? [] : [row('cs', 'CS/min', me.cs / min, ref.csMin)]),
        row('kda', 'KDA', (me.kills + me.assists) / Math.max(1, me.deaths), ref.kda),
        row('vision', 'Visión/min', (me.vision || 0) / min, ref.visionMin, 2),
      ],
      estimate: true,
    };
  }

  /** Datos mínimos para el overlay que se pinta encima del juego. */
  overlay() {
    const g = this.state.inGame;
    const ov = this.state.settings.overlay;
    if (!ov.enabled || g?.spectator) return { active: false };
    const edit = !ov.locked;
    const pos = { cs: ov.posCs, timers: ov.posTimers, skill: ov.posSkill, back: ov.posBack };
    // Modo colocar sin partida: datos de ejemplo para poder mover los widgets sobre el escritorio
    const sampleTimers = [{ kind: 'dragon', label: 'Dragón', at: 660 }, { kind: 'grubs', label: 'Larvas del Vacío', at: 480 }, { kind: 'baron', label: 'Barón Nashor', at: 1200 }];
    if (this.state.status === 'loading' && ov.loading && this.state.loadingGame) {
      const L = this.state.loadingGame;
      const row = (p, side) => {
        const sc = p.scout;
        const champLine = champLineText(sc);
        return {
          champ: p.champ?.name || '?',
          icon: p.champ?.icon || null,
          me: p.isMe,
          premade: p.premade || 0,
          rank: sc ? sc.rank.text.replace(/ · /, ' ') : '',
          wr: sc?.rank.winRate != null ? Math.round(sc.rank.winRate * 100) : null,
          champLine,
          champKda: sc?.champKda != null ? Math.round(sc.champKda * 10) / 10 : null,
          tags: (sc?.tags || []).slice(0, 2).map((t) => ({ text: t.text, tone: t.type === 'info' ? 'info' : (t.type === 'strong') === (side === 'enemy') ? 'bad' : 'good' })),
          loading: !sc,
        };
      };
      return {
        active: true, edit, pos: { ...pos, loadAlly: ov.posLoadAlly, loadEnemy: ov.posLoadEnemy }, gameTime: 0,
        loading: {
          // cards: cada jugador encima de su carta; panels: dos paneles laterales movibles
          mode: ov.loadingCards ? 'cards' : 'panels',
          // Lado de tu equipo: la fila de arriba de la pantalla de carga es el equipo azul y la de abajo el rojo
          allySide: L.allySide === 'red' ? 'red' : 'blue',
          allies: L.allies.map((p) => row(p, 'ally')), enemies: L.enemies.map((p) => row(p, 'enemy')),
        },
        cs: null, skill: null, objectives: [],
      };
    }
    if (this.state.status !== 'ingame' || !g) {
      if (!edit) return { active: false };
      return {
        active: true, preview: true, edit, pos, timersPopup: ov.timersPopup, gameTime: 600, champ: '', level: 9,
        cs: ov.cs ? { me: 74, perMin: 7.4, target: 7.5, expected: 67, diff: 7, opp: { name: 'Rival', cs: 70, diff: 4 },
          bench: ov.bench ? { tier: 'Platino', estimate: true, rows: [{ key: 'cs', label: 'CS/min', value: 7.4, ref: 7.1, ratio: 1.04 }, { key: 'kda', label: 'KDA', value: 2.2, ref: 2.6, ratio: 0.85 }, { key: 'vision', label: 'Visión/min', value: 0.45, ref: 0.5, ratio: 0.9 }] } : null } : null,
        skill: ov.skill ? 'Q' : null,
        objectives: ov.timers ? sampleTimers : [],
        back: ov.back ? { key: 'muestra', title: 'Vuelve a base', sub: 'Tienes 1350 de oro: Espada larga + Daga', icon: null } : null,
      };
    }
    const me = g.players.find((p) => p.isMe);
    const opp = g.laneOppIndex >= 0 ? g.players[g.laneOppIndex] : null;
    const t = g.gameTime;
    const role = g.me.pos;
    // CS/min objetivo del coach de tu rol (support: ninguno; sin posición conocida: 7.0 de referencia)
    const coach = coachFor(role, { aram: g.aram });
    const target = g.aram ? null : coach.id === 'neutral' ? 7.0 : coach.targets.csMin;
    const start = role === 'JUNGLE' ? 90 : 65; // primeras oleadas / primeros campamentos
    const expected = target && t > start ? Math.round((target * (t - start)) / 60) : 0;
    const o = g.objectives;
    const objectives = o && ov.timers ? [
      ...(ov.timerDragon ? [{ kind: 'dragon', ...o.dragon }] : []),
      ...(o.grubs && ov.timerGrubs ? [{ kind: 'grubs', ...o.grubs }] : []),
      ...(o.herald && ov.timerHerald ? [{ kind: 'herald', ...o.herald }] : []),
      ...(ov.timerBaron ? [{ kind: 'baron', ...o.baron }] : []),
      ...(ov.timerInhibs ? o.inhibs.map((i) => ({ kind: i.team === 'ally' ? 'inhib-ally' : 'inhib-enemy', label: i.label, at: i.at })) : []),
    ] : [];
    return {
      active: true,
      edit,
      pos,
      timersPopup: ov.timersPopup,
      gameTime: t,
      champ: g.me.champ?.name || '',
      level: g.me.level,
      cs: me && ov.cs ? {
        me: me.cs,
        perMin: t > 60 ? Math.round((me.cs / (t / 60)) * 10) / 10 : 0,
        target,
        expected,
        diff: target ? me.cs - expected : null,
        opp: opp ? { name: opp.champ?.name || '', cs: opp.cs, diff: me.cs - opp.cs } : null,
        bench: ov.bench && !g.aram ? this.liveBench(me, role, t) : null,
      } : null,
      skill: ov.skill ? g.skill?.key || (edit ? 'Q' : null) : null,
      back: ov.back ? this.backAdvice(g, me, edit) : null,
      objectives: edit && ov.timers && !objectives.length ? sampleTimers : objectives,
    };
  }

  /**
   * Aviso de "vuelve a base": cuando te llega para el objeto completo o para un componente importante.
   * La clave cambia por objetivo y etapa: si lo cierras, no vuelve hasta la siguiente compra.
   */
  backAdvice(g, me, edit = false) {
    const sh = g.shopping;
    const t = g.gameTime;
    const sample = edit ? { key: 'muestra', title: 'Vuelve a base', sub: 'Aquí saldrá cuando te llegue el oro', icon: null } : null;
    if (!sh || t < 120) return sample;
    const gold = g.me.gold;
    const items = me?.items || [];
    const hasWard = items.some((i) => i.id === 2055);
    // Solo los coaches que lo piden (support y jungla) añaden el ward de control; a un ADC no se le recomienda
    const wantsWard = coachFor(g.me.pos, { aram: g.aram }).backWard;
    const wardTip = wantsWard && !hasWard && t > 360 && gold - (sh.missing > 0 ? sh.spend : sh.remaining) >= 75 ? ' + Guardián de control' : '';
    const dead = !!me?.isDead;
    if (sh.missing <= 0) {
      return {
        key: `full-${sh.target.id}`,
        title: dead ? `Al reaparecer: ${sh.target.name}` : `Vuelve a base: ${sh.target.name}`,
        sub: `Tienes ${gold} de oro, te llega para el objeto completo${wardTip}`,
        icon: sh.target.icon,
      };
    }
    // Componente importante: uno de 900+ de oro o 1300+ de gasto útil
    const big = sh.buyNow.filter((i) => (i.gold || 0) >= 900);
    if (big.length || sh.spend >= 1300) {
      const counts = new Map();
      for (const i of sh.buyNow) counts.set(i.name, (counts.get(i.name) || 0) + 1);
      const names = [...counts].slice(0, 3).map(([n, c]) => (c > 1 ? c + '× ' + n : n)).join(' + ');
      return {
        key: `part-${sh.target.id}`,
        title: dead ? 'Al reaparecer, compra' : 'Buen momento para volver',
        sub: `${names} (${sh.spend}) · te faltarán ${sh.missing} para ${sh.target.name}${wardTip}`,
        icon: (big[0] || sh.buyNow[0])?.icon || sh.target.icon,
      };
    }
    return sample;
  }

  async tierList(q) {
    await ddragon.load();
    return tierListView({ tier: q.tier || undefined, region: q.region || undefined, mode: q.mode || 'ranked' });
  }

  /** Estadísticas de objetos de un campeón (página "Builds"). */
  async itemStats(q) {
    await ddragon.load();
    return itemStats({ champId: Number(q.champ), pos: q.pos || null, tier: q.tier || undefined, region: q.region || undefined, mode: q.mode || 'ranked' });
  }

  // ---------- Tendencias ----------
  async trends() {
    if (!this.summoner) throw new Error('Cliente del LoL no conectado');
    return buildTrends(this.lcu, this.summoner.puuid, getTrends);
  }

  // ---------- Buscador de jugadores ----------
  summonerView(s) {
    return {
      puuid: s.puuid,
      name: s.gameName,
      tag: s.tagLine,
      level: s.summonerLevel,
      icon: `https://ddragon.leagueoflegends.com/cdn/${ddragon.version}/img/profileicon/${s.profileIconId}.png`,
    };
  }

  async search(q) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    const [name, tag] = String(q || '').split('#').map((x) => x.trim());
    if (!name || !tag) throw new Error('Escribe el Riot ID completo, con su etiqueta: Nombre#TAG');
    const s = await this.lcu.get(`/lol-summoner/v1/summoners?name=${encodeURIComponent(`${name}#${tag}`)}`).catch(() => null);
    if (!s?.puuid) throw new Error(`No encuentro a ${name}#${tag} en tu región`);
    return this.summonerView(s);
  }

  async otherProfile(puuid, opts = {}) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    const s = await this.lcu.get(`/lol-summoner/v2/summoners/puuid/${puuid}`);
    if (!s) throw new Error('Jugador no encontrado');
    // Si es tu amigo, su estado dice cuál fue su última partida aunque el historial de Riot aún no la tenga
    const fr = (await friends(this.lcu).catch(() => [])).find((x) => x.puuid === puuid);
    const lastId = fr && fr.lol?.gameStatus !== 'inGame' ? Number(fr.lol?.gameId) || null : null;
    const p = await buildProfile(this.lcu, puuid, { ...opts, extraGameIds: lastId ? [lastId] : null, archive: puuid === this.summoner?.puuid ? (rows) => archiveGames(puuid, rows) : null });
    const mastery = (await this.lcu.get(`/lol-champion-mastery/v1/${puuid}/champion-mastery`).catch(() => null)) || [];
    const isMe = puuid === this.summoner?.puuid;
    const lp = isMe ? lpSummary(puuid) : null; // los LP por partida solo los tenemos de tu cuenta
    return {
      ...p,
      lp,
      session: buildSession(p.recentAll || p.recent, lp),
      forecast: buildForecast(p, lp, { other: !isMe }),
      summoner: { ...this.summonerView(s), name: `${s.gameName}#${s.tagLine}` },
      mastery: mastery.slice(0, 5).map((m) => ({ champ: ddragon.champView(m.championId), points: m.championPoints, level: m.championLevel })),
      isMe: puuid === this.summoner?.puuid,
    };
  }

  async otherTrends(puuid) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    if (puuid === this.summoner?.puuid) return this.trends();
    return buildTrends(this.lcu, puuid);
  }

  async otherCoach(puuid) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    if (puuid === this.summoner?.puuid) return this.coach();
    return buildCoach(this.lcu, puuid, { record: false, other: true });
  }

  // ---------- Repeticiones ----------
  replayStatus(gameId) {
    return replayStatus(this.lcu, gameId);
  }

  openReplay(gameId) {
    return openReplay(this.lcu, gameId);
  }

  controlReplay(body) {
    return controlReplay(body);
  }

  async playerInfo(puuid, champId) {
    if (!this.lcu.connected) throw new Error('Cliente del LoL no conectado');
    return scoutPlayer(this.lcu, puuid, champId);
  }

  async loadSummoner() {
    const s = await this.lcu.get('/lol-summoner/v1/current-summoner').catch(() => null);
    if (!s) return;
    this.summoner = {
      name: `${s.gameName}#${s.tagLine}`,
      puuid: s.puuid,
      summonerId: s.summonerId,
      level: s.summonerLevel,
      icon: `https://ddragon.leagueoflegends.com/cdn/${ddragon.version}/img/profileicon/${s.profileIconId}.png`,
    };
    this.localMastery = (await this.lcu.get('/lol-champion-mastery/v1/local-player/champion-mastery').catch(() => null)) || [];
    // Si el cliente se ha actualizado (o la app arrancó con él cerrado), nos alineamos con su versión
    await this.applyGamePatch(await clientGameVersion(this.lcu));
    console.log(`[lcu] conectado como ${this.summoner.name}`);
  }

  /** Si no venimos de la selección (o se cambió el campeón), calcula la build desde la propia partida. */
  async ensurePlan(live) {
    await this.ensurePlanBuild(live);
    const a = live.activePlayer;
    const me = live.allPlayers.find((p) => (p.riotId && p.riotId === a.riotId) || (p.summonerName && p.summonerName === a.summonerName));
    const pos = me && normPos(me.position);
    const opp = pos && live.allPlayers.find((p) => p.team !== me.team && normPos(p.position) === pos);
    const oppKey = opp ? ddragon.champOfPlayer(opp)?.key : null;
    if (this.plan && !this.plan.aram && oppKey && this.plan.oppKey !== oppKey) {
      this.plan.oppKey = oppKey;
      const ob = await getBuild(oppKey, pos).catch(() => null);
      this.plan.oppLengths = ob?.lengths || null;
      this.plan.oppCore = ob?.core?.[0]?.ids || null;
    }
  }

  async ensurePlanBuild(live) {
    const a = live.activePlayer;
    const me = live.allPlayers.find((p) => (p.riotId && p.riotId === a.riotId) || (p.summonerName && p.summonerName === a.summonerName));
    const champ = me && ddragon.champOfPlayer(me);
    if (!champ) return;
    if (live.gameData?.gameMode === 'ARAM' || live.gameData?.mapNumber === 12) {
      if (this.plan?.champId === champ.key && this.plan.aram && this.plan.build) return;
      const build = await getAramBuild(champ.key).catch(() => null);
      this.plan = { champId: champ.key, pos: 'ARAM', vs: null, build, aram: true };
      return;
    }
    const pos = normPos(me.position);
    if (this.plan?.champId === champ.key && this.plan.build && !this.plan.aram && (!pos || this.plan.pos === pos)) return;
    const opp = live.allPlayers.find((p) => p.team !== me.team && pos && normPos(p.position) === pos);
    const vs = opp ? ddragon.champOfPlayer(opp)?.key : null;
    try {
      const build = await getBuild(champ.key, pos, vs);
      this.plan = { champId: champ.key, pos: build.pos, vs, build };
    } catch (err) {
      console.warn('[stats] build en partida:', err.message);
      this.plan = { champId: champ.key, pos, vs, build: null };
    }
  }

/** Puntos de maestría de un jugador con un campeón (null si aún no lo hemos analizado). */
  masteryOf(puuid, champId) {
    if (!puuid || !champId) return null;
    const sc = this.scouts.get(`${puuid}:${champId}`);
    if (sc === undefined) {
      this.scout(puuid, champId);
      return null;
    }
    return sc?.champMastery?.points ?? 0;
  }

  /**
   * Importa runas, hechizos y set de objetos en cuanto bloqueas el campeón (en ARAM, cuando lleva unos
   * segundos sin cambiar). Una sola vez por campeón y partida, y solo lo que esté activado en Ajustes.
   */
  autoImport(session, view, plan) {
    const cs = this.state.settings.champSelect;
    if (!plan?.build || !(cs.autoRunes || cs.autoSpells || cs.autoItems)) return;
    const key = `${session.gameId}:${plan.champId}`;
    if (this.autoDoneKey === key) return;
    if (view.aram || plan.aram) {
      if (this.autoSeen?.key !== key) { this.autoSeen = { key, at: Date.now() }; return; }
      if (Date.now() - this.autoSeen.at < 4000) return;
    } else if (!view.locked) return;
    this.autoDoneKey = key;
    const champ = ddragon.champ(plan.champId)?.name || '';
    (async () => {
      const res = { key, champ, items: [] };
      const run = async (on, label, fn) => {
        if (!on) return;
        try { await fn(); res.items.push({ label, ok: true }); } catch (err) { res.items.push({ label, ok: false, error: err.message }); }
      };
      await run(cs.autoRunes, 'Runas', () => applyRunes(this.lcu, plan, 0));
      await run(cs.autoSpells, 'Hechizos', () => applySpells(this.lcu, plan, 0));
      await run(cs.autoItems && this.summoner, 'Set de objetos', () => applyItemSet(this.lcu, plan, this.summoner.summonerId));
      res.at = Date.now();
      this.autoResult = res;
      console.log('[auto]', champ, res.items.map((x) => `${x.label}: ${x.ok ? 'ok' : x.error}`).join(' · '));
      this.publish();
    })();
  }

  /** Probabilidad de victoria estimada (draft + oro + dragones), la misma fórmula que el panel. */
  static probOf(view) {
    const base = Math.min(90, Math.max(10, view.teams?.draft?.winProb ?? 50));
    const min = Math.max(5, (view.gameTime || 0) / 60);
    const drakes = (view.objectives?.drakes.ally.length || 0) - (view.objectives?.drakes.enemy.length || 0);
    const x = Math.log(base / (100 - base)) + ((view.goldDiff || 0) / 1000) * 0.28 * Math.sqrt(15 / min) + drakes * 0.12;
    return Math.round(Math.min(97, Math.max(3, 100 / (1 + Math.exp(-x)))) * 10) / 10;
  }

  /** Guarda un punto de probabilidad cada 30 s de partida (se reinicia en cada partida). */
  trackProb(view) {
    const key = view.players.map((p) => p.champKey).join(',');
    if (this.probKey !== key) { this.probKey = key; this.probHistory = []; }
    const t = Math.round(view.gameTime || 0);
    const last = this.probHistory[this.probHistory.length - 1];
    if (!last || t - last.t >= 30 || t < last.t) {
      if (last && t < last.t) this.probHistory = [];
      this.probHistory.push({ t, p: App.probOf(view) });
    }
    view.probHistory = this.probHistory;
  }

  /**
   * Abre la repetición de una partida en un momento concreto (p. ej. una muerte) con la cámara en un campeón.
   * Si la repetición no está abierta, la descarga y la abre, y espera a que cargue.
   */
  async replayAt(gameId, { t, champion, championId, lead = 15 }) {
    const jump = async () => controlReplay({ action: 'seek', t, lead, follow: champion, followId: championId });
    let pb = await playbackState();
    if (pb && this.replayGame === gameId) return { ok: true, opened: false, state: await jump() };
    this.replayGame = gameId;
    await openReplay(this.lcu, gameId);
    // Esperar a que el juego abra la repetición (puede tardar ~1 min)
    (async () => {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        pb = await playbackState();
        if (pb?.length > 0) {
          await new Promise((r) => setTimeout(r, 2500));
          await jump().catch((err) => console.warn('[repetición]', err.message));
          return;
        }
      }
    })();
    return { ok: true, opened: true };
  }

  /** Puntuaciones al estilo iTero (se calculan una vez por partida, en segundo plano). */
  attachItero(view) {
    const key = view.players.map((p) => `${p.champKey}:${p.pos}`).join(',');
    if (this.iteroCache?.key === key) {
      view.itero = this.iteroCache.data;
      return;
    }
    if (this.iteroBusy === key) return;
    this.iteroBusy = key;
    const me = view.players.find((p) => p.isMe);
    const mastery = this.localMastery.find((m) => m.championId === me?.champKey)?.championPoints || 0;
    iteroView(view, { mastery })
      .then((data) => { this.iteroCache = { key, data }; })
      .catch((err) => console.warn('[itero]', err.message))
      .finally(() => { if (this.iteroBusy === key) this.iteroBusy = null; });
  }

  /**
   * Predicción del draft durante la partida, ya con la maestría de los 10 jugadores.
   * Se recalcula en segundo plano cuando llega información nueva.
   */
  attachGameDraft(view) {
    const team = (mine) => view.players.filter((p) => (p.team === view.myTeam) === mine).map((p) => ({
      champId: p.champKey,
      pos: view.aram ? null : p.pos,
      mastery: p.scout ? p.scout.champMastery?.points ?? 0 : null,
      label: p.isMe ? 'Tú' : p.champ?.name,
    }));
    const allies = team(true);
    const enemies = team(false);
    const key = JSON.stringify([allies, enemies]);
    if (key !== this.gameDraftKey && !this.gameDraftBusy) {
      this.gameDraftBusy = true;
      evaluateDraft({ allies, enemies, aram: view.aram })
        .then((ev) => {
          this.gameDraftKey = key;
          this.gameDraft = { winProb: Math.round(ev.winProb * 1000) / 10, factors: factorsView(ev.factors, 10), scaling: ev.scaling?.text || null };
        })
        .catch((err) => console.warn('[draft] partida:', err.message))
        .finally(() => (this.gameDraftBusy = false));
    }
    view.teams.draft = this.gameDraft || null;
  }

  /** Pantalla de carga: los 10 jugadores (de la sesión del cliente) con su scouting y los premades detectados. */
  async loadingView() {
    if (!this.lcu.connected) return null;
    const session = await this.lcu.get('/lol-gameflow/v1/session').catch(() => null);
    const gd = session?.gameData;
    if (!gd) return null;
    const me = this.summoner?.puuid;
    const t1 = gd.teamOne || [];
    const t2 = gd.teamTwo || [];
    const mineIsOne = !me || t1.some((p) => p.puuid === me) || !t2.some((p) => p.puuid === me);
    const POS = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MIDDLE', MID: 'MIDDLE', BOTTOM: 'BOTTOM', BOT: 'BOTTOM', ADC: 'BOTTOM', UTILITY: 'UTILITY', SUPPORT: 'UTILITY' };
    const ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    const mk = (p) => {
      const pos = POS[String(p.selectedPosition || '').toUpperCase()] || null;
      if (p.puuid && p.championId) this.gamePlayers.set(p.championId, p.puuid);
      return {
        puuid: p.puuid || null,
        isMe: !!me && p.puuid === me,
        name: p.gameName || p.riotIdGameName || p.summonerName || '',
        champ: ddragon.champView(p.championId),
        pos,
        scout: p.puuid ? this.scout(p.puuid, p.championId, pos) : null,
      };
    };
    const team = (list) => {
      const players = list.map(mk).sort((a, b) => (ORDER.indexOf(a.pos) + 9) % 9 - (ORDER.indexOf(b.pos) + 9) % 9);
      // Premades: jugadores del mismo equipo que comparten 2 o más partidas recientes
      const groups = [];
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i].scout?.gameIds;
          const b = players[j].scout?.gameIds;
          if (!a?.length || !b?.length) continue;
          const shared = a.filter((id) => id !== gd.gameId && b.includes(id)).length;
          if (shared < 2) continue;
          const g = groups.find((x) => x.has(i) || x.has(j));
          if (g) { g.add(i); g.add(j); } else groups.push(new Set([i, j]));
        }
      }
      groups.forEach((g, n) => g.forEach((i) => (players[i].premade = n + 1)));
      for (const p of players) if (p.scout) p.scout = { ...p.scout, gameIds: undefined };
      return players;
    };
    const allies = team(mineIsOne ? t1 : t2);
    const enemies = team(mineIsOne ? t2 : t1);
    const all = [...allies, ...enemies];
    // teamOne de la sesión del cliente = equipo azul (100, ORDER); teamTwo = rojo (200, CHAOS)
    return { queueId: gd.queue?.id || null, allySide: mineIsOne ? 'blue' : 'red', allies, enemies, loaded: all.filter((p) => p.scout).length, total: all.length };
  }

  async attachGameScouting(view) {
    if (!this.lcu.connected) return;
    if (!this.gamePlayers.size) {
      const session = await this.lcu.get('/lol-gameflow/v1/session').catch(() => null);
      for (const p of [...(session?.gameData?.teamOne || []), ...(session?.gameData?.teamTwo || [])]) {
        if (p.puuid && p.championId) this.gamePlayers.set(p.championId, p.puuid);
      }
    }
    for (const p of view.players) {
      const puuid = this.gamePlayers.get(p.champKey);
      if (puuid) p.scout = this.scout(puuid, p.champKey, p.pos);
    }
  }

  async action(name, args = {}) {
    if (name === 'runes') return applyRunes(this.lcu, this.plan, args.index || 0);
    if (name === 'spells') return applySpells(this.lcu, this.plan, args.index || 0);
    if (name === 'itemset') {
      if (!this.summoner) throw new Error('Cliente no conectado');
      return applyItemSet(this.lcu, this.plan, this.summoner.summonerId);
    }
    throw new Error(`Acción desconocida: ${name}`);
  }
}

