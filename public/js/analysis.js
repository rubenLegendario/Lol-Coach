'use strict';
/* LoL Coach — Análisis de una partida, informe de fin de partida, historial y menú de jugador. */

// ---------- Logros de la partida (MVP, primera sangre, multikills…) ----------
function badgeChip(b) {
  return `<div class="badge b-${b.tier}" title="${esc(b.detail)}"><span class="bg-ic">${icon(b.icon)}</span><div style="min-width:0"><div class="bg-t">${esc(b.title)}</div><div class="bg-d">${esc(b.detail)}</div></div></div>`;
}

function badgesPanel(a) {
  if (!on('postgame.badges') || !a.badges) return '';
  const body = a.badges.length ? `<div class="badges">${a.badges.map(badgeChip).join('')}</div>` : `<div class="s muted">${a.viewer?.puuid && a.viewer.puuid !== state?.summoner?.puuid ? 'Sin logros en esta partida.' : 'Esta vez no hay logros. ¡A por ellos en la siguiente!'}</div>`;
  return panel('Logros de la partida', 'star', body, { right: a.badges.length ? `${a.badges.length} logro${a.badges.length === 1 ? '' : 's'} · MVP y ACE son una estimación` : '' });
}

/** Etiqueta MVP / ACE / puesto (1º-10º) de un jugador en la tabla. */
function rankTag(p) {
  if (!on('postgame.mvp') || p.rank == null) return '';
  if (p.mvp) return '<span class="tag rk mvp" title="Mejor del equipo ganador (puntuación estimada)">MVP</span>';
  if (p.ace) return '<span class="tag rk ace" title="Mejor del equipo perdedor (puntuación estimada)">ACE</span>';
  return `<span class="tag rk" title="Puesto en la partida según nuestra puntuación estimada">${p.rank}º</span>`;
}

// ---------- Los 10 jugadores de una partida ----------
function playersPanel(a) {
  const maxDmg = Math.max(...a.players.map((p) => p.dmg), 1);
  const row = (p) => `<button class="pl-row ${p.team} ${p.self ? 'on' : ''}" data-name="${esc(p.name)}" onclick="openPlMenu(event, '${p.puuid}', ${a.gameId})" title="Opciones de ${esc(p.name)}">
      <div class="iw">${img(p.champ, 'm')}<span class="lv">${p.level}</span></div>
      <div style="min-width:0"><div class="pn">${posIcon(p.pos)}<span class="ell">${esc(p.name)}</span>${p.puuid === state?.summoner?.puuid ? '<span class="tag gold">Tú</span>' : ''}${rankTag(p)}</div>
        <div class="row nw" style="gap:3px;margin-top:3px">${p.spells.map((x) => img(x, 'xs')).join('')}${p.keystone?.icon ? `<img class="ic xs round" src="${esc(p.keystone.icon)}" alt="" title="${esc(p.keystone.name)}">` : ''}</div></div>
      <div class="pl-kda"><b>${p.k}/${p.d}/${p.a}</b><span class="xs dim">${p.kda} KDA · ${p.kp}% KP</span></div>
      <div class="pl-c num">${p.cs}</div>
      <div class="pl-dmg"><div class="bar"><div class="${p.team === 'ally' ? 'al' : 'en'}" style="width:${Math.round((p.dmg / maxDmg) * 100)}%"></div></div><span class="xs dim">${fmtNum(p.dmg)} · ${p.dmgShare}%</span></div>
      <div class="pl-c num goldc">${fmtNum(p.gold)}</div>
      <div class="pl-c num dim">${p.vision}</div>
      <div class="items pl-items">${p.items.map((i) => img(i, 'xs')).join('')}</div>
    </button>`;
  const head = (t) => `<div class="pl-head"><span class="lbl ${t === 'ally' ? 'allyc' : 'enemyc'}">${t === 'ally' ? (a.win ? 'Victoria' : 'Derrota') : (a.win ? 'Derrota' : 'Victoria')}</span><span>KDA</span><span>CS</span><span>Daño</span><span>Oro</span><span>Visión</span><span>Objetos</span></div>`;
  return panel('Los 10 jugadores', 'users', `<div class="pl-wrap">${head('ally')}${a.players.filter((p) => p.team === 'ally').map(row).join('')}
    <div style="height:10px"></div>${head('enemy')}${a.players.filter((p) => p.team === 'enemy').map(row).join('')}</div>`, { right: 'Clic en un jugador: su partida o su perfil' });
}

