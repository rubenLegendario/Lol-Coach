'use strict';
/* LoL Coach — Explorador del mapa de una partida y mando de la repetición. */

// ---------- Explorador del mapa de una partida ----------
const MAP_LAYERS = [['players', 'Jugadores'], ['kills', 'Kills'], ['objectives', 'Objetivos'], ['path', 'Recorrido']];

async function openMap(gameId, minute = null, puuid = null) {
  const key = `${gameId}:${puuid || ''}`;
  mapView = { gameId, puuid: puuid || null, data: mapCache.get(key) || null, minute: minute ?? 0, playing: false, layers: { players: true, kills: true, objectives: true, path: true }, tab: 'minute', focus: null, player: null, replay: { status: null, busy: false, msg: null } };
  render();
  clearInterval(replayTimer);
  replayPoll();
  replayTimer = setInterval(replayPoll, 3000);
  if (!mapView.data) {
    try {
      const d = await (await fetch(`/api/games/${gameId}/map${puuid ? '?puuid=' + puuid : ''}`)).json();
      mapCache.set(key, d);
      if (mapView?.gameId === gameId) {
        mapView.data = d;
        if (minute == null) mapView.minute = d.deaths?.[0] ? Math.floor(d.deaths[0].t / 60) : 0;
      }
    } catch {
      if (mapView) mapView.data = { error: 'No se pudo cargar el mapa' };
    }
    render();
  }
}

// ---------- Mando de la repetición ----------
async function replayPoll() {
  if (!mapView) return clearInterval(replayTimer);
  try {
    const st = await (await fetch(`/api/replay/${mapView.gameId}`)).json();
    if (mapView) mapView.replay.status = st.error ? null : st;
  } catch { /* sin conexión */ }
  render();
}

async function replayOpen() {
  const r = mapView.replay;
  r.busy = true;
  r.msg = 'Descargando la repetición y abriendo el juego…';
  render();
  try {
    const res = await (await fetch(`/api/replay/${mapView.gameId}/open`, { method: 'POST' })).json();
    r.msg = res.error
      ? res.error
      : `El juego está cargando la repetición. Cuando aparezca, contrólala desde aquí.${res.changedCfg ? ' He activado la API de repeticiones del juego (copia de seguridad: Config/game.cfg.lolcoach-backup).' : ''}`;
    r.error = !!res.error;
  } catch {
    r.msg = 'No se pudo abrir la repetición';
    r.error = true;
  }
  r.busy = false;
  render();
}

