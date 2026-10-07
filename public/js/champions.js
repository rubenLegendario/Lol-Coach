'use strict';
/* LoL Coach — Campeones: tu pool, cobertura de matchups y libreta de notas. */

// ---------- Campeones: pool y libreta ----------
let myPool = null; // { TOP: [...], ... } tu pool elegido
let champList = null; // todos los campeones con su presencia por rol
let poolRole = null; // rol que estás viendo en "Campeones"
let poolSearch = '';
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

async function loadMyPool() {
  if (myPool) return;
  myPool = 'loading';
  try {
    const [p, c] = await Promise.all([fetch('/api/mypool').then((r) => r.json()), champList ? champList : fetch('/api/champions').then((r) => r.json())]);
    myPool = p.error ? { error: p.error } : p;
    if (!c.error) champList = c;
  } catch {
    myPool = { error: 'No se pudo cargar tu pool' };
  }
  render();
}

async function poolEdit(champId, action) {
  try {
    const r = await (await fetch('/api/mypool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: poolRole, champId, action }) })).json();
    if (r.error) return toast(r.error, true);
    myPool = r;
    if (action === 'add') { poolSearch = ''; const i = document.getElementById('pool-q'); if (i) i.value = ''; }
    poolData = null; // recalcular la cobertura con el pool nuevo
    render();
  } catch {
    toast('No se pudo guardar', true);
  }
}

function setPoolRole(r) {
  poolRole = r;
  poolSearch = '';
  poolData = null;
  render();
}

async function loadPool() {
  if (poolData) return;
  poolData = 'loading';
  try {
    const p = await (await fetch(`/api/pool${poolRole ? '?role=' + poolRole : ''}`)).json();
    if (!p.error && !poolRole) poolRole = p.role;
    poolData = p.error ? { error: p.error } : p;
  } catch {
    poolData = { error: 'No se pudo analizar tu pool' };
  }
  render();
}

async function loadAllNotes() {
  if (notesAll) return;
  notesAll = 'loading';
  try {
    notesAll = await (await fetch('/api/notes/all')).json();
  } catch {
    notesAll = [];
  }
  render();
}

function myPoolPanel() {
  const mp = myPool;
  if (!mp || mp === 'loading' || !poolRole) return '<div class="skel" style="height:260px"></div>';
  if (mp.error) return `<div class="note">${icon('alert')}<span>${esc(mp.error)}</span></div>`;
  const list = mp[poolRole] || [];
  const inPool = new Set(list.map((c) => c.champ.key));
  const norm = (x) => String(x || '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const q = norm(poolSearch);
  const sugg = (champList || [])
    .filter((c) => !inPool.has(c.key) && (q ? norm(c.name).includes(q) : (c.roles?.[poolRole] || 0) >= 10))
    .sort((a, b) => (b.roles?.[poolRole] || 0) - (a.roles?.[poolRole] || 0))
    .slice(0, q ? 24 : 18);
  const tabs = `<span class="seg">${ROLES.map((r) => `<button class="${r === poolRole ? 'on' : ''}" onclick="setPoolRole('${r}')">${POS[r]}${mp[r]?.length ? ` <span class="dim">${mp[r].length}</span>` : ''}</button>`).join('')}</span>`;
  return panel('Tu pool de campeones', 'star', `
    <div class="s muted" style="margin:-4px 0 12px">Elige los campeones que juegas en cada rol, en orden de preferencia. En la selección de campeón te diré cuál de ellos va mejor en cada partida: counter de tu línea, sinergia con tus aliados y composición.</div>
    ${list.length ? `<div class="mp-list">${list.map((c, i) => `<div class="mp-c">
        <span class="mp-n">${i + 1}</span>${img(c.champ, 'm')}
        <div style="min-width:0;flex:1"><div class="b ell">${esc(c.champ.name)}${c.offRole ? ' <span class="tag warn">Poco visto en este rol</span>' : ''}</div>
          <div class="xs dim">${c.winRate != null ? `<span class="${wrClass(c.winRate, 51, 49)}">${c.winRate}%</span> en el parche` : 'Sin datos en este rol'} · ${c.games ? `tus partidas: <b style="color:var(--text)">${c.wins}V ${c.games - c.wins}D</b>` : 'sin partidas analizadas'}${c.mastery ? ` · ${fmtNum(c.mastery)} pts` : ''}</div></div>
        <div class="mp-act">
          <button title="Subir" ${i === 0 ? 'disabled' : ''} onclick="poolEdit(${c.champ.key},'up')">${icon('up')}</button>
          <button title="Bajar" ${i === list.length - 1 ? 'disabled' : ''} onclick="poolEdit(${c.champ.key},'down')">${icon('down')}</button>
          <button title="Quitar" class="rm" onclick="poolEdit(${c.champ.key},'remove')">${icon('x')}</button>
        </div></div>`).join('')}</div>`
      : `<div class="note">${icon('info')}<span>Aún no has elegido campeones para ${POS[poolRole]}. Mientras tanto uso los que más juegas.</span></div>`}
    <div class="mp-add">
      <div class="searchbox sm">${icon('search')}<input id="pool-q" class="inp" placeholder="Añadir campeón a ${POS[poolRole]}…" value="${esc(poolSearch)}" oninput="poolSearch=this.value;render()" onkeydown="if(event.key==='Enter'){const b=document.querySelector('.mp-s');if(b)b.click();}" autocomplete="off" spellcheck="false"></div>
      <div class="xs dim" style="margin:8px 0 6px">${q ? 'Resultados' : `Los más jugados en ${POS[poolRole]}`}</div>
      <div class="mp-grid">${sugg.map((c) => `<button class="mp-s" onclick="poolEdit(${c.key},'add')" title="Añadir ${esc(c.name)}">${img(c, 'm')}<span class="ell">${esc(c.name)}</span>${c.roles?.[poolRole] ? `<span class="xs dim">${c.roles[poolRole]}%</span>` : ''}</button>`).join('') || '<span class="s dim">Ningún campeón coincide.</span>'}</div>
    </div>`, { cls: 'gold', right: tabs });
}

function viewPool() {
  loadMyPool();
  loadPool();
  loadAllNotes();
  const p = poolData;
  const poolPanel = !p || p === 'loading'
    ? '<div class="skel" style="height:420px"></div>'
    : p.error ? `<div class="note">${icon('alert')}<span>${esc(p.error)}</span></div>`
    : panel(`Cobertura de tu pool en ${esc(p.roleLabel)}`, 'layers', `
      <div class="row" style="gap:22px;align-items:center">
        ${ring(120, 10, [{ v: p.coveragePct, color: p.coveragePct >= 70 ? 'var(--win)' : p.coveragePct >= 45 ? 'var(--warn)' : 'var(--enemy)' }], `<div class="dsp" style="font-size:30px">${p.coveragePct}%</div><div class="xs dim b" style="letter-spacing:.1em">CUBIERTO</div>`)}
        <div style="min-width:0;flex:1">
          <div class="b" style="font-size:16px">${p.pool.length === 1 ? `Solo juegas ${esc(p.pool[0].champ.name)}` : `Juegas ${p.pool.length} campeones`}</div>
          <div class="s muted" style="margin-top:4px">Tu pool gana o empata el ${p.coveragePct}% de los matchups del meta (ponderado por lo que se juega). ${p.holes ? `Hay <b class="bad">${p.holes} matchups</b> en los que tu pool pierde.` : '¡Sin huecos!'}</div>
          <div class="row" style="margin-top:10px">${p.pool.map((c) => `<span class="chip">${img(c.champ, 'xs')}<b>${esc(c.champ.name)}</b><span class="dim">${c.games} part.</span></span>`).join('')}</div>
        </div>
      </div>
      ${lbl('Matchups del meta', 'Tu mejor respuesta')}
      <div class="cov">${p.coverage.map((c) => `<div class="cov-i ${c.covered ? 'ok' : 'ko'}" title="${esc(c.enemy.name)} · ${c.pickRate}% de pick">${img(c.enemy, 'm')}<div class="xs b ell">${esc(c.enemy.name)}</div><div class="xs ${c.covered ? 'good' : 'bad'} b">${c.best ? c.best.wr + '%' : '—'}</div></div>`).join('')}</div>`);

  const recs = p && p !== 'loading' && !p.error ? panel('Qué añadir a tu pool', 'star', p.recommendations.length ? `<div class="stack">${p.recommendations.map((r, i) => `<div class="rec ${i === 0 ? 'best' : ''}">
      <div class="row nw" style="gap:12px">${img(r.champ, 'l')}<div style="min-width:0;flex:1"><div class="row nw"><span class="pick-n">${esc(r.champ.name)}</span>${i === 0 ? '<span class="best-badge">Recomendado</span>' : ''}${tierB(r.tier)}</div>
        <div class="s muted">Tapa ${r.covers} de tus ${p.holes} matchups perdidos</div></div><div class="pick-p"><div class="v ${wrClass(r.winRate, 51, 49)}">${r.winRate}%</div><div class="d dim">en el parche</div></div></div>
      ${r.coversList?.length ? `<div class="row" style="margin-top:10px;gap:4px">${r.coversList.slice(0, 8).map((x) => `<span class="chip good" title="${x.wr}% contra ${esc(x.champ.name)}">${img(x.champ, 'xs')}${x.wr}%</span>`).join('')}</div>` : ''}
      <div class="reasons" style="border-top:0;padding-top:4px">${r.reasons.map((x) => `<div class="reason ${x.type === 'good' ? 'pos' : 'neg'}"><b>${icon(x.type === 'good' ? 'check' : 'info')}</b><span>${esc(x.text)}</span></div>`).join('')}</div>
    </div>`).join('')}</div>` : '<div class="muted">Tu pool ya cubre los matchups del meta.</div>', { cls: 'gold' }) : '';

  const notes = notesAll === null || notesAll === 'loading' ? '<div class="skel" style="height:200px"></div>'
    : panel('Tu libreta de matchups', 'book', notesAll.length ? `<div class="stack">${notesAll.map((n) => `<div class="nb-i"><div class="row nw" style="gap:8px">${n.meChamp ? img(n.meChamp, 's') + '<span class="dim s">vs</span>' : '<span class="tag">General</span><span class="dim s">vs</span>'}${img(n.vsChamp, 's')}<b>${esc(n.vsChamp?.name)}</b><span class="sp"></span><span class="xs dim">${timeAgo(n.updatedAt)}</span></div><div class="nb-t">${esc(n.text)}</div></div>`).join('')}</div>`
      : '<div class="muted">Aún no tienes notas. Escríbelas en la selección de campeón, en partida o en el análisis de una partida y aparecerán aquí.</div>', { right: notesAll.length ? `${notesAll.length} nota${notesAll.length === 1 ? '' : 's'}` : '' });

  return `<div class="grid g-2"><div class="col">${myPoolPanel()}${poolPanel}</div><div class="col">${recs}${notes}</div></div>`;
}
