'use strict';
/* LoL Coach — Estructura de la página, render, relojes, eventos globales y conexión con el servidor. Se carga el último. */

// ---------- Estructura ----------
/** Pantalla de carga: scouting de los 10 jugadores. */
function viewLoading(L) {
  const premadeC = ['warn', 'info', 'good'];
  const row = (p, side) => {
    const sc = p.scout;
    const exp = !sc ? '' : sc.champGames ? `<b style="color:var(--text)">${sc.champGames}</b> part. con él${sc.champWinRate != null ? `<br>${wr(sc.champWinRate * 100)}` : ''}`
      : sc.champMastery ? `Maestría ${sc.champMastery.level}<br>${Math.round(sc.champMastery.points / 1000)}k pts` : '<span class="warn">Primera vez</span>';
    return `<div class="prow ${p.isMe ? 'me' : ''}">${img(p.champ, 'm')}<div style="min-width:0"><div class="pn">${posIcon(p.pos)}<span class="ell">${esc(p.isMe ? 'Tú' : p.name || p.champ?.name)}</span>${p.premade ? `<span class="tag ${premadeC[(p.premade - 1) % 3]}">Premade ${p.premade}</span>` : ''}</div>${scoutLine(sc, side)}</div><div class="s dim" style="text-align:right">${exp}</div></div>`;
  };
  return `<div class="grid g-2">
    ${panel('Tu equipo', 'users', `<div class="stack">${L.allies.map((p) => row(p, 'ally')).join('')}</div>`, { right: `${L.loaded}/${L.total} analizados` })}
    ${panel('Rivales', 'swords', `<div class="stack">${L.enemies.map((p) => row(p, 'enemy')).join('')}</div>`, { cls: 'danger' })}
  </div>`;
}

function viewLive(s) {
  if (s.status === 'postgame') return viewPostGame();
  if (s.status === 'champselect' && s.champSelect) return viewChampSelect(s.champSelect);
  if (s.status === 'ingame' && s.inGame) return viewInGame(s.inGame);
  if (s.status === 'loading') return s.loadingGame ? viewLoading(s.loadingGame) : emptyState('clock', 'Cargando partida', 'Las recomendaciones aparecerán en cuanto termine la pantalla de carga.');
  return emptyState('live', 'Sin partida en curso', 'Cuando entres en una selección de campeón o en una partida, esta pantalla se activará sola.',
    `<div class="row" style="justify-content:center;margin-top:14px"><button class="btn ghost" onclick="go('home')">${icon('home')}Ir al inicio</button></div>
     <div class="xs dim" style="margin-top:8px">Para probarlo ya: entra en la Herramienta de práctica.</div>`);
}

/** Campeón cuyo splash tiñe el fondo de la pantalla actual. */
function contextChamp(s) {
  if (view === 'live' && s.status === 'champselect') return s.champSelect?.myChamp || s.champSelect?.build?.champ;
  if (view === 'live' && s.status === 'ingame') return s.inGame?.me?.champ;
  if (view === 'live' && s.status === 'postgame') return analyses.get(anKey(gameList?.find((g) => !g.remake)?.gameId))?.champ;
  if (view === 'games') return analyses.get(anKey(selectedGame, selectedPlayer))?.champ;
  if (view === 'search') return searchGame ? analyses.get(anKey(searchGame, searchRes?.summoner?.puuid))?.champ : searchRes?.champions?.[0]?.champ;
  if (view === 'pool') return poolData?.recommendations?.[0]?.champ || profileData?.champions?.[0]?.champ;
  return profileData?.champions?.[0]?.champ;
}

