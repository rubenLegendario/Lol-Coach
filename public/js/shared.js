'use strict';
/* LoL Coach — Bloques que usan varias pantallas: composición, habilidades, runas, build, notas, cronología, mapa de muertes. */

// ---------- bloques compartidos ----------
function compBar(c, title) {
  if (!c) return '';
  const tanks = typeof c.tanks === 'number' ? c.tanks : c.tanks?.length || 0;
  return `${lbl(title)}
    <div class="bar"><div class="ap" style="width:${c.ap}%"></div><div class="ad" style="width:${c.ad}%"></div></div>
    <div class="legend"><span class="ap">AP ${c.ap}%</span><span class="ad">AD ${c.ad}%</span></div>
    <div class="comp">
      <div>${icon('shield')}${tanks} ${tanks === 1 ? 'tanque' : 'tanques'}</div>
      ${c.healers?.length ? `<div>${icon('heart')}Curación: ${esc(c.healers.join(', '))}</div>` : ''}
      ${c.highCc ? `<div>${icon('link')}${c.highCc} con mucho control de masas</div>` : ''}
    </div>`;
}

function skillGrid(order, current) {
  if (!order?.length) return '<div class="s dim">Sin datos</div>';
  let html = '<div class="skills">';
  for (const k of ['Q', 'W', 'E', 'R']) {
    html += `<div class="k">${k}</div>`;
    for (let i = 0; i < 18; i++) {
      const on = i < order.length && order[i] === k;
      html += `<div class="${on ? 'on' : ''} ${on && k === 'R' ? 'r' : ''} ${current && i === current - 1 && on ? 'cur' : ''}">${on ? i + 1 : ''}</div>`;
    }
  }
  return html + '</div>';
}

function runesBlock(r) {
  if (!r) return '<div class="s dim">Sin datos</div>';
  const ri = (x, cls = '') => (x?.icon ? `<img class="${cls}" src="${esc(x.icon)}" alt="${esc(x.name)}" title="${esc(x.name)}">` : '');
  return `<div class="runes"><div class="keystone">${ri(r.primary[0])}</div>
      <div style="min-width:0"><div class="b">${esc(r.primary[0]?.name)}</div><div class="s dim">${wr(r.winRate)} · ${r.games?.toLocaleString('es') ?? '—'} partidas</div></div>
    </div>
    <div class="rrow" style="margin-top:10px">${ri(r.primaryStyle, 'st')}${r.primary.slice(1).map((x) => ri(x)).join('')}<span class="rsep"></span>${ri(r.subStyle, 'st')}${r.secondary.map((x) => ri(x)).join('')}</div>
    <div class="shards">${r.shards.map((s) => `<span class="tag">${esc(s.name)}</span>`).join('')}</div>`;
}

function scoutLine(s, side = 'ally', maxTags = 3) {
  if (!s) return '<div class="skel" style="height:12px;width:60%;margin-top:6px;border-radius:4px"></div>';
  return `<div class="s muted"><b style="color:var(--text)">${esc(s.rank.text)}</b>${s.rank.winRate != null ? ` · ${(s.rank.winRate * 100).toFixed(0)}%` : ''}</div>
    ${s.tags.length ? `<div class="tags" style="margin-top:5px">${s.tags.slice(0, maxTags).map((t) => tag(t, side)).join('')}</div>` : ''}
    <div class="form-dots">${s.recent.map((g) => `<span class="${g.win ? 'w' : ''}"></span>`).join('')}</div>`;
}

/** Medidor circular de probabilidad: azul = tu equipo, rojo = rival. */
function winRing(p, size = 150, label = 'Victoria') {
  return ring(size, 12, [{ v: p, color: 'var(--ally)' }, { v: 100 - p, color: 'var(--enemy)' }],
    `<div class="dsp ${wrClass(p, 52, 48)}" style="font-size:${Math.round(size / 3.6)}px">${p.toFixed(1)}%</div><div class="xs dim b" style="letter-spacing:.12em;text-transform:uppercase;margin-top:4px">${label}</div>`);
}

function whyPanel(d, title = 'Por qué esta predicción') {
  if (!d) return '';
  const pos = d.factors.filter((f) => f.value >= 0);
  const neg = d.factors.filter((f) => f.value < 0);
  return panel(title, 'scale', `
    ${d.factors.length ? `${lbl('<span class="good">A tu favor</span>')}${pos.map(factorRow).join('') || '<div class="s dim">—</div>'}
      ${lbl('<span class="bad">En tu contra</span>')}${neg.map(factorRow).join('') || '<div class="s dim">—</div>'}` : '<div class="s dim">Aún no hay suficientes campeones elegidos.</div>'}
    ${d.scaling ? `<div class="advice" style="margin-top:14px">${icon('up')}<span>${esc(d.scaling)}</span></div>` : ''}`, { cls: 'gold' });
}