async function replayCtl(body) {
  try {
    const res = await (await fetch('/api/replay/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (res?.error) toast(res.error, true);
  } catch {
    toast('No se pudo controlar la repetición', true);
  }
  replayPoll();
}

/** Salta a un instante (segundos de partida) y fija la cámara en un campeón. */
function replaySeek(t, pid, lead = 10) {
  const p = mapView?.data?.participants.find((x) => x.pid === pid);
  replayCtl({ action: 'seek', t, lead, follow: p?.champ?.name, followId: p?.champ?.id });
}

function replayBar(mv) {
  const st = mv.replay?.status;
  const sel = mv.player || mv.data?.myPid;
  const selP = mv.data?.participants?.find((p) => p.pid === sel);
  if (st?.connected) {
    return `<div class="rbar on"><span class="chip live">Repetición</span>
      <button class="btn ghost sm" onclick="replayCtl({action:'${st.paused ? 'play' : 'pause'}'})">${icon(st.paused ? 'play' : 'pause')}${st.paused ? 'Reanudar' : 'Pausa'}</button>
      <span class="seg">${[0.25, 0.5, 1, 2].map((v) => `<button class="${st.speed === v ? 'on' : ''}" onclick="replayCtl({action:'speed',speed:${v}})">${v}x</button>`).join('')}</span>
      <button class="btn sm" onclick="replaySeek(${mv.minute * 60}, ${sel}, 0)">${icon('film')}Ir al minuto ${mv.minute}</button>
      ${selP ? `<button class="btn ghost sm" onclick="replayCtl({action:'follow',champion:'${esc(selP.champ?.name)}',championId:'${esc(selP.champ?.id)}'})">Cámara: ${esc(selP.champ?.name)}</button>` : ''}
      ${st.time != null ? `<span class="s dim num">${fmtTime(st.time)}</span>` : ''}</div>`;
  }
  if (st?.state === 'incompatible') return `<div class="rbar"><span class="chip warn">${icon('film')}Repetición de otro parche: Riot no deja verla</span></div>`;
  if (st?.state === 'missingOrExpired' || st?.state === 'lost') return `<div class="rbar"><span class="chip">${icon('film')}Repetición ya no disponible</span></div>`;
  return `<div class="rbar">
    <button class="btn sm" ${mv.replay?.busy ? 'disabled' : ''} onclick="replayOpen()">${icon('film')}${mv.replay?.busy ? 'Abriendo…' : st?.playingReplay ? 'Conectando con la repetición…' : 'Ver la repetición real'}</button>
    <span class="s ${mv.replay?.error ? 'bad' : 'dim'}">${esc(mv.replay?.msg || 'Abre la repetición oficial en el juego y contrólala desde aquí: salta a cada muerte, cámara lenta y cámara fija en el campeón que elijas.')}</span></div>`;
}

function closeMap() {
  clearInterval(mapTimer);
  clearInterval(replayTimer);
  mapView = null;
  render();
}

function mapSeek(min) {
  if (!mapView?.data?.frames) return;
  mapView.minute = Math.max(0, Math.min(mapView.data.frames.length - 1, Number(min)));
  render();
}

function mapPlay() {
  if (!mapView?.data?.frames) return;
  mapView.playing = !mapView.playing;
  clearInterval(mapTimer);
  if (mapView.playing) {
    if (mapView.minute >= mapView.data.frames.length - 1) mapView.minute = 0;
    mapTimer = setInterval(() => {
      if (!mapView || mapView.minute >= mapView.data.frames.length - 1) {
        clearInterval(mapTimer);
        if (mapView) mapView.playing = false;
      } else mapView.minute++;
      render();
    }, 750);
  }
  render();
}

function mapSelect(pid) {
  if (!mapView?.data) return;
  mapView.player = pid === mapView.data.myPid ? null : pid;
  mapView.tab = mapView.player ? 'player' : 'minute';
  const p = mapView.data.participants.find((x) => x.pid === pid);
  if (p?.puuid && !p.isMe) loadPlayer(p.puuid, p.champ?.key);
  render();
}

function mapLayer(k) {
  mapView.layers[k] = !mapView.layers[k];
  render();
}

function mapFocusDeath(i) {
  const d = mapView.data.deaths[i];
  mapView.focus = i;
  mapView.tab = 'deaths';
  mapView.minute = Math.min(mapView.data.frames.length - 1, Math.floor(d.t / 60));
  render();
}

const EV_ICON = { kill: 'sword', dragon: 'flame', elder: 'flame', baron: 'crown', herald: 'zap', grubs: 'zap', tower: 'shield', inhib: 'shield' };

function viewMapModal() {
  const mv = mapView;
  const d = mv.data;
  const a = analyses.get(anKey(mv.gameId, mv.puuid));
  const head = `<header class="mm-head">
    <div class="row nw" style="gap:12px;min-width:0">${a?.champ ? img(a.champ, 'm') : ''}<div style="min-width:0"><div class="b" style="font-size:16px">Mapa de la partida</div>
      <div class="s dim ell">${a ? `<span class="${a.win ? 'good' : 'bad'} b">${a.win ? 'Victoria' : 'Derrota'}</span> · ${esc(a.champ?.name)} · ${esc(a.queue)} · ${a.duration} min` : ''}</div></div></div>
    <button class="btn ghost sm" onclick="closeMap()" aria-label="Cerrar">✕ Cerrar</button></header>
    ${d && !d.error ? replayBar(mv) : ''}`;
  if (!d) return `<div class="modal" onclick="if(event.target===this)closeMap()"><div class="modal-box">${head}<div class="skel" style="height:560px;margin:18px"></div></div></div>`;
  if (d.error) return `<div class="modal" onclick="if(event.target===this)closeMap()"><div class="modal-box">${head}<div style="padding:18px"><div class="note">${icon('alert')}<span>${esc(d.error)}</span></div></div></div></div>`;

  const m = mv.minute;
  const tNow = m * 60 + 59;
  const frame = d.frames[m];
  const byPid = new Map(d.participants.map((p) => [p.pid, p]));
  const champName = (pid) => byPid.get(pid)?.champ?.name || '?';
  const sel = mv.player || d.myPid; // jugador seleccionado (por defecto, tú)
  const selP = byPid.get(sel);
  const rel = (e) => (e.type !== 'kill' ? null : e.killer === sel ? 'kill' : e.victim === sel ? 'death' : null);

  // KDA hasta el minuto elegido
  const kda = {};
  for (const p of d.participants) kda[p.pid] = { k: 0, d: 0, a: 0 };
  for (const e of d.events) {
    if (e.type !== 'kill' || e.t > tNow) continue;
    if (kda[e.killer]) kda[e.killer].k++;
    if (kda[e.victim]) kda[e.victim].d++;
    for (const x of e.assists) if (kda[x]) kda[x].a++;
  }

  // Capas del mapa
  const visible = d.events.filter((e) => e.t <= tNow);
  const age = (e) => tNow - e.t;
  const evLayer = visible.filter((e) => (e.type === 'kill' ? mv.layers.kills : mv.layers.objectives)).map((e) => {
    const recent = age(e) <= 120;
    const r = rel(e);
    const cls = e.type === 'kill' ? (r === 'death' ? 'my-death' : r === 'kill' ? 'my-kill' : `k-${e.team}`) : `obj o-${e.team} o-${e.type}`;
    const title = e.type === 'kill' ? `${e.time} · ${champName(e.killer)} mata a ${champName(e.victim)}` : `${e.time} · ${e.team === 'ally' ? 'Tu equipo' : 'El rival'}: ${e.label}`;
    return `<span class="mev ${cls} ${recent ? 'recent' : 'old'}" style="left:${e.left.toFixed(2)}%;top:${e.top.toFixed(2)}%" title="${esc(title)}">${e.type === 'kill' && !r ? '' : icon(r === 'death' ? 'skull' : EV_ICON[e.type] || 'info')}</span>`;
  }).join('');
  const pathPts = d.frames.slice(0, m + 1).map((f) => f.players[sel]).filter((p) => p?.left != null);
  const pathLayer = mv.layers.path && pathPts.length > 1 ? `<svg class="mpath" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pathPts.map((p) => `${p.left.toFixed(2)},${p.top.toFixed(2)}`).join(' ')}"/></svg>` : '';
  const players = mv.layers.players ? d.participants.map((p) => {
    const f = frame.players[p.pid];
    if (f?.left == null) return '';
    const deadNow = d.events.some((e) => e.type === 'kill' && e.victim === p.pid && e.t <= tNow && tNow - e.t < 30);
    return `<span class="mp ${p.team} ${p.isMe ? 'me' : ''} ${p.pid === mv.player ? 'sel' : ''} ${deadNow ? 'dead' : ''}" onclick="mapSelect(${p.pid})" style="left:${f.left.toFixed(2)}%;top:${f.top.toFixed(2)}%" title="${esc(p.champ?.name)} · nivel ${f.level}">${p.champ?.icon ? `<img src="${esc(p.champ.icon)}" alt="">` : ''}</span>`;
  }).join('') : '';
  const focusDeath = mv.focus != null ? d.deaths[mv.focus] : null;
  const focusRing = focusDeath && Math.floor(focusDeath.t / 60) === m ? `<span class="mfocus" style="left:${focusDeath.left.toFixed(2)}%;top:${focusDeath.top.toFixed(2)}%"></span>` : '';

  // Controles de tiempo
  const total = d.frames.length - 1;
  const ticks = d.events.filter((e) => e.type !== 'kill' || e.mine === 'death').map((e) => `<span class="tk ${e.mine === 'death' ? 'death' : e.team}" style="left:${((e.t / 60 / Math.max(1, total)) * 100).toFixed(2)}%"></span>`).join('');
  const gd = frame.goldDiff;
  const controls = `<div class="mctl">
    <button class="btn sm" onclick="mapPlay()">${mv.playing ? '❚❚ Pausa' : '▶ Reproducir'}</button>
    <div class="mslider"><div class="mticks">${ticks}</div><input type="range" min="0" max="${total}" value="${m}" oninput="mapSeek(this.value)" aria-label="Minuto"></div>
    <div class="mtime"><span class="dsp" style="font-size:24px">${m}'</span><span class="s ${gd >= 0 ? 'good' : 'bad'} b">${gd >= 0 ? '+' : '−'}${fmtNum(Math.abs(gd))}</span></div>
  </div>`;

  // Panel lateral
  const teamTable = (team) => d.participants.filter((p) => p.team === team).map((p) => {
    const f = frame.players[p.pid] || {};
    const s = kda[p.pid];
    return `<div class="ms-row ${p.isMe ? 'me' : ''} ${p.pid === mv.player ? 'sel' : ''}" onclick="mapSelect(${p.pid})" title="Ver a ${esc(p.name)}"><div class="iw">${img(p.champ, 's')}<span class="lv">${f.level ?? ''}</span></div><span class="ell s b">${esc(p.champ?.name)}</span>
      <span class="s num">${s.k}/${s.d}/${s.a}</span><span class="s num dim">${f.cs ?? 0}</span><span class="s num goldc">${fmtNum(f.gold || 0)}</span></div>`;
  }).join('');
  const minuteEvents = d.events.filter((e) => e.t >= m * 60 - 59 && e.t <= tNow).slice(-8).reverse();
  const tabMinute = `
    <div class="ms-h"><span class="lbl allyc">Tu equipo</span><span class="xs dim">KDA</span><span class="xs dim">CS</span><span class="xs dim">Oro</span></div>${teamTable('ally')}
    <div class="ms-h" style="margin-top:10px"><span class="lbl enemyc">Rival</span><span class="xs dim">KDA</span><span class="xs dim">CS</span><span class="xs dim">Oro</span></div>${teamTable('enemy')}
    ${lbl(`Qué pasó en el minuto ${m}`)}
    ${minuteEvents.length ? `<div class="stack" style="gap:4px">${minuteEvents.map((e) => `<div class="moment ${e.team}">${mv.replay?.status?.connected ? `<button class="rplay" title="Ver en la repetición" onclick="replaySeek(${e.t}, ${e.victim || e.killer || d.myPid})">${icon('play')}</button>` : ''}<span class="m-t">${e.time}</span><span class="m-ic ${e.mine || e.type}">${icon(e.mine === 'death' ? 'skull' : EV_ICON[e.type] || 'info')}</span><span class="ell">${e.type === 'kill' ? `${esc(champName(e.killer))} mata a ${esc(champName(e.victim))}` : `${e.team === 'ally' ? 'Tu equipo' : 'El rival'}: ${esc(e.label)}`}</span></div>`).join('')}</div>` : '<div class="s dim">Nada destacable en este minuto.</div>'}`;
  const sc = selP?.puuid ? playerCache.get(selP.puuid) : null;
  const st = selP?.stats;
  const selKda = kda[sel];
  const tabPlayer = selP ? `<div class="pcard ${selP.team}">
      <div class="row nw" style="gap:12px">${img(selP.champ, 'l')}<div style="min-width:0"><div class="b ell" style="font-size:16px">${esc(selP.name)}<span class="dim">#${esc(selP.tag || '')}</span></div>
        <div class="row" style="gap:6px;margin-top:2px">${posIcon(selP.pos)}<span class="s muted">${esc(selP.champ?.name)} · ${esc(selP.posLabel || '')}</span><span class="tag ${selP.team === 'ally' ? 'info' : 'bad'}">${selP.team === 'ally' ? 'Aliado' : 'Rival'}</span></div></div></div>
      ${selP.isMe ? '' : !sc ? '<div class="skel" style="height:44px;margin-top:12px"></div>' : sc.error ? '' : `<div class="inset" style="margin-top:12px">
        <div class="row nw"><b>${esc(sc.rank?.text || 'Sin clasificar')}</b>${sc.rank?.winRate != null ? `<span class="s muted">${Math.round(sc.rank.winRate * 100)}% · ${sc.rank.wins}V ${sc.rank.losses}D</span>` : ''}</div>
        ${sc.champMastery ? `<div class="xs dim" style="margin-top:3px">${fmtNum(sc.champMastery.points)} pts con ${esc(selP.champ?.name)}</div>` : ''}
        ${sc.tags?.length ? `<div class="tags" style="margin-top:6px">${sc.tags.slice(0, 4).map((t) => tag(t, selP.team)).join('')}</div>` : ''}
        <div class="form-dots">${(sc.recent || []).map((g) => `<span class="${g.win ? 'w' : ''}"></span>`).join('')}</div>
      </div>`}
      ${lbl(`Al minuto ${m}`)}
      <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi"><div class="k">KDA</div><div class="v" style="font-size:20px">${selKda.k}/${selKda.d}/${selKda.a}</div></div>
        <div class="kpi"><div class="k">Nivel</div><div class="v" style="font-size:20px">${frame.players[sel]?.level ?? '—'}</div></div>
        <div class="kpi"><div class="k">CS</div><div class="v" style="font-size:20px">${frame.players[sel]?.cs ?? '—'}</div></div>
        <div class="kpi"><div class="k">Oro</div><div class="v goldc" style="font-size:20px">${fmtNum(frame.players[sel]?.gold || 0)}</div></div>
      </div>
      ${st ? `${lbl('Final de la partida')}
        <div class="row" style="gap:14px"><span class="s"><b>${st.k}/${st.d}/${st.a}</b> KDA</span><span class="s"><b>${st.cs}</b> CS</span><span class="s"><b>${fmtNum(st.dmg)}</b> daño</span><span class="s"><b>${st.vision}</b> visión</span></div>
        <div class="row" style="gap:4px;margin-top:8px">${st.spells.map((x) => img(x, 's')).join('')}${st.keystone?.icon ? `<img class="ic s round" src="${esc(st.keystone.icon)}" alt="" title="${esc(st.keystone.name)}">` : ''}<span class="rsep"></span>${st.items.map((i) => img(i, 's')).join('')}</div>` : ''}
      ${selP.puuid ? `<button class="btn" style="width:100%;margin-top:14px" onclick="viewPlayer('${selP.puuid}')">${icon('chart')}${selP.isMe ? 'Ver mi análisis completo' : 'Ver su análisis completo'}</button>` : ''}
      <div class="xs dim" style="margin-top:8px">En el mapa ves su recorrido y sus kills (verde) y muertes (rojo).</div>
    </div>` : '';
  const tabDeaths = d.deaths.length ? `<div class="stack">${d.deaths.map((x, i) => `<div class="dcard ${mv.focus === i ? 'on' : ''}" role="button" tabindex="0" onclick="mapFocusDeath(${i})">
      <div class="row nw"><span class="dnum ${x.insights.some((t) => t.type === 'bad') ? 'gank' : ''}">${x.n}</span><b>${x.time}</b><span class="s muted ell">${esc(x.zone)}</span><span class="sp"></span>${byPid.get(x.killer)?.champ ? img(byPid.get(x.killer).champ, 'xs') : ''}</div>
      <div class="xs dim" style="margin:4px 0 6px">Te mató ${esc(champName(x.killer))}${x.assists.length ? ` con ayuda de ${x.assists.map((p) => esc(champName(p))).join(', ')}` : ''}</div>
      ${x.insights.map((t) => `<div class="ins ${t.type}">${icon(t.type === 'bad' ? 'alert' : t.type === 'warn' ? 'alert' : 'info')}<span>${esc(t.text)}</span></div>`).join('')}
      ${mv.replay?.status?.connected ? `<button class="btn sm" style="margin-top:8px" onclick="event.stopPropagation();replaySeek(${x.t}, ${d.myPid})">${icon('film')}Ver esta muerte en la repetición</button>` : ''}
    </div>`).join('')}</div>` : '<div class="muted">No moriste en esta partida.</div>';

  return `<div class="modal" onclick="if(event.target===this)closeMap()"><div class="modal-box">${head}
    <div class="mm-body">
      <div class="mm-left">
        <div class="mm-map"><img src="${mapImg()}" alt="Minimapa">${pathLayer}${evLayer}${players}${focusRing}</div>
        ${controls}
        <div class="row" style="margin-top:10px">${MAP_LAYERS.map(([k, l]) => `<button class="chip ${mv.layers[k] ? 'gold' : ''}" onclick="mapLayer('${k}')">${mv.layers[k] ? icon('check') : ''}${l}</button>`).join('')}</div>
        <div class="legend-i"><span><i style="background:var(--ally)"></i>Tu equipo</span><span><i style="background:var(--enemy)"></i>Rival</span><span><i style="background:var(--gold-2)"></i>Tú</span><span class="dim">Las kills de los últimos 2 min se ven más fuertes</span></div>
      </div>
      <div class="mm-side">
        <span class="seg"><button class="${mv.tab === 'minute' ? 'on' : ''}" onclick="mapView.tab='minute';render()">Minuto ${m}</button><button class="${mv.tab === 'player' ? 'on' : ''}" onclick="mapView.tab='player';render()">${esc(selP?.champ?.name || 'Jugador')}</button><button class="${mv.tab === 'deaths' ? 'on' : ''}" onclick="mapView.tab='deaths';render()">Tus muertes (${d.deaths.length})</button></span>
        <div style="margin-top:12px">${mv.tab === 'deaths' ? tabDeaths : mv.tab === 'player' ? tabPlayer : tabMinute}</div>
        ${mv.tab !== 'player' ? '<div class="xs dim" style="margin-top:10px">Haz clic en cualquier jugador (en la tabla o en el mapa) para seguirle.</div>' : ''}
      </div>
    </div></div></div>`;
}