function topbar(s) {
  const cs = s.champSelect;
  const g = s.inGame;
  let title = 'Inicio', sub = 'Tu rendimiento, tu progreso y tu coach', chips = [];
  if (view === 'games') { title = 'Historial'; sub = 'Análisis detallado de cada partida'; }
  if (view === 'builds') { title = 'Campeones y builds'; sub = 'Tier list del parche y objetos de cada campeón'; }
  if (view === 'settings') { title = 'Ajustes'; sub = 'Activa o desactiva cada parte de la app'; }
  if (view === 'search') { title = 'Buscar jugador'; sub = 'El perfil, el estilo y las partidas de cualquier jugador'; }
  if (view === 'pool') { title = 'Campeones'; sub = 'Tu pool, qué añadir y tu libreta de matchups'; }
  if (view === 'live') {
    title = 'Partida'; sub = 'Selección de campeón y partida en directo';
    if (s.status === 'champselect' && cs) {
      title = cs.aram ? 'Selección · ARAM' : 'Selección de campeón';
      sub = cs.aram ? 'Elige el mejor campeón del banquillo' : 'Draft, picks, build y rivales en directo';
      chips = [
        `<span class="chip info">${icon('clock')}${PHASES[cs.phase] || esc(cs.phase || 'Selección')}</span>`,
        cs.myPos ? `<span class="chip">${posIcon(cs.myPos)}<b>${POS[cs.myPos]}</b></span>` : '',
        cs.laneOpp ? `<span class="chip bad">${icon('swords')}Rival: <b style="color:inherit">${esc(cs.laneOpp.name)}</b></span>` : '',
        cs.locked ? `<span class="chip good">${icon('check')}Bloqueado</span>` : '',
      ];
    }
    if (s.status === 'ingame' && g) {
      title = 'En partida';
      sub = g.aram ? 'ARAM' : 'Grieta del Invocador';
      chips = [
        '<span class="chip live">En directo</span>',
        `<button class="chip ${voiceOn ? 'gold' : ''}" onclick="toggleVoice()" title="Leer en voz alta las alertas">${voiceOn ? '🔊 Voz' : '🔈 Voz'}</button>`,
        `<span class="chip">${icon('clock')}<b id="gtime" class="num">${fmtTime(g.gameTime)}</b></span>`,
        g.me.champ ? `<span class="chip">${img(g.me.champ, 'xs')}<b>${esc(g.me.champ.name)}</b><span class="dim">Nv. ${g.me.level}</span></span>` : '',
      ];
    }
    if (s.status === 'postgame') { title = 'Análisis de la partida'; sub = 'Lo que más te costó y lo que hiciste bien'; }
  }
  const short = (v) => (v ? String(v).split('.').slice(0, 2).join('.') : null);
  const game = s.clientPatch?.patch || short(s.patch);
  const stats = short(s.statsPatch);
  const patchChip = game ? (stats && stats !== game
    ? `<span class="chip warn" title="OP.GG aún no tiene datos del parche ${esc(game)}">Parche ${esc(game)} · stats ${esc(stats)}</span>`
    : `<span class="chip" title="${s.clientPatch ? `Compilación ${esc(s.clientPatch.build)}` : ''}">Parche <b>${esc(game)}</b></span>`) : '';
  return `<header class="topbar"><div style="min-width:0"><div class="tb-title">${title}</div><div class="tb-sub">${sub}</div></div>
    <div class="tb-right">${chips.filter(Boolean).join('')}${patchChip}${s.error ? `<span class="chip bad" title="${esc(s.error)}">${icon('alert')}Error</span>` : ''}</div></header>`;
}

function rail(s) {
  const dot = { champselect: 'cs', loading: 'cs', ingame: 'ig', postgame: 'pg' }[s.status];
  const btn = (v, ic, tip, extra = '') => `<button class="rail-btn ${view === v ? 'on' : ''}" data-tip="${tip}" aria-label="${tip}" onclick="go('${v}')">${icon(ic)}${extra}</button>`;
  return `<nav class="rail">${LOGO}
    ${btn('home', 'home', 'Inicio')}
    ${btn('live', 'live', 'Partida', dot ? `<span class="live-dot ${dot}"></span>` : '')}
    ${btn('games', 'history', 'Historial')}
    ${btn('pool', 'star', 'Campeones')}
    ${btn('builds', 'layers', 'Builds y objetos')}
    ${btn('search', 'search', 'Buscar jugador')}
    ${btn('settings', 'gear', 'Ajustes')}
    <div class="rail-foot">${s.summoner ? `<div class="iw" title="${esc(s.summoner.name)} · ${s.client ? 'Conectado' : 'Desconectado'}"><img class="rail-avatar" src="${esc(s.summoner.icon)}" alt=""><span class="rail-conn ${s.client ? 'on' : ''}"></span></div>` : `<span class="rail-conn" title="Cliente cerrado" style="position:static"></span>`}</div>
  </nav>`;
}

function render() {
  if (!state) return;
  let content;
  if (state.status === 'noclient' && view !== 'games') {
    content = emptyState('plug', 'Esperando al cliente del LoL', 'Abre League of Legends y esto se conectará solo.', '<div class="xs dim" style="margin-top:6px">Si ya está abierto, revisa <code>LOL_PATH</code> en el archivo <code>.env</code>.</div>');
  } else if (view === 'home') content = viewHome(state);
  else if (view === 'games') content = viewGames();
  else if (view === 'pool') content = viewPool();
  else if (view === 'search') content = viewSearch();
  else if (view === 'settings') content = viewSettings();
  else if (view === 'builds') content = viewBuilds();
  else content = viewLive(state);

  const champ = contextChamp(state);
  const html = `<div id="root">
    <div class="ambient"><div class="ambient-img" style="${champ?.splash ? `background-image:url('${esc(champ.splash)}')` : ''}"></div></div><div class="grain"></div>
    <div class="app">${rail(state)}<main class="main">${topbar(state)}<div class="content" data-view="${view}">${content}</div></main></div>
    ${mapView ? viewMapModal() : ''}
    ${plMenu ? playerMenu() : ''}
    ${alertToasts()}
  </div>`;
  if (window.morphdom) {
    morphdom($root, html, {
      onBeforeElUpdated: (from, to) => !(from === document.activeElement && ['TEXTAREA', 'INPUT', 'SELECT'].includes(from.tagName)),
    });
  }
  else $root.outerHTML = html;
  tick();
}

