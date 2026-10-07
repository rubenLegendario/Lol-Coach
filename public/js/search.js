'use strict';
/* LoL Coach — Buscador de jugadores y aviso de "en partida". */

// ---------- ¿Está en partida? (perfil de otro jugador) ----------
const liveCache = new Map(); // puuid -> { data, at, loading }

function loadLive(puuid) {
  const c = liveCache.get(puuid);
  if (c && (c.loading || Date.now() - c.at < 30000)) return;
  liveCache.set(puuid, { ...(c || {}), loading: true, at: Date.now() });
  const prev = c?.data;
  fetch(`/api/live/${puuid}`).then((r) => r.json()).then((d) => {
    liveCache.set(puuid, { data: d.error ? { error: d.error } : d, at: Date.now() });
    // Estaba en partida y ya no: la añadimos al historial en cuanto Riot la tenga
    if (prev?.inGame && !d.inGame && searchRes?.summoner?.puuid === puuid) {
      postGame = { puuid, gameId: prev.gameId || null, tries: 0, at: Date.now() };
      setTimeout(postGameCheck, 15000);
    }
    render();
  }).catch(() => liveCache.set(puuid, { data: null, at: Date.now() }));
}
// Mientras miras un perfil se vuelve a comprobar cada 30 s
setInterval(() => { if (view === 'search' && searchRes?.summoner?.puuid && !searchRes.isMe) { loadLive(searchRes.summoner.puuid); } }, 30000);

let postGame = null; // { puuid, gameId, tries } partida recién terminada que esperamos ver en el historial

async function reloadSearchProfile() {
  const id = searchRes?.summoner?.puuid;
  if (!id) return;
  profileLoading = true;
  render();
  try {
    const p = await (await fetch(`/api/profile/${id}?${filterQs(searchFilter)}`)).json();
    if (!p.error && searchRes?.summoner?.puuid === id) searchRes = p;
  } catch { /* se queda el anterior */ }
  profileLoading = false;
  render();
}

async function postGameCheck() {
  const pg = postGame;
  if (!pg || searchRes?.summoner?.puuid !== pg.puuid) { postGame = null; return; }
  await reloadSearchProfile();
  const found = pg.gameId ? searchRes?.recent?.some((g) => g.gameId === pg.gameId) : pg.tries >= 1;
  if (found || ++pg.tries >= 12) { postGame = null; render(); return; }
  setTimeout(postGameCheck, 30000);
}

async function spectateNow(puuid) {
  try {
    const r = await (await fetch(`/api/spectate/${puuid}`)).json();
    if (r.error) return toast(r.error, true);
    toast(`Abriendo la partida de ${r.name.split('#')[0]} como espectador (va con 3 min de retraso)…`);
  } catch {
    toast('No se pudo abrir el modo espectador', true);
  }
}

function liveTeam(list, side) {
  return `<div class="lb-team ${side}">${list.map((p) => `<div class="lb-p ${p.isTarget ? 'me' : ''}">
    ${img(p.champ, 'm')}<div style="min-width:0;flex:1"><div class="b ell">${esc(p.name ? p.name.split('#')[0] : p.champ?.name)}</div>
      <div class="xs dim ell">${esc(p.champ?.name || '')}${p.scout ? ` · ${esc(p.scout.rank.text.split(' · ')[0])}${p.scout.rank.winRate != null ? ` · ${Math.round(p.scout.rank.winRate * 100)}%` : ''}` : ''}</div>
      ${p.scout?.tags?.length ? `<div class="tags" style="margin-top:3px">${p.scout.tags.slice(0, 1).map((t) => tag(t, side)).join('')}</div>` : ''}</div>
    <div class="lb-sp">${p.spells.map((x) => img(x, 'xs')).join('')}</div></div>`).join('')}</div>`;
}

