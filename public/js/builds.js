'use strict';
/* LoL Coach — Builds (objetos por campeón) y tier list. */

// ---------- Builds: estadísticas de objetos por campeón (como DPM.LOL) ----------
let bq = (() => { try { return JSON.parse(localStorage.getItem('lolcoach.builds')) || {}; } catch { return {}; } })(); // { champ, pos, tier, region, mode }
let bData = null; // datos cargados | 'loading' | { error }
let bKey = '';
let bSetSize = 3;
let bSort = 'pickRate';
let bPicker = false;
let bSearch = '';

function bSave() {
  try { localStorage.setItem('lolcoach.builds', JSON.stringify(bq)); } catch { /* opcional */ }
}

async function loadBuilds() {
  if (!bq.champ) {
    // Por defecto, tu campeón más jugado
    const c = profileData?.champions?.[0]?.champ;
    if (!c) { if (!champList) loadChampList(); return; }
    bq.champ = c.key;
  }
  const key = JSON.stringify(bq);
  if (key === bKey && bData) return;
  bKey = key;
  bData = 'loading';
  render();
  try {
    const qs = new URLSearchParams(Object.entries(bq).filter(([, v]) => v != null && v !== ''));
    const d = await (await fetch(`/api/itemstats?${qs}`)).json();
    if (key !== bKey) return; // ha cambiado el filtro mientras cargaba
    bData = d.error ? { error: d.error } : d;
    if (!d.error) { bq.pos = d.pos || bq.pos; bKey = JSON.stringify(bq); bSave(); }
  } catch {
    bData = { error: 'No se pudieron cargar las estadísticas' };
  }
  render();
}

async function loadChampList() {
  if (champList) return;
  try {
    const c = await (await fetch('/api/champions')).json();
    if (!c.error) champList = c;
  } catch { /* se reintenta al volver */ }
  render();
}

function bSet(k, v) {
  bq[k] = v;
  if (k === 'champ') { bq.pos = null; bPicker = false; bSearch = ''; }
  if (k === 'mode' && v === 'aram') bq.pos = null;
  bSave();
  loadBuilds();
}

function bWr(x, games) {
  if (x == null) return '<span class="dim">—</span>';
  const low = games != null && games < 100;
  return `<span class="wr ${low ? 'dim' : wrClass(x, 51, 49)}" ${low ? 'title="Pocas partidas: dato poco fiable"' : ''}>${x.toFixed(1)}%</span>`;
}

/** Fila de objetos con winrate, pick rate y partidas. */
function bRow(r, { chain = false, size = 'm', best = false } = {}) {
  return `<div class="bs-row ${best ? 'best' : ''} ${r.games < 100 ? 'low' : ''}">
    <div class="bs-items">${r.items.map((i) => img(i, size)).join(chain ? `<span class="chev">${icon('chevron')}</span>` : '')}${r.items.length === 1 ? `<span class="bs-name ell">${esc(r.items[0].name)}</span>` : ''}</div>
    <div class="bs-n">${bWr(r.winRate, r.games)}</div>
    <div class="bs-n"><span class="pr">${r.pickRate.toFixed(1)}%</span><span class="bs-bar"><i style="width:${Math.min(100, r.pickRate)}%"></i></span></div>
    <div class="bs-n dim">${fmtNum(r.games)}</div>
  </div>`;
}

function bHead(cols = ['Objetos', 'Winrate', 'Pick rate', 'Partidas'], sortable = false) {
  const keys = [null, 'winRate', 'pickRate', 'games'];
  return `<div class="bs-row bs-h">${cols.map((c, i) => (sortable && keys[i]
    ? `<button class="${bSort === keys[i] ? 'on' : ''}" onclick="bSort='${keys[i]}';render()">${c}${bSort === keys[i] ? ' ▾' : ''}</button>`
    : `<span>${c}</span>`)).join('')}</div>`;
}