function buildPanel(b, { actions = false } = {}) {
  if (!b) {
    return `<section class="panel">${`<div class="empty" style="padding:60px 20px"><div class="eic">${icon('layers')}</div><h2>Elige un campeón</h2><p>Pasa el ratón por un campeón o bloquéalo y aquí aparecerá su build completa.</p></div>`}</section>`;
  }
  const r = b.runes[runeTab] || b.runes[0];
  const mu = b.matchup;
  return `<section class="panel gold">
    <div class="bhero"><div class="art" style="background-image:url('${esc(b.champ?.splash || '')}')"></div>
      <div class="row nw" style="gap:16px;align-items:flex-end">${img(b.champ, 'xl')}
        <div style="min-width:0">
          <div class="row nw">${posIcon(b.pos)}<span class="s muted">${POS[b.pos] || 'ARAM'}</span>${tierB(b.tier)}</div>
          <div class="bh-name">${esc(b.champ?.name)}</div>
        </div>
      </div>
      <div class="bh-stats">
        <div class="bh-stat"><div class="v ${wrClass(b.winRate, 51, 49)}">${b.winRate ?? '—'}%</div><div class="k">Winrate</div></div>
        ${b.pickRate != null ? `<div class="bh-stat"><div class="v">${b.pickRate}%</div><div class="k">Pick</div></div>` : ''}
        ${b.banRate != null ? `<div class="bh-stat"><div class="v">${b.banRate}%</div><div class="k">Ban</div></div>` : ''}
        <div class="bh-stat"><div class="v">${fmtNum(b.games || 0)}</div><div class="k">Partidas</div></div>
      </div>
      ${mu?.vs ? `<div class="mu">${img(mu.vs, 's')}<span>vs <b>${esc(mu.vs.name)}</b></span>${wr(mu.winRate)}<span class="dim">${fmtNum(mu.games)} partidas${mu.specific ? ' · build del matchup' : ''}</span></div>` : ''}
      ${actions ? `<div class="actions">
        <button class="btn" onclick="apply('runes',{index:${runeTab}})">${icon('rune')}Aplicar runas</button>
        <button class="btn ghost" onclick="apply('spells')">${icon('sparkles')}Hechizos</button>
        <button class="btn ghost" onclick="apply('itemset')">${icon('cart')}Set de objetos</button>
      </div>` : ''}
    </div>
    <div class="bbody">
      <div>
        ${lbl('Runas', b.runes.length > 1 ? `<span class="seg">${b.runes.map((x, i) => `<button class="${i === runeTab ? 'on' : ''}" onclick="runeTab=${i};render()">${esc(x.primary[0]?.name)}</button>`).join('')}</span>` : '')}
        ${runesBlock(r)}
        ${lbl('Hechizos')}
        <div class="stack">${b.spells.map((s) => `<div class="kv-line">${s.spells.map((x) => img(x, 's')).join('')}<span class="s">${wr(s.winRate)} <span class="dim">${s.pickRate}%</span></span></div>`).join('')}</div>
        ${lbl('Inicio y botas')}
        <div class="row">${b.starter.slice(0, 1).map((s) => s.items.map((x) => img(x, 's')).join('')).join('')}<span class="rsep"></span>${b.boots.slice(0, 2).map((x) => `${img(x.item, 's')}<span class="xs dim">${x.pickRate}%</span>`).join('')}</div>
      </div>
      <div>
        ${b.builds?.length ? `${lbl('Builds')}${b.builds.map((x, i) => `<div class="bopt ${i === 0 ? 'first' : ''}">
          <div class="row nw"><span class="bopt-n ell">${icon(x.icon)}<span class="ell">${esc(x.name)}</span></span><span class="sp"></span>${i === 0 ? '<span class="tag gold">Recomendada</span>' : ''}<span class="s">${wr(x.winRate)}</span></div>
          <div class="path">${x.items.map((it) => img(it, i ? 's' : 'm')).join(chev)}</div>
          ${x.tags.filter((t) => t !== 'La más jugada').length ? `<div class="tags">${x.tags.filter((t) => t !== 'La más jugada').map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>`).join('')}` : ''}
        ${b.situational.length ? `${lbl('Para el final')}<div class="items">${b.situational.map((x) => img(x, 's')).join('')}</div>` : ''}
      </div>
    </div>
    <div style="padding:0 18px 18px;border-top:1px solid var(--line)">
      ${lbl('Habilidades', b.skills.max?.length ? `Maximiza <b class="goldc">${b.skills.max.join(' › ')}</b>` : '')}
      ${skillGrid(b.skills.order)}
    </div>
  </section>`;
}

// ---------- Notas de matchup ----------
const saveTimers = {};
function saveNote(me, vs, el) {
  const key = `${me}:${vs}`;
  clearTimeout(saveTimers[key]);
  const status = el.closest('.note-box')?.querySelector('.note-status');
  if (status) status.textContent = 'Guardando…';
  saveTimers[key] = setTimeout(async () => {
    try {
      await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ me, vs, text: el.value }) });
      const c = notesCache.get(key);
      if (c) c[me ? 'matchup' : 'general'] = el.value.trim() ? { text: el.value, updatedAt: Date.now() } : null;
      notesAll = null;
      if (status) status.textContent = 'Guardado';
    } catch {
      if (status) status.textContent = 'No se pudo guardar';
    }
  }, 600);
}

async function loadNotes(me, vs) {
  const key = `${me}:${vs}`;
  if (notesCache.has(key)) return;
  notesCache.set(key, null);
  try {
    notesCache.set(key, await (await fetch(`/api/notes?me=${me}&vs=${vs}`)).json());
  } catch { /* opcional */ }
  render();
}

/** Libreta del matchup: tu nota "campeón vs campeón", tu nota general contra él y tu récord. */
function notesPanel(n, { title } = {}) {
  if (!n?.vs) return '';
  const me = n.me?.key || 0;
  const vs = n.vs.key;
  const h = n.history;
  const rec = h?.withChamp?.games ? h.withChamp : h?.any;
  return panel(title || `Tus notas vs ${esc(n.vs.name)}`, 'book', `
    ${rec?.games ? `<div class="row" style="gap:16px;margin-bottom:12px">
      <div class="kv2"><div class="v ${rec.wins / rec.games >= 0.5 ? 'good' : 'bad'}">${rec.wins}-${rec.games - rec.wins}</div><div class="k">Tu récord${h.withChamp.games ? ' con ' + esc(n.me?.name || '') : ''}</div></div>
      ${rec.avgGold14 != null ? `<div class="kv2"><div class="v ${rec.avgGold14 >= 0 ? 'good' : 'bad'}">${rec.avgGold14 >= 0 ? '+' : ''}${rec.avgGold14}</div><div class="k">Oro al 14' de media</div></div>` : ''}
    </div>` : '<div class="s dim" style="margin-bottom:10px">Aún no hay partidas analizadas contra él: se irán guardando solas.</div>'}
    ${me ? `<div class="note-box">
      <div class="lbl-row" style="margin-top:0"><span class="lbl">${esc(n.me?.name)} vs ${esc(n.vs.name)}</span><span class="lbl-r note-status"></span></div>
      <textarea class="note-ta" placeholder="Qué funciona y qué no en este matchup…" oninput="saveNote(${me}, ${vs}, this)">${esc(n.matchup?.text || '')}</textarea>
    </div>` : ''}
    <div class="note-box">
      <div class="lbl-row"><span class="lbl">Contra ${esc(n.vs.name)} en general</span><span class="lbl-r note-status"></span></div>
      <textarea class="note-ta s" placeholder="Habilidades clave, cuándo es fuerte, qué evitar…" oninput="saveNote(0, ${vs}, this)">${esc(n.general?.text || '')}</textarea>
    </div>`, { right: '<span class="tag gold">Se guarda sola</span>' });
}

// ---------- Cronología de la partida ----------
const MOMENT_ICON = { kill: 'sword', death: 'skull', assist: 'users', firstblood: 'flame', dragon: 'flame', elder: 'flame', baron: 'crown', herald: 'zap', grubs: 'zap', tower: 'shield', inhib: 'shield' };

function timelineBar(moments, duration) {
  const major = moments.filter((m) => !m.minor);
  const total = Math.max(1, duration * 60);
  return `<div class="tl">
    <div class="tl-row ally">${major.filter((m) => m.team === 'ally').map((m) => `<span class="tl-ev ${m.type}" style="left:${((m.t / total) * 100).toFixed(1)}%" title="${Math.floor(m.t / 60)}' · ${esc(m.label)}">${icon(MOMENT_ICON[m.type] || 'info')}</span>`).join('')}</div>
    <div class="tl-axis">${Array.from({ length: Math.floor(duration / 5) + 1 }, (_, i) => `<span style="left:${((i * 300) / total) * 100}%">${i * 5}'</span>`).join('')}</div>
    <div class="tl-row enemy">${major.filter((m) => m.team === 'enemy').map((m) => `<span class="tl-ev ${m.type}" style="left:${((m.t / total) * 100).toFixed(1)}%" title="${Math.floor(m.t / 60)}' · ${esc(m.label)}">${icon(MOMENT_ICON[m.type] || 'info')}</span>`).join('')}</div>
  </div>
  <div class="legend-i"><span class="allyc">▲ Tu equipo</span><span class="enemyc">▼ Rival</span><span class="dim">Pasa el ratón por un icono para ver qué pasó</span></div>`;
}

function momentsList(moments) {
  const major = moments.filter((m) => !m.minor && m.type !== 'assist');
  return `<div class="moments">${major.map((m) => `<div class="moment ${m.team}"><span class="m-t">${Math.floor(m.t / 60)}'</span><span class="m-ic ${m.type}">${icon(MOMENT_ICON[m.type] || 'info')}</span><span class="ell">${esc(m.label)}</span>${m.champ ? img(m.champ, 'xs') : ''}</div>`).join('')}</div>`;
}

// ---------- Mapa de muertes ----------
function mapImg() {
  return `https://ddragon.leagueoflegends.com/cdn/${state?.patch || '16.19.1'}/img/map/map11.png`;
}

/** Minimapa con un punto por muerte. numbered: numera los puntos por orden (una sola partida). */
function deathMap(points, { numbered = false } = {}) {
  return `<div class="dmap"><img src="${mapImg()}" alt="Minimapa de la Grieta" loading="lazy">
    ${points.map((p, i) => `<span class="dpt ${p.gank ? 'gank' : p.early ? 'early' : ''}" style="left:${p.left.toFixed(1)}%;top:${p.top.toFixed(1)}%" title="${esc(p.title || p.zone || '')}">${numbered ? i + 1 : ''}</span>`).join('')}
  </div>`;
}

function zoneBars(zones) {
  return zones.slice(0, 5).map((z, i) => `<div class="zrow"><span class="ell">${esc(z.zone)}</span><div class="bar"><div class="${i === 0 ? 'wn' : 'gl'}" style="width:${z.pct}%"></div></div><span class="s b">${z.pct}%</span></div>`).join('');
}

function zoneTip(zone) {
  if (zone.startsWith('Río')) return 'Es donde llegan los ganks y las peleas por objetivos: entra con visión y nunca el primero.';
  if (zone === 'Jungla enemiga' || zone === 'Base enemiga') return 'Te metes demasiado: solo entra si sabes dónde están su jungla y su support.';
  if (zone.startsWith('Línea')) return 'Revisa cuándo te sobreextiendes: mira el minimapa antes de empujar más allá del río.';
  if (zone === 'Tu jungla') return 'Te pillan en tu propia jungla: wardea las entradas antes de farmear allí.';
  return '';
}

function deathMapPanel(dm) {
  if (!dm?.total) return '';
  const top = dm.zones[0];
  return panel('Dónde mueres', 'skull', `<div class="dm-grid">
      ${deathMap(dm.points)}
      <div style="min-width:0">
        <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="kpi"><div class="k">Muertes</div><div class="v">${dm.total}</div><div class="s">${(dm.total / Math.max(1, dm.games)).toFixed(1)} por partida</div></div>
          <div class="kpi"><div class="k">Antes del 14'</div><div class="v">${Math.round((dm.early / dm.total) * 100)}%</div><div class="s">${dm.early} muertes</div></div>
          <div class="kpi"><div class="k">Por ganks</div><div class="v">${dm.ganks}</div><div class="s">del jungla rival</div></div>
        </div>
        ${lbl('Zonas')}${zoneBars(dm.zones)}
        ${top ? `<div class="advice" style="margin-top:12px">${icon('bulb')}<span>El ${top.pct}% de tus muertes son en <b>${esc(top.zone.toLowerCase())}</b>. ${zoneTip(top.zone)}</span></div>` : ''}
      </div>
    </div>
    <div class="legend-i"><span><i style="background:var(--enemy)"></i>Gank</span><span><i style="background:var(--ally)"></i>Antes del minuto 14</span><span><i style="background:var(--gold-2)"></i>Resto</span><span class="dim">Últimas ${dm.games} partidas</span></div>`);
}