function liveBanner(puuid, name) {
  loadLive(puuid);
  const d = liveCache.get(puuid)?.data;
  if (!d || d.error) return '';
  if (!d.inGame && postGame?.puuid === puuid) {
    return `<div class="lb-mini">${icon('clock')}<span>Su partida acaba de terminar: Riot tarda unos minutos en procesarla. La añado al historial en cuanto esté (lo compruebo cada 30 s).</span></div>`;
  }
  if (!d.inGame) {
    if (d.friend) return `<div class="lb-mini">${icon('users')}<span>${esc(name)} es tu amigo · <b>${esc(d.status || 'En el cliente')}</b></span></div>`;
    return `<div class="lb-mini dim">${icon('info')}<span>${d.keyConfigured ? `No está en partida ahora mismo.${d.keyError ? ' ' + esc(d.keyError) : ''}` : 'Solo puedo saber si está en partida si es tu amigo en el LoL, o con una clave de la API de Riot (Ajustes).'}</span></div>`;
  }
  const teams = d.allies && d.enemies;
  return `<section class="panel live-b"><div class="pb">
    <div class="lb-head">
      <span class="live-pill"><i></i>EN PARTIDA</span>
      ${d.champ ? `${img(d.champ, 's')}<b>${esc(d.champ.name)}</b>` : ''}<span class="muted">${esc(d.queue || '')}</span>
      ${d.startTime ? `<span class="chip">${icon('clock')}<b class="num lb-clock" data-start="${d.startTime}">${fmtTime(Math.max(0, (Date.now() - d.startTime) / 1000))}</b></span>` : ''}
      <span class="sp"></span>
      ${d.winProb != null ? `<span class="chip ${d.winProb >= 50 ? 'good' : 'bad'}">Draft: <b>${d.winProb}%</b> para su equipo</span>` : ''}
      ${d.spectatable ? `<button class="btn sm" onclick="spectateNow('${puuid}')">${icon('play')}Ver en directo</button>` : ''}
    </div>
    ${teams ? `<div class="lb-teams">${liveTeam(d.allies, 'ally')}${liveTeam(d.enemies, 'enemy')}</div>
      ${d.bans?.length ? `<div class="row" style="margin-top:10px;gap:4px"><span class="xs dim b" style="letter-spacing:.1em;margin-right:4px">BANEOS</span>${d.bans.map((b) => img(b.champ, 'xs dim')).join('')}</div>` : ''}`
    : `<div class="xs dim" style="margin-top:10px">${d.spectatable ? 'Pulsa «Ver en directo» y en la pestaña Partida verás sus estadísticas en directo (KDA, CS, objetos, oro y objetivos).' : ''} Para ver aquí los 10 jugadores y la predicción del draft, añade una clave de la API de Riot en Ajustes.</div>`}
  </div></section>`;
}

// ---------- Buscador de jugadores ----------
function recentSearches() {
  try { return JSON.parse(localStorage.getItem('lolcoach.searches') || '[]'); } catch { return []; }
}

function rememberSearch(p) {
  try {
    const list = recentSearches().filter((x) => x.puuid !== p.puuid);
    list.unshift({ puuid: p.puuid, name: p.name, tag: p.tag, icon: p.icon });
    localStorage.setItem('lolcoach.searches', JSON.stringify(list.slice(0, 8)));
  } catch { /* opcional */ }
}

async function doSearch(q, puuid = null) {
  searchQ = q || searchQ;
  searchRes = 'loading';
  searchCoach = null;
  searchTrends = null;
  searchGame = null;
  searchFilter = { queue: 'auto', champ: null };
  postGame = null;
  render();
  try {
    let id = puuid;
    if (!id) {
      const r = await (await fetch(`/api/search?q=${encodeURIComponent(searchQ)}`)).json();
      if (r.error) throw new Error(r.error);
      id = r.puuid;
      rememberSearch(r);
    }
    const p = await (await fetch(`/api/profile/${id}`)).json();
    if (p.error) throw new Error(p.error);
    searchRes = p;
    render();
    searchTrends = 'loading';
    const c = await (await fetch(`/api/coach/${id}`)).json();
    searchCoach = c.error ? { error: c.error } : c;
    render();
    const t = await (await fetch(`/api/trends/${id}`)).json().catch(() => ({ error: 'x' }));
    if (searchRes?.summoner?.puuid === p.summoner?.puuid) searchTrends = t.error ? { error: t.error } : t;
  } catch (err) {
    searchRes = { error: err.message };
  }
  render();
}