// ---------- Análisis ----------
/** Probabilidad de victoria a partir de la diferencia de oro (para el análisis, sin draft). */
function probFromGold(min, diff) {
  const x = (diff / 1000) * 0.28 * Math.sqrt(15 / Math.max(5, min));
  return Math.min(97, Math.max(3, 100 / (1 + Math.exp(-x))));
}

/** Gráfica de probabilidad de victoria: points [{ t (s), p (0-100) }]. */
function probChart(points, { height = 150, note = '' } = {}) {
  if (!points || points.length < 2) return `<div class="s dim">La gráfica aparece en cuanto haya un par de minutos de partida.</div>`;
  const W = 660, H = height, L = 34, R = 8, T = 8, B = 18;
  const tMax = Math.max(60, points[points.length - 1].t);
  const x = (t) => L + (t / tMax) * (W - L - R);
  const y = (p) => T + (1 - p / 100) * (H - T - B);
  const line = points.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points[points.length - 1].t).toFixed(1)},${y(50)} L${x(points[0].t).toFixed(1)},${y(50)} Z`;
  const last = points[points.length - 1];
  const ticks = [];
  for (let m = 5; m * 60 < tMax; m += 5) ticks.push(m);
  const id = 'pg' + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart prob-chart" role="img" aria-label="Probabilidad de victoria a lo largo de la partida">
    <defs><linearGradient id="${id}" x1="0" y1="${y(100)}" x2="0" y2="${y(0)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4aa9ff" stop-opacity=".35"/><stop offset=".5" stop-color="#4aa9ff" stop-opacity="0"/><stop offset=".5" stop-color="#ff5468" stop-opacity="0"/><stop offset="1" stop-color="#ff5468" stop-opacity=".35"/></linearGradient></defs>
    ${[25, 50, 75].map((p) => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="${p === 50 ? 'zero' : 'grid'}"/><text x="${L - 6}" y="${y(p) + 3}" text-anchor="end" class="ax">${p}%</text>`).join('')}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" class="lt" style="stroke:${last.p >= 50 ? 'var(--ally)' : 'var(--enemy)'}"/>
    <circle cx="${x(last.t)}" cy="${y(last.p)}" r="4" fill="${last.p >= 50 ? 'var(--ally)' : 'var(--enemy)'}"/>
    ${ticks.map((m) => `<text x="${x(m * 60)}" y="${H - 3}" text-anchor="middle" class="ax">${m}'</text>`).join('')}
  </svg>${note ? `<div class="xs dim" style="margin-top:4px">${note}</div>` : ''}`;
}

/** Abre la repetición 15 s antes de una muerte, con la cámara en tu campeón. */
async function replayDeath(gameId, time, champion, championId) {
  const [m, sec] = String(time).split(':').map(Number);
  const t = (m || 0) * 60 + (sec || 0);
  toast('Preparando la repetición…');
  try {
    const r = await (await fetch(`/api/replay/${gameId}/at`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, champion, championId, lead: 15 }) })).json();
    if (r.error) return toast(r.error, true);
    toast(r.opened ? 'Abriendo la repetición: saltará sola a la muerte en cuanto cargue (puede tardar un minuto)' : `Repetición en el ${time} menos 15 s`);
  } catch {
    toast('No se pudo abrir la repetición', true);
  }
}

function goldChart(points) {
  if (!points?.length) return '';
  const W = 660, H = 190, L = 40, R = 8;
  const vals = points.flatMap((p) => [p.team, p.lane ?? 0]);
  const max = Math.max(1000, ...vals.map(Math.abs));
  const x = (i) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v) => H / 2 - (v / max) * (H / 2 - 16);
  const line = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k] ?? 0).toFixed(1)}`).join(' ');
  const hasLane = points.some((p) => p.lane != null);
  const area = `${line('team')} L${x(points.length - 1)},${H / 2} L${x(0)},${H / 2} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Diferencia de oro por minuto">
    <defs><linearGradient id="gtf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa9ff" stop-opacity=".28"/><stop offset=".5" stop-color="#4aa9ff" stop-opacity="0"/><stop offset=".5" stop-color="#ff5468" stop-opacity="0"/><stop offset="1" stop-color="#ff5468" stop-opacity=".28"/></linearGradient></defs>
    <line x1="${L}" x2="${W - R}" y1="${H / 2}" y2="${H / 2}" class="zero"/>
    <text x="${L - 8}" y="18" text-anchor="end" class="ax">+${fmtNum(max)}</text><text x="${L - 8}" y="${H / 2 + 3}" text-anchor="end" class="ax">0</text><text x="${L - 8}" y="${H - 14}" text-anchor="end" class="ax">−${fmtNum(max)}</text>
    <path d="${area}" fill="url(#gtf)"/>
    ${hasLane ? `<path d="${line('lane')}" class="ll"/>` : ''}<path d="${line('team')}" class="lt"/>
    ${points.filter((p) => p.min % 5 === 0 && p.min > 0).map((p) => `<text x="${x(p.min)}" y="${H}" text-anchor="middle" class="ax">${p.min}'</text>`).join('')}
  </svg>
  <div class="legend-i"><span><i style="background:var(--ally)"></i>Tu equipo vs rival</span>${hasLane ? '<span><i style="background:var(--gold)"></i>Tú vs tu rival de línea</span>' : ''}</div>`;
}

function gradeCard(label, g) {
  if (!g) return `<div class="grade g-na">${ring(54, 5, [], '<span class="gl">–</span>')}<div><div class="gt">${label}</div><div class="gs">Partida corta</div></div></div>`;
  return `<div class="grade g-${g.grade}">${ring(54, 5, [{ v: g.score, color: 'var(--gc)' }], `<span class="gl">${g.grade}</span>`)}<div><div class="gt" style="color:var(--text)">${label}</div><div class="gs">${g.score}/100</div></div></div>`;
}

function viewAnalysis(a) {
  if (!a) return '<div class="stack" style="gap:16px"><div class="skel" style="height:240px;border-radius:22px"></div><div class="skel" style="height:320px"></div></div>';
  if (a.error) return `<div class="note">${icon('alert')}<span>${esc(a.error)}</span></div>`;
  const st = a.stats, tg = a.targets || {}, bl = a.baseline;
  const cmp = (v, t) => (t == null ? '' : v >= t ? 'good' : 'bad');
  const row = (label, v, t, b, cls = '') => `<tr><td>${label}</td><td class="wr ${cls}">${v}</td><td class="dim">${t ?? '—'}</td><td class="dim">${b ?? '—'}</td></tr>`;
  const viewing = a.viewer && a.viewer.puuid !== state?.summoner?.puuid;
  return `<div class="stack" style="gap:16px">
    ${viewing ? `<div class="viewing">${icon('users')}<span>Estás viendo la partida desde el punto de vista de <b>${esc(a.viewer.name)}</b> (${esc(a.champ?.name)}). Los textos en segunda persona se refieren a él.</span>${view === 'games' ? '<button class="btn sm" onclick="viewPlayer(null)">Volver a mi análisis</button>' : ''}</div>` : ''}
    <section class="ahero"><div class="art" style="background-image:url('${esc(a.champ?.splash || '')}')"></div><div class="ahero-in">
      <div class="row nw" style="gap:18px;align-items:center">${img(a.champ, 'xl')}
        <div style="min-width:0;flex:1">
          <div class="result ${a.win ? 'good' : 'bad'}">${a.win ? 'Victoria' : 'Derrota'}</div>
          <div class="row" style="margin-top:8px"><b>${esc(a.champ?.name)}</b>${a.pos ? `${posIcon(a.pos)}<span class="muted">${esc(a.posLabel)}</span>` : ''}<span class="dim">· ${esc(a.queue)} · ${a.duration} min · ${timeAgo(a.date)}</span></div>
          ${a.opp ? `<div class="mu">${img(a.opp.champ, 's')}<span>contra <b>${esc(a.opp.champ?.name)}</b></span><span class="dim">${esc(a.opp.name)}</span></div>` : ''}
        </div>
        <div class="row" style="gap:22px">
          <div class="bh-stat"><div class="v dsp" style="font-size:30px">${esc(st.kda)}</div><div class="k">KDA</div></div>
          <div class="bh-stat"><div class="v dsp" style="font-size:30px">${st.csMin}</div><div class="k">CS/min</div></div>
          <div class="bh-stat"><div class="v dsp" style="font-size:30px">${st.kp}%</div><div class="k">Participación</div></div>
        </div>
      </div>
      ${a.sr ? `<div class="actions" style="margin-top:14px"><button class="btn" onclick="openMap(${a.gameId}, null, '${viewing ? a.viewer.puuid : ''}')">${icon('target')}Explorar el mapa de la partida</button></div>` : ''}
      <div class="grades">${gradeCard('Nota global', a.grades.overall)}${a.sr ? gradeCard('Fase de líneas', a.grades.early) + gradeCard('Mitad 14-25', a.grades.mid) + gradeCard('Final 25+', a.grades.late) : ''}</div>
    </div></section>
    ${badgesPanel(a)}
    ${a.players?.length ? playersPanel(a) : ''}
    <div class="grid g-2">
      <div class="col">
        ${panel(a.improve.length ? `Las ${a.improve.length} cosas que más te costaron` : 'Qué mejorar', 'target', a.improve.length ? `<div class="stack">${a.improve.map((x, i) => `<div class="habit"><div class="n">${i + 1}</div><div style="min-width:0"><div class="t">${esc(x.title)}</div><div class="d">${esc(x.detail)}</div><div class="tip">${icon('bulb')}<span>${esc(x.tip)}</span></div></div></div>`).join('')}</div>` : '<div class="muted">Nada grave que destacar en esta partida.</div>', { cls: 'gold' })}
        ${a.strengths.length ? panel('Lo que hiciste bien', 'star', `<div class="stack">${a.strengths.map((x) => `<div class="strength">${icon('check')}<span><b>${esc(x.title)}</b> · ${esc(x.detail)}</span></div>`).join('')}</div>`) : ''}
        ${a.deaths?.length ? panel('Tus muertes', 'skull', `<div class="dm-grid">
            ${a.deaths.some((d) => d.map) ? `<button class="dmap-btn" onclick="openMap(${a.gameId}, null, '${viewing ? a.viewer.puuid : ''}')" title="Ampliar y explorar la partida">` + deathMap(a.deaths.filter((d) => d.map).map((d) => ({ ...d.map, gank: d.gank, early: d.minute < 14, title: `${d.time} · ${d.zone}${d.killer ? ' · ' + d.killer.name : ''}` })), { numbered: true }) + `<span class="dmap-hint">${icon('target')}Explorar la partida</span></button>` : ''}
            <div class="stack">${a.deaths.map((d, i) => `<div class="death-row"><span class="dnum ${d.gank ? 'gank' : d.minute < 14 ? 'early' : ''}">${i + 1}</span><div style="min-width:0"><div class="b">${d.time}${d.zone ? ` · <span class="muted">${esc(d.zone)}</span>` : ''}</div>
              <div class="xs dim">${d.killer ? `Te mató ${esc(d.killer.name)}` : ''}${d.by > 1 ? ` · ${d.by} rivales` : ''}${d.gank ? ' · <span class="bad">gank</span>' : ''}${d.enemySide ? ' · en su mitad' : ''}</div></div>${d.killer ? img(d.killer, 's') : ''}${a.sr ? `<button class="chip rp-btn" onclick="replayDeath(${a.gameId}, '${d.time}', '${esc(a.champ?.id || '')}', ${a.champ?.key || 0})" title="Abrir la repetición 15 s antes de esta muerte, con la cámara en ti">${icon('play')}Ver</button>` : ''}</div>`).join('')}</div>
          </div>`, { right: `${a.deaths.length} en total` }) : ''}
      </div>
      <div class="col">
        ${a.goldChart?.length > 2 ? panel('Probabilidad de victoria', 'scale', probChart(a.goldChart.map((q) => ({ t: q.min * 60, p: probFromGold(q.min, q.team) })), { note: 'Estimada minuto a minuto a partir de la diferencia de oro entre equipos.' })) : ''}
        ${a.goldChart?.length ? panel('Oro y momentos clave', 'chart', goldChart(a.goldChart) + (a.moments?.length ? timelineBar(a.moments, a.duration) : '') + (a.decisive ? `<div class="advice" style="margin-top:12px">${icon(a.decisive.delta > 0 ? 'up' : 'down')}<span><b>Momento decisivo.</b> ${esc(a.decisive.text)}</span></div>` : '')) : ''}
        ${a.moments?.length ? panel('Cronología', 'history', momentsList(a.moments), { right: 'Objetivos, estructuras y tus kills y muertes' }) : ''}
        ${!viewing && a.opp?.champ ? (loadNotes(a.champ?.key || 0, a.opp.champ.key), notesPanel(notesCache.get(`${a.champ?.key || 0}:${a.opp.champ.key}`), { title: `Apunta lo aprendido vs ${esc(a.opp.champ.name)}` })) : ''}
        ${panel('Tus números', 'target', `<table class="tbl"><thead><tr><th></th><th>Partida</th><th>Objetivo</th><th>Tu media</th></tr></thead><tbody>
            ${row('CS por minuto', st.csMin, tg.csMin, bl?.csMin, cmp(st.csMin, tg.csMin))}
            ${row('Participación en kills', st.kp + '%', tg.kp != null ? tg.kp + '%' : null, null, cmp(st.kp, tg.kp))}
            ${row('Daño del equipo', st.dmgShare + '%', tg.dmgShare != null ? tg.dmgShare + '%' : null, null, cmp(st.dmgShare, tg.dmgShare))}
            ${row('Visión por minuto', st.visionMin, tg.visionMin, bl?.visionMin, cmp(st.visionMin, tg.visionMin))}
            ${row('Wards de control', st.controlWards, a.sr ? '2+' : null, null, a.sr ? cmp(st.controlWards, 2) : '')}
            ${row('Oro por minuto', st.goldMin, null, null)}
          </tbody></table>${bl ? `<div class="xs dim" style="margin-top:8px">Tu media: últimas ${bl.games} partidas en la Grieta.</div>` : ''}`)}
        ${a.lane ? panel('Fase de líneas', 'swords', `<table class="tbl"><thead><tr><th></th><th>CS</th><th>Dif. CS</th><th>Dif. oro</th></tr></thead><tbody>
            ${[['Minuto 10', a.lane.at10], ['Minuto 14', a.lane.at14]].filter((r) => r[1]).map(([l, v]) => `<tr><td>${l}</td><td>${v.cs}</td><td class="wr ${v.csDiff >= 0 ? 'good' : 'bad'}">${v.csDiff != null ? (v.csDiff >= 0 ? '+' : '') + v.csDiff : '—'}</td><td class="wr ${v.goldDiff >= 0 ? 'good' : 'bad'}">${v.goldDiff != null ? (v.goldDiff >= 0 ? '+' : '') + v.goldDiff : '—'}</td></tr>`).join('')}
          </tbody></table>`, { right: a.opp ? `vs <b style="color:var(--text)">${esc(a.opp.champ?.name)}</b>` : '' }) : ''}
        ${a.objectives ? panel('Objetivos', 'crown', `<table class="tbl"><thead><tr><th></th><th>Dragones</th><th>Barones</th><th>Torres</th><th>Larvas</th></tr></thead><tbody>
          <tr><td class="allyc">Tu equipo</td><td>${a.objectives.ally.dragons}</td><td>${a.objectives.ally.barons}</td><td>${a.objectives.ally.towers}</td><td>${a.objectives.ally.grubs}</td></tr>
          <tr><td class="enemyc">Rival</td><td>${a.objectives.enemy.dragons}</td><td>${a.objectives.enemy.barons}</td><td>${a.objectives.enemy.towers}</td><td>${a.objectives.enemy.grubs}</td></tr></tbody></table>`) : ''}
      </div>
    </div></div>`;
}

async function loadAnalysis(id, puuid = null) {
  const key = anKey(id, puuid);
  if (analyses.has(key)) return;
  analyses.set(key, null);
  try {
    analyses.set(key, await (await fetch(`/api/games/${id}${puuid ? '?puuid=' + puuid : ''}`)).json());
  } catch {
    analyses.set(key, { error: 'No se pudo cargar el análisis' });
  }
  render();
}

async function loadPlayer(puuid, champ) {
  if (!puuid || playerCache.has(puuid)) return;
  playerCache.set(puuid, null);
  try {
    playerCache.set(puuid, await (await fetch(`/api/player/${puuid}${champ ? '?champ=' + champ : ''}`)).json());
  } catch {
    playerCache.set(puuid, { error: true });
  }
  render();
}

// ---------- Menú al pulsar un jugador de una partida ----------
let plMenu = null; // { puuid, gameId, name, x, y }

function openPlMenu(ev, puuid, gameId) {
  ev.stopPropagation();
  const name = ev.currentTarget?.dataset?.name || '';
  plMenu = { puuid, gameId, name, x: ev.clientX, y: ev.clientY };
  render();
}

function closePlMenu() {
  if (!plMenu) return;
  plMenu = null;
  render();
}

/** Abre el perfil de un jugador en el buscador. */
function openProfile(puuid, name) {
  plMenu = null;
  if (mapView) closeMap();
  if (puuid === state?.summoner?.puuid) { go('home'); return; }
  view = 'search';
  searchQ = name || '';
  window.scrollTo({ top: 0 });
  doSearch(null, puuid);
}

function playerMenu() {
  const m = plMenu;
  const mine = m.puuid === state?.summoner?.puuid;
  const x = Math.min(m.x, window.innerWidth - 250);
  const y = Math.min(m.y, window.innerHeight - 130);
  return `<div class="pmenu-bg" onclick="closePlMenu()"></div>
  <div class="pmenu" style="left:${x}px;top:${y}px" onclick="event.stopPropagation()">
    <div class="pmenu-t ell">${esc(m.name)}</div>
    <button onclick="plMenu=null;viewPlayer('${m.puuid}', ${m.gameId})">${icon('chart')}<span>${mine ? 'Ver mi partida' : 'Ver su partida'}<small>Análisis de esta partida desde su lado</small></span></button>
    <button onclick="openProfile(plMenu.puuid, plMenu.name)">${icon('users')}<span>${mine ? 'Ir a mi inicio' : 'Ver su perfil'}<small>Rango, campeones, previsión y partidas</small></span></button>
  </div>`;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlMenu(); });

/** Cambia el análisis al punto de vista de otro jugador de la partida (null = tú). */
function viewPlayer(puuid, gameId = null) {
  if (gameId) selectedGame = gameId;
  selectedPlayer = puuid && puuid !== state?.summoner?.puuid ? puuid : null;
  if (mapView) closeMap();
  view = 'games';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadGameList() {
  try {
    const data = await (await fetch('/api/games')).json();
    gameList = Array.isArray(data) ? data : [];
  } catch {
    gameList = [];
  }
  render();
}

function viewGames() {
  if (state?.summoner) loadProfile();
  const games = profileData?.recent;
  if (!games) return '<div class="grid g-games"><div class="skel" style="height:640px"></div><div class="skel" style="height:640px"></div></div>';
  if (!games.length) return emptyState('history', 'Sin partidas', 'No hay partidas en tu historial.');
  // Sin partida elegida: la lista completa (como en Blitz). Con una elegida: su análisis y un botón para volver.
  if (!selectedGame) {
    loadGameSums(games);
    return panel('Historial', 'history', `<div class="games">${games.map((g) => gameRow(g, { limitBadges: 6 })).join('')}</div>`, { right: `${games.length} partidas · clic para ver el análisis` });
  }
  loadAnalysis(selectedGame, selectedPlayer);
  return `<div class="stack" style="gap:12px"><div><button class="btn sm" onclick="go('games')">${icon('history')}Volver al historial</button></div>${viewAnalysis(analyses.get(anKey(selectedGame, selectedPlayer)))}</div>`;
}

/** Informe de la partida que acabas de jugar: resultado, LP, nota, lo que más te costó y tu objetivo para la siguiente. */
function reportCard(a, lp) {
  const pending = lp == null && a.ranked && Date.now() - (a.date || 0) < 2 * 3600_000; // los LP llegan unos segundos después
  const o = a.grades?.overall;
  const top = a.improve?.[0];
  const goal = top ? top.tip : a.strengths?.[0] ? `Repite lo que te ha funcionado: ${a.strengths[0].title.toLowerCase()}.` : 'Mantén el mismo nivel: CS constante y sin muertes evitables.';
  return `<section class="panel report ${a.win ? 'win' : 'loss'}" style="margin-bottom:16px"><div class="pb">
    <div class="rp-head">
      <div class="rp-res"><span class="lbl">Informe de la partida</span><div class="dsp ${a.win ? 'good' : 'bad'}">${a.win ? 'Victoria' : 'Derrota'}</div>
        <div class="s muted">${esc(a.champ?.name || '')} · ${esc(a.stats.kda)} · ${a.stats.csMin} CS/min · ${a.duration} min</div></div>
      <div class="rp-k"><div class="v ${lp == null ? 'dim' : lp >= 0 ? 'good' : 'bad'}">${lp == null ? (pending ? '…' : '—') : (lp > 0 ? '+' : '') + lp}</div><div class="k">${pending ? 'LP (calculando)' : 'LP'}</div></div>
      ${o ? `<div class="rp-k"><div class="v g-${o.grade}">${o.grade}</div><div class="k">Nota (${o.score}/100)</div></div>` : ''}
    </div>
    <div class="rp-grid">
      <div>${lbl('Lo que más te ha costado')}${(a.improve || []).slice(0, 3).map((x, i) => `<div class="rp-i"><span class="n">${i + 1}</span><div><b>${esc(x.title)}</b><div class="xs dim">${esc(x.detail)}</div></div></div>`).join('') || '<div class="s muted">Nada grave en esta partida.</div>'}</div>
      <div>${lbl('Lo que has hecho bien')}${(a.strengths || []).slice(0, 3).map((x) => `<div class="rp-i ok">${icon('check')}<div><b>${esc(x.title)}</b><div class="xs dim">${esc(x.detail)}</div></div></div>`).join('') || '<div class="s muted">—</div>'}</div>
    </div>
    ${on('postgame.badges') && a.badges?.length ? `<div class="rp-badges">${a.badges.slice(0, 6).map((b) => `<span class="badge-mini b-${b.tier}" title="${esc(b.detail)}">${icon(b.icon)}${esc(b.title)}</span>`).join('')}${a.badges.length > 6 ? `<span class="xs dim">+${a.badges.length - 6} más abajo</span>` : ''}</div>` : ''}
    <div class="advice" style="margin-top:12px">${icon('target')}<span><b>Objetivo para la siguiente partida:</b> ${esc(goal)}</span></div>
  </div></section>`;
}

function viewPostGame() {
  if (!gameList || Date.now() - (viewPostGame.fetched || 0) > 15000) {
    viewPostGame.fetched = Date.now();
    loadGameList();
  }
  // La última partida de verdad (sin remakes ni Herramienta de práctica / personalizadas)
  const last = gameList?.find((g) => !g.remake && g.queue !== 'Partida');
  if (!last) return emptyState('clock', 'Partida terminada', 'Esperando a que el cliente procese las estadísticas…');
  loadAnalysis(last.gameId);
  const a = analyses.get(anKey(last.gameId));
  return `${a && !a.error ? reportCard(a, lpDeltaOf(last.gameId)) : ''}${viewAnalysis(a)}`;
}