// ---------- Relojes ----------
function gameTimeNow() {
  if (!state?.inGame) return 0;
  return state.inGame.gameTime + (Date.now() - receivedAt) / 1000;
}

function tick() {
  for (const el of document.querySelectorAll('.lb-clock[data-start]')) el.textContent = fmtTime(Math.max(0, (Date.now() - Number(el.dataset.start)) / 1000));
  if (state?.status !== 'ingame') return;
  const now = gameTimeNow();
  const gt = document.getElementById('gtime');
  if (gt) gt.textContent = fmtTime(now);
  for (const el of document.querySelectorAll('.timer[data-at]')) {
    const left = Number(el.dataset.at) - now;
    el.classList.toggle('up', left <= 0);
    el.querySelector('.t').textContent = left <= 0 ? 'VIVO' : fmtTime(left);
  }
  for (const el of document.querySelectorAll('.spell-btn')) {
    const ready = spellTimers.get(el.dataset.timer);
    const cd = el.querySelector('.cd');
    if (ready && ready > now) {
      cd.style.display = '';
      cd.textContent = Math.ceil(ready - now);
    } else {
      cd.style.display = 'none';
      if (ready) spellTimers.delete(el.dataset.timer);
    }
  }
}
setInterval(tick, 250);
setInterval(() => {
  if (state?.status === 'ingame' && state.inGame?.alerts?.some((a) => Date.now() - (alertSeen.get(alertKey(a)) || 0) < ALERT_MS + 1000)) render();
}, 1000);

document.addEventListener('keydown', (e) => {
  if (!mapView?.data?.frames || ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
  if (e.key === 'Escape') closeMap();
  else if (e.key === 'ArrowRight') { mapSeek(mapView.minute + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { mapSeek(mapView.minute - 1); e.preventDefault(); }
  else if (e.key === ' ') { mapPlay(); e.preventDefault(); }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.spell-btn');
  if (!btn) return;
  const key = btn.dataset.timer;
  if (spellTimers.has(key)) spellTimers.delete(key);
  else spellTimers.set(key, gameTimeNow() + Number(btn.dataset.cd));
  tick();
});

function onState(next) {
  const prev = state?.status;
  if (next.lpVersion && next.lpVersion !== state?.lpVersion) profileAt = 0; // LP nuevos: recargar el perfil
  // Partida nueva en el historial: recargar inicio, coach, tendencias e historial
  if (state && next.historyVersion && next.historyVersion !== state.historyVersion) { profileAt = 0; trendsData = null; gameList = null; }
  state = next;
  receivedAt = Date.now();
  voiceOn = !!state.settings?.alerts?.voice && on('alerts.enabled');
  if (state.inGame?.alerts) trackAlerts(state.inGame.alerts);
  if (state.status !== 'ingame') { alertSeen.clear(); toastPinned.clear(); toastClosed.clear(); }
  if (state.status !== prev) {
    runeTab = 0;
    if (state.status !== 'ingame') spellTimers.clear();
    // Selección, partida y fin de partida abren "Partida"; al volver al cliente, regresamos al inicio
    if (['champselect', 'loading', 'ingame', 'postgame'].includes(state.status)) view = 'live';
    else if (prev === 'postgame' && view === 'live') view = 'home';
    if (state.status === 'postgame') gameList = null;
    if (state.status === 'idle') { profileAt = 0; coachData = null; trendsData = null; }
  }
  render();
}

function connect() {
  const q = new URLSearchParams(location.search);
  if (q.get('view')) view = q.get('view');
  if (q.get('player')) selectedPlayer = q.get('player');
  if (q.get('queue')) homeFilter.queue = q.get('queue');
  if (q.get('htab')) homeTab = q.get('htab');
  if (q.get('champ')) { bq = { champ: Number(q.get('champ')) }; bKey = ''; }
  if (q.get('search')) setTimeout(() => { view = 'search'; doSearch(q.get('search')); }, 300);
  if (q.get('map')) setTimeout(() => { view = 'games'; selectedGame = Number(q.get('map')); openMap(Number(q.get('map')), q.get('minute') != null ? Number(q.get('minute')) : null); if (q.get('follow')) setTimeout(() => mapSelect(Number(q.get('follow'))), 1500); }, 300);
  // ?snapshot: una sola carga sin conexión en vivo (útil para capturas)
  if (q.has('snapshot')) {
    fetch('/api/state').then((r) => r.json()).then((s) => { const v = view; onState(s); if (q.get('view')) { view = v; render(); } if (q.has('report')) { state.status = 'postgame'; view = 'live'; render(); } });
    return;
  }
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => onState(JSON.parse(ev.data));
  es.onerror = () => {
    const c = document.querySelector('.rail-conn');
    if (c) c.classList.remove('on');
  };
}
connect();