function champPicker() {
  const norm = (x) => String(x || '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const q = norm(bSearch);
  const list = (champList || []).filter((c) => !q || norm(c.name).includes(q)).slice(0, 60);
  return `<section class="panel"><div class="pb">
    <div class="searchbox sm">${icon('search')}<input id="b-q" class="inp" placeholder="Busca un campeón…" value="${esc(bSearch)}" oninput="bSearch=this.value;render()" onkeydown="if(event.key==='Enter'){const b=document.querySelector('.bp-grid .mp-s');if(b)b.click();}" autocomplete="off" spellcheck="false"></div>
    <div class="mp-grid bp-grid" style="margin-top:12px">${list.map((c) => `<button class="mp-s" onclick="bSet('champ',${c.key})">${img(c, 'm')}<span class="ell">${esc(c.name)}</span></button>`).join('') || (champList ? '<span class="s dim">Ningún campeón coincide.</span>' : '<div class="skel" style="height:120px"></div>')}</div>
  </div></section>`;
}

function viewBuildPage() {
  loadChampList();
  loadBuilds();
  const d = bData;
  if (!bq.champ && !d) return champPicker();
  if (bPicker) return champPicker();
  if (!d || d === 'loading') return '<div class="stack" style="gap:16px"><div class="skel" style="height:190px;border-radius:22px"></div><div class="skel" style="height:420px"></div></div>';
  if (d.error) return `<div class="note">${icon('alert')}<span>${esc(d.error)}</span></div>${champPicker()}`;

  const sm = d.summary;
  const filters = `<div class="b-filters">
    <span class="seg">${['ranked', 'aram'].map((m) => `<button class="${d.mode === m ? 'on' : ''}" onclick="bSet('mode','${m}')">${m === 'aram' ? 'ARAM' : 'Ranked'}</button>`).join('')}</span>
    ${d.mode === 'ranked' && d.positions.length ? `<span class="seg">${d.positions.map((p) => `<button class="${p.pos === d.pos ? 'on' : ''}" onclick="bSet('pos','${p.pos}')" title="${p.roleRate}% de sus partidas">${posIcon(p.pos)} ${esc(p.label)}</button>`).join('')}</span>` : ''}
    ${d.mode === 'ranked' ? `<select class="inp sel" onchange="bSet('tier',this.value)">${Object.entries(d.tiers).map(([k, v]) => `<option value="${k}" ${k === d.tier ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
    <select class="inp sel" onchange="bSet('region',this.value)">${Object.entries(d.regions).map(([k, v]) => `<option value="${k}" ${k === d.region ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
  </div>`;

  const hero = `<section class="phero b-hero"><div class="art" style="background-image:url('${esc(d.champ.splash)}')"></div>
    <div class="phero-in">
      <div style="min-width:0">
        <div class="row nw" style="gap:16px">${img(d.champ, 'xl')}
          <div style="min-width:0"><div class="ph-name ell">${esc(d.champ.name)}</div>
            <div class="row" style="margin-top:8px"><span class="chip">${d.pos ? posIcon(d.pos) : ''}<b>${esc(d.posLabel)}</b></span>${d.mode === 'ranked' ? `<span class="chip">${esc(d.tierLabel)}</span>` : ''}<span class="chip">${esc(d.regions[d.region])}</span>
              <button class="chip" onclick="bPicker=true;render();setTimeout(()=>document.getElementById('b-q')?.focus(),50)">${icon('swap')}Cambiar campeón</button></div></div></div>
        ${filters}
      </div>
      ${sm ? `<div class="b-kpis">
        ${sm.tier ? `<div class="kv2"><div class="v">${tierB(sm.tier)}</div><div class="k">${sm.rank ? '#' + sm.rank : 'Tier'}</div></div>` : ''}
        <div class="kv2"><div class="v ${wrClass(sm.winRate, 50.5, 49.5)}">${sm.winRate}%</div><div class="k">Winrate</div></div>
        <div class="kv2"><div class="v">${sm.pickRate}%</div><div class="k">Pick rate</div></div>
        ${sm.banRate != null ? `<div class="kv2"><div class="v">${sm.banRate}%</div><div class="k">Ban rate</div></div>` : ''}
        <div class="kv2"><div class="v">${fmtNum(sm.games)}</div><div class="k">Partidas</div></div>
      </div>` : ''}
    </div></section>`;

  // Item sets (combinaciones de N objetos), ordenables
  const sizes = Object.keys(d.sets).map(Number).sort((a, b) => a - b);
  if (sizes.length && !sizes.includes(bSetSize)) bSetSize = sizes.includes(3) ? 3 : sizes[0];
  const setList = [...(d.sets[bSetSize] || d.fallbackCore || [])].sort((a, b) => b[bSort] - a[bSort]);
  const bestWr = Math.max(...setList.filter((r) => r.games >= 300).map((r) => r.winRate), 0);
  const sets = panel('Item sets', 'layers', `
    ${setList.length ? `${bHead(['Objetos', 'Winrate', 'Pick rate', 'Partidas'], true)}${setList.map((r) => bRow(r, { chain: true, best: r.winRate === bestWr && r.games >= 300 })).join('')}` : '<div class="s dim">Sin datos.</div>'}`,
    { cls: 'gold', right: sizes.length ? `<span class="seg">${sizes.map((n) => `<button class="${n === bSetSize ? 'on' : ''}" onclick="bSetSize=${n};render()">${n} objetos</button>`).join('')}</span>` : '' });

  // Objeto en cada posición de la build
  const ord = ['1.er', '2.º', '3.er', '4.º', '5.º', '6.º'];
  const slots = `<div class="b-slots">${d.slots.map((list, i) => (list.length ? `<section class="panel b-slot"><header class="ph"><span class="ph-t">${ord[i]} objeto</span></header><div class="pb">
      ${bHead(['', 'WR', 'PR', 'Partidas'])}${list.slice(0, 8).map((r) => bRow(r, { size: 's' })).join('')}</div></section>` : '')).join('')}</div>`;

  const small = (title, ic, list, chain = false) => (list?.length ? panel(title, ic, `${bHead()}${list.slice(0, 6).map((r) => bRow(r, { chain, size: 's' })).join('')}`) : '');

  return `<div class="stack" style="gap:16px">${hero}
    <div class="grid g-builds"><div class="col">${sets}</div><div class="col">${small('Botas', 'zap', d.boots)}${small('Objetos iniciales', 'cart', d.starters)}${small('Hechizos de invocador', 'sparkles', d.spells)}</div></div>
    ${slots}
    <div class="xs dim">Datos de OP.GG (${esc(d.regions[d.region])}${d.mode === 'ranked' ? ', ' + esc(d.tierLabel) : ', ARAM'}), parche actual. En gris, combinaciones con menos de 100 partidas.</div>
  </div>`;
}

// ---------- Tier list (pestaña de Builds) ----------
let bTab = (() => { try { return localStorage.getItem('lolcoach.buildsTab') || 'tierlist'; } catch { return 'tierlist'; } })();
let tlq = { pos: 'ALL', tier: null, region: null, mode: 'ranked', search: '', sort: 'tier', dir: 1 };
let tlData = null;
let tlKey = '';

function setBTab(t) {
  bTab = t;
  try { localStorage.setItem('lolcoach.buildsTab', t); } catch { /* opcional */ }
  render();
}

async function loadTierList() {
  const key = JSON.stringify([tlq.tier, tlq.region, tlq.mode]);
  if (key === tlKey && tlData) return;
  tlKey = key;
  tlData = 'loading';
  render();
  try {
    const qs = new URLSearchParams(Object.entries({ tier: tlq.tier, region: tlq.region, mode: tlq.mode }).filter(([, v]) => v));
    const d = await (await fetch(`/api/tierlist?${qs}`)).json();
    if (key !== tlKey) return;
    tlData = d.error ? { error: d.error } : d;
    if (!d.error) { tlq.tier = d.tier; tlq.region = d.region; tlKey = JSON.stringify([tlq.tier, tlq.region, tlq.mode]); }
  } catch {
    tlData = { error: 'No se pudo cargar la tier list' };
  }
  render();
}

function tlSet(k, v) {
  tlq[k] = v;
  if (k === 'mode') tlq.pos = 'ALL';
  if (['tier', 'region', 'mode'].includes(k)) loadTierList();
  else render();
}

function tlSort(k) {
  if (tlq.sort === k) tlq.dir = -tlq.dir;
  else { tlq.sort = k; tlq.dir = k === 'tier' ? 1 : -1; }
  render();
}

/** Abre la build de un campeón desde la tier list. */
function openBuild(champKey, pos) {
  bq = { ...bq, champ: champKey, pos: pos || null, mode: tlq.mode, tier: tlq.mode === 'aram' ? bq.tier : tlq.tier, region: tlq.region };
  bSave();
  bPicker = false;
  setBTab('build');
  loadBuilds();
  window.scrollTo({ top: 0 });
}

function viewTierList() {
  loadTierList();
  const d = tlData;
  if (!d || d === 'loading') return '<div class="skel" style="height:520px"></div>';
  if (d.error) return `<div class="note">${icon('alert')}<span>${esc(d.error)}</span></div>`;
  const norm = (x) => String(x || '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const q = norm(tlq.search);
  let rows = d.rows.filter((r) => (tlq.pos === 'ALL' || r.pos === tlq.pos) && (!q || norm(r.champ.name).includes(q)));
  const val = (r) => (tlq.sort === 'tier' ? (r.tier ?? 9) * 1000 + (r.rank ?? 999) : r[tlq.sort] ?? -1);
  // dir 1 = ascendente (en Tier, el mejor primero); -1 = descendente (por defecto en las columnas de %)
  rows = [...rows].sort((a, b) => (val(a) - val(b)) * tlq.dir);

  // Resumen rápido del rol elegido: más baneados y mejor winrate (con un mínimo de pick rate)
  const scope = d.rows.filter((r) => tlq.pos === 'ALL' || r.pos === tlq.pos);
  const topBan = [...scope].filter((r) => r.banRate != null).sort((a, b) => b.banRate - a.banRate).filter((r, i, arr) => arr.findIndex((x) => x.champ.key === r.champ.key) === i).slice(0, 5);
  const topWr = [...scope].filter((r) => r.pickRate >= 1).sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  const mini = (title, list, k, cls) => `<section class="panel tli-mini"><div class="pb"><div class="lbl" style="margin-bottom:8px">${title}</div>
    <div class="tli-mini-l">${list.map((r) => `<button onclick="openBuild(${r.champ.key}, ${r.pos ? `'${r.pos}'` : 'null'})" title="${esc(r.champ.name)}">${img(r.champ, 'm')}<b class="${cls}">${r[k]}%</b></button>`).join('')}</div></div></section>`;

  const roles = [['ALL', 'Todos'], ['TOP', 'Top'], ['JUNGLE', 'Jungla'], ['MIDDLE', 'Mid'], ['BOTTOM', 'ADC'], ['UTILITY', 'Support']];
  const th = (k, l) => `<button class="${tlq.sort === k ? 'on' : ''}" onclick="tlSort('${k}')">${l}${tlq.sort === k ? (tlq.dir === 1 ? ' ▴' : ' ▾') : ''}</button>`;
  return `<div class="stack" style="gap:16px">
    <section class="panel"><div class="pb b-filters" style="margin:0">
      <span class="seg">${['ranked', 'aram'].map((m) => `<button class="${d.mode === m ? 'on' : ''}" onclick="tlSet('mode','${m}')">${m === 'aram' ? 'ARAM' : 'Ranked'}</button>`).join('')}</span>
      ${d.mode === 'ranked' ? `<span class="seg">${roles.map(([k, l]) => `<button class="${tlq.pos === k ? 'on' : ''}" onclick="tlSet('pos','${k}')">${k !== 'ALL' ? posIcon(k) : ''} ${l}</button>`).join('')}</span>
      <select class="inp sel" onchange="tlSet('tier',this.value)">${Object.entries(d.tiers).map(([k, v]) => `<option value="${k}" ${k === d.tier ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
      <select class="inp sel" onchange="tlSet('region',this.value)">${Object.entries(d.regions).map(([k, v]) => `<option value="${k}" ${k === d.region ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <span class="sp"></span>
      <div class="searchbox sm" style="min-width:220px">${icon('search')}<input class="inp" placeholder="Buscar campeón…" value="${esc(tlq.search)}" oninput="tlSet('search', this.value)" autocomplete="off" spellcheck="false"></div>
    </div></section>
    <div class="grid g-2">${mini('Los más baneados', topBan, 'banRate', '')}${mini('Mejor winrate (pick rate ≥ 1%)', topWr, 'winRate', 'good')}</div>
    <section class="panel"><div class="pb">
      <div class="tli-row tli-h"><span>#</span><span>Campeón</span>${th('tier', 'Tier')}${th('winRate', 'Winrate')}${th('pickRate', 'Pick rate')}${th('banRate', 'Ban rate')}${th('games', 'Partidas')}</div>
      ${rows.map((r, i) => `<button class="tli-row" onclick="openBuild(${r.champ.key}, ${r.pos ? `'${r.pos}'` : 'null'})">
        <span class="dim num">${i + 1}</span>
        <span class="tli-c">${img(r.champ, 's')}<b class="ell">${esc(r.champ.name)}</b>${r.pos && tlq.pos === 'ALL' ? posIcon(r.pos) : ''}${r.pos && r.roleRate < 30 ? `<span class="xs dim">${r.roleRate}%</span>` : ''}</span>
        <span>${r.tier === 0 ? '<span class="tier t0" title="OP: lo más fuerte del parche">OP</span>' : tierB(r.tier) || '<span class="dim">—</span>'}</span>
        <span class="wr ${wrClass(r.winRate, 51, 49)}">${r.winRate ?? '—'}%</span>
        <span>${r.pickRate ?? '—'}%</span>
        <span>${r.banRate != null ? r.banRate + '%' : '—'}</span>
        <span class="dim">${fmtNum(r.games)}</span>
      </button>`).join('') || '<div class="s dim" style="padding:12px">Ningún campeón coincide.</div>'}
      <div class="xs dim" style="margin-top:10px">Datos de OP.GG (${esc(d.regions[d.region])}${d.mode === 'ranked' ? ', ' + esc(d.tierLabel) : ', ARAM'}). Pulsa un campeón para ver su build. El % pequeño junto al rol es cuántas de sus partidas juega ahí.</div>
    </div></section>
  </div>`;
}

function viewBuilds() {
  const tabs = `<div class="row" style="margin-bottom:16px"><span class="seg b-tabs">
    <button class="${bTab === 'tierlist' ? 'on' : ''}" onclick="setBTab('tierlist')">${icon('chart')} Tier list</button>
    <button class="${bTab === 'build' ? 'on' : ''}" onclick="setBTab('build')">${icon('layers')} Build de campeón${bData?.champ ? ': ' + esc(bData.champ.name) : ''}</button>
  </span></div>`;
  return tabs + (bTab === 'tierlist' ? viewTierList() : viewBuildPage());
}