function viewSearch() {
  const box = `<section class="panel"><div class="pb"><div class="searchbox">
    ${icon('search')}
    <input id="search-q" class="inp" placeholder="Busca a cualquier jugador por su Riot ID: Nombre#TAG" value="${esc(searchQ)}" onkeydown="if(event.key==='Enter')doSearch(this.value)" autocomplete="off" spellcheck="false">
    <button class="btn" onclick="doSearch(document.getElementById('search-q').value)">Buscar</button>
  </div>
  ${recentSearches().length ? `<div class="row" style="margin-top:12px"><span class="xs dim b" style="letter-spacing:.1em">RECIENTES</span>${recentSearches().map((r) => `<button class="chip" onclick="searchQ='${esc(r.name)}#${esc(r.tag)}';doSearch(null,'${r.puuid}')"><img class="ic xs round" src="${esc(r.icon)}" alt="">${esc(r.name)}<span class="dim">#${esc(r.tag)}</span></button>`).join('')}</div>` : ''}
  </div></section>`;
  const p = searchRes;
  if (!p) return box + emptyState('search', 'Busca a cualquier jugador', 'Tu dúo, un amigo, el rival que te ganó… Verás su rango, sus campeones, su estilo de juego y el análisis de cada una de sus partidas.');
  if (p === 'loading') return box + '<div class="stack mt" style="gap:16px"><div class="skel" style="height:240px;border-radius:22px"></div><div class="skel" style="height:300px"></div></div>';
  if (p.error) return box + `<div class="note mt">${icon('alert')}<span>${esc(p.error)}</span></div>`;
  const who = p.summoner;
  if (searchGame) {
    loadAnalysis(searchGame, who.puuid);
    return box + `<div class="mt"><button class="btn ghost sm" onclick="searchGame=null;render()">← Volver al perfil de ${esc(who.name.split('#')[0])}</button></div>
      <div class="mt">${viewAnalysis(analyses.get(anKey(searchGame, who.puuid)))}</div>`;
  }
  const sm = p.summary;
  const c = searchCoach;
  const [nm, tg] = who.name.split('#');
  const hero = `<section class="phero"><div class="art" style="background-image:url('${esc(p.champions[0]?.champ?.splash || p.mastery?.[0]?.champ?.splash || '')}')"></div>
    <div class="phero-in">
      <div style="min-width:0">
        <div class="row nw" style="gap:16px"><img class="ic xl round" src="${esc(who.icon)}" alt="">
          <div style="min-width:0"><div class="ph-name ell">${esc(nm)}<span>#${esc(tg || '')}</span></div>
            <div class="row" style="margin-top:10px"><span class="chip">Nivel <b>${who.level}</b></span>
              ${p.roles[0] ? `<span class="chip">${posIcon(p.roles[0].pos)}Main <b>${esc(p.roles[0].label)}</b></span>` : ''}
              ${p.streak >= 2 ? `<span class="chip good">${icon('flame')}${p.streak} victorias seguidas</span>` : p.streak <= -2 ? `<span class="chip bad">${icon('down')}${-p.streak} derrotas seguidas</span>` : ''}
              ${p.isMe ? '<span class="tag gold">Eres tú</span>' : ''}</div></div></div>
        ${sm ? `<div class="row" style="margin-top:22px;gap:22px">
          <div><div class="xs dim b" style="letter-spacing:.12em;text-transform:uppercase">${esc(sm.label)}</div><div class="row nw" style="gap:12px;margin-top:6px"><span class="dsp ${wrClass(sm.winRate)}" style="font-size:44px">${sm.winRate}%</span><span class="s muted">${sm.wins}V ${sm.losses}D</span></div></div>
          <div><div class="xs dim b" style="letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Últimas 10</div><div class="form">${sm.form.map((w) => `<span class="${w ? 'w' : 'l'}">${w ? 'V' : 'D'}</span>`).join('')}</div></div>
        </div>` : ''}
      </div>
      <div class="ranks">${p.ranks.map((r) => `<div class="rank">${emblem(r.tier)}<div class="rank-q">${esc(r.queue)}</div><div class="rank-t">${esc(r.text)}</div>
        ${r.lp != null ? `<div class="s"><b class="goldc">${r.lp} LP</b>${r.winRate != null && r.losses ? ` · <span class="${wrClass(r.winRate, 50.5, 49.5)}">${r.winRate}%</span>` : ''}</div>` : '<div class="xs dim">Sin clasificar</div>'}</div>`).join('')}</div>
    </div></section>`;
  const kpis = sm ? panel('Rendimiento', 'chart', `<div class="kpis">
      <div class="kpi"><div class="k">KDA</div><div class="v">${sm.kdaRatio}</div><div class="s">${esc(sm.kda)}</div></div>
      <div class="kpi"><div class="k">CS/min</div><div class="v">${sm.csMin}</div></div>
      <div class="kpi"><div class="k">Visión/min</div><div class="v">${sm.visionMin}</div></div>
      <div class="kpi"><div class="k">Daño/min</div><div class="v">${sm.dmgMin}</div></div>
      <div class="kpi"><div class="k">Oro/min</div><div class="v">${sm.goldMin}</div></div></div>`, { right: esc(sm.label) }) : '';
  const style = panel('Su estilo de juego', 'book', !c ? '<div class="skel" style="height:160px"></div>' : c.error ? `<div class="s dim">${esc(c.error)}</div>`
    : `${c.habits?.length ? `${lbl('Sus puntos débiles')}<div class="stack">${c.habits.map((h) => `<div class="insight good">${icon('target')}<span><b>${esc(h.title)}</b> · en ${h.games} de ${h.of} partidas</span></div>`).join('')}</div>` : ''}
      ${c.strengths?.length ? `${lbl('Sus puntos fuertes')}<div class="row">${c.strengths.map((x) => `<span class="chip bad">${esc(x.title)} <b>${x.games}/${x.of}</b></span>`).join('')}</div>` : ''}
      ${c.avgScore != null ? `<div class="s muted" style="margin-top:12px">Nota media del coach: <b class="g-${gradeOf(c.avgScore)}">${gradeOf(c.avgScore)}</b> (${c.avgScore}/100) en ${c.analyzed} partidas <span class="dim" title="Nota de 0 a 100 que calcula la app con sus partidas">(estimación de la app)</span>.</div>` : ''}`,
    { cls: 'gold', right: p.isMe ? '' : 'Úsalo para jugar contra él' });
  const champs = panel('Sus campeones', 'star', `
    ${p.champions.length ? `<table class="tbl"><thead><tr><th>Campeón</th><th>Partidas</th><th>Winrate</th><th>KDA</th><th>CS/min</th></tr></thead><tbody>${p.champions.map((ch) => `<tr><td><div class="row nw">${img(ch.champ, 's')}<b style="color:var(--text)">${esc(ch.champ?.name)}</b></div></td><td>${ch.games}</td><td class="wr ${wrClass(ch.winRate)}">${ch.winRate}%</td><td><b>${ch.kdaRatio}</b></td><td>${ch.csMin}</td></tr>`).join('')}</tbody></table>` : ''}
    ${p.mastery?.length ? `${lbl('Más maestría')}<div class="row">${p.mastery.map((m) => `<span class="chip">${img(m.champ, 'xs')}<b>${esc(m.champ?.name)}</b><span class="dim">${fmtNum(m.points)}</span></span>`).join('')}</div>` : ''}`);
  loadGameSums(p.recent, who.puuid);
  const recent = panel('Partidas recientes', 'history', `<div class="games">${p.recent.map((g) => gameRow(g, { puuid: who.puuid, onclick: `searchGame=${g.gameId};render();window.scrollTo({top:0})` })).join('')}</div>`, { right: 'Clic para ver su análisis' });
  return box + `<div class="stack mt" style="gap:16px">${hero}${p.isMe ? '' : liveBanner(who.puuid, nm)}${profileFilterBar(p, 'setSearchFilter')}
    <div class="grid g-home ${profileLoading ? 'busy' : ''}"><div class="col">${sessionPanel(p.session, p.isMe ? 'Sesión de hoy' : 'Su sesión de hoy')}${forecastPanel(p.forecast, !p.isMe)}${p.isMe && p.lp ? lpPanel(p.lp) : ''}${kpis}${style}${trendsPanel(searchTrends, p.isMe ? 'Tu evolución' : 'Su evolución')}${deathMapPanel(c?.deathMap)}${champs}</div><div class="col">${recent}</div></div></div>`;
}
