'use strict';
/* LoL Coach — Inicio: cabecera con rango y forma, bloque "ahora" (sesión, objetivo y LP), rendimiento y coach,
 * partidas recientes y, al final, los detalles en pestañas (LP, evolución, previsión, campeones, muertes).
 * Algunas piezas (sesión, LP, evolución, previsión, filtros, fila de partida) también las usa el buscador. */

// ---------- Objetivo de LP ----------
const GOAL_TIERS = [['IRON', 'Hierro'], ['BRONZE', 'Bronce'], ['SILVER', 'Plata'], ['GOLD', 'Oro'], ['PLATINUM', 'Platino'], ['EMERALD', 'Esmeralda'], ['DIAMOND', 'Diamante'], ['MASTER', 'Maestro']];

async function saveGoal(clear = false) {
  const body = clear ? {} : {
    tier: document.getElementById('goal-tier').value,
    division: document.getElementById('goal-div').value,
    queue: lpQueue,
    deadline: document.getElementById('goal-date').value ? new Date(document.getElementById('goal-date').value + 'T23:59:00').getTime() : null,
  };
  try {
    await fetch('/api/goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast(clear ? 'Objetivo eliminado' : 'Objetivo guardado');
  } catch {
    toast('No se pudo guardar el objetivo', true);
  }
  loadProfile(true);
}

const GOAL_DIVS = ['IV', 'III', 'II', 'I'];
const fmtDay = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
const fmtDec = (v) => Number(v).toLocaleString('es', { maximumFractionDigits: 1 });
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);

/** Nombre de la división que empieza en esos LP absolutos (igual que divisionLabel en el servidor). */
function absDivLabel(abs) {
  if (abs >= 2800) return 'Maestro+';
  return `${GOAL_TIERS[Math.floor(abs / 400)]?.[1] || ''} ${GOAL_DIVS[Math.floor((abs % 400) / 100)]}`;
}
const absLpText = (abs) => (abs >= 2800 ? `Maestro+ ${abs - 2800} LP` : `${absDivLabel(abs)} ${abs % 100} LP`);

/** summary = false: sin barra ni cifras (en el inicio ya están en la tarjeta «Objetivo de rango»). */
function goalBlock(goal, q, { summary = true } = {}) {
  if (goal && !goal.noData) {
    const m = goal.model;
    const odds = on('home.goalOdds');
    const plan = on('home.goalPlan');
    const head = `<div class="row nw"><span class="lbl">Objetivo</span><span class="goal-t">${esc(goal.label)}</span>
        ${goal.deadline ? `<span class="chip">${icon('clock')}Hasta el ${esc(fmtDay(goal.deadline))}${goal.daysLeft != null ? ` · ${goal.daysLeft} día${goal.daysLeft === 1 ? '' : 's'}` : ''}</span>` : ''}
        <span class="sp"></span><button class="btn ghost sm" onclick="saveGoal(true)">Quitar</button></div>`;
    if (goal.done) return `<div class="goal">${head}<div class="advice" style="margin-top:10px">${icon('star')}<span><b>¡Objetivo conseguido!</b> Ponte uno nuevo.</span></div></div>`;

    const g = goal.games;
    const kpis = [
      `<div class="kpi"><div class="k">Te faltan</div><div class="v">${goal.need}<span class="s dim"> LP</span></div><div class="s">${goal.netWins} victorias netas (${sign(m.lpWin)} / ${sign(m.lpLoss)} LP)</div></div>`,
    ];
    if (odds) {
      kpis.push(`<div class="kpi"><div class="k">Partidas <span class="est">estim.</span></div><div class="v">${g ? `~${g.p50}` : '—'}</div><div class="s">${g ? `${g.p80 ? `entre ${g.p20} y ${g.p80}` : `${g.p20} o más · llegas en el ${goal.reachProb}% de casos`}` : `solo llegas en el ${goal.reachProb}% de casos`}</div></div>`);
      if (goal.deadline) {
        const p = goal.onTimeProb;
        kpis.push(`<div class="kpi"><div class="k">Llegar a tiempo <span class="est">estim.</span></div><div class="v ${p == null ? '' : p >= 60 ? 'good' : p >= 30 ? 'warn' : 'bad'}">${p == null ? '—' : p + '%'}</div><div class="s">${m.pace ? `a tu ritmo: ~${goal.gamesAvail} partidas` : 'sin ritmo reciente'}</div></div>`);
      } else {
        kpis.push(`<div class="kpi"><div class="k">Fecha probable <span class="est">estim.</span></div><div class="v" style="font-size:22px">${goal.eta?.p50 ? esc(fmtDay(goal.eta.p50)) : '—'}</div><div class="s">${goal.eta?.p50 ? `a ${fmtDec(m.pace)} partidas al día` : m.pace ? 'no llegas a este ritmo' : 'sin ritmo reciente'}</div></div>`);
      }
    }
    if (plan && goal.plan) {
      const d = goal.plan.diff;
      kpis.push(`<div class="kpi"><div class="k">Frente al plan</div><div class="v ${d >= 0 ? 'good' : 'bad'}">${sign(d)}<span class="s dim"> LP</span></div><div class="s">${d >= 0 ? 'por delante' : 'por detrás'} · plan hoy: ${esc(absLpText(goal.plan.now))}</div></div>`);
    } else {
      kpis.push(`<div class="kpi"><div class="k">Progreso</div><div class="v">${goal.progress}%</div><div class="s">desde que te lo pusiste</div></div>`);
    }

    const tips = [];
    if (plan && goal.plan) {
      const ms = goal.plan.milestone;
      const day = new Date(ms.t).toLocaleDateString('es', { weekday: 'long', day: 'numeric' }).replace(',', '');
      tips.push(`<div class="hm-tip ms">${icon('flag')}<span><b>Hito de esta semana:</b> ${esc(absLpText(ms.abs))} antes del ${esc(day)}${ms.need ? ` (te faltan ${ms.need} LP, ${Math.ceil(ms.need / m.lpWin) === 1 ? 'una victoria neta' : 'unas ' + Math.ceil(ms.need / m.lpWin) + ' victorias netas'})` : '. Ya lo tienes, sigue así'}.</span></div>`);
    }
    if (odds && !g) {
      tips.push(`<div class="hm-tip warn">${icon('alert')}<span>Con tu nivel de victorias actual (${fmtDec(m.winRate)}%) no subes de forma fiable: con ${sign(m.lpWin)} / ${sign(m.lpLoss)} LP necesitas ganar más del ${goal.breakEven}% de tus partidas.</span></div>`);
    } else if (odds && goal.deadline && goal.onTimeProb != null && goal.onTimeProb < 80) {
      tips.push(`<div class="hm-tip warn">${icon('target')}<span>${goal.perDayFor80
        ? `Para tener un 80% de llegar a tiempo tendrías que jugar unas <b>${fmtDec(goal.perDayFor80)} partidas al día</b> (ahora juegas ${fmtDec(m.pace ?? 0)}).`
        : `Jugar más no basta para asegurarlo: tu winrate (${fmtDec(m.winRate)}%) está muy cerca del ${goal.breakEven}% con el que te quedas igual. Lo que más te acerca es ganar un poco más, no jugar más partidas.`}</span></div>`);
    }

    const foot = odds ? `<div class="xs dim goal-foot">Estimación con ${m.sims.toLocaleString('es')} simulaciones: ${m.lpKnown ? `tus LP de media (${sign(m.lpWin)} / ${sign(m.lpLoss)})` : 'LP supuestos (+20 / −20) hasta que juegues ranked con la app abierta'}, un ${fmtDec(m.winRate)}% de victorias (tus ${m.recentGames} últimas clasificatorias${m.seasonGames ? ` y tus ${m.seasonGames} partidas de la temporada, con su margen de error` : ''}) y ${m.pace ? `tu ritmo de ${fmtDec(m.pace)} partidas al día en los últimos ${m.paceDays} días` : 'sin ritmo reciente'}. No tiene en cuenta cambios de LP por MMR ni el escudo de descenso.</div>` : '';

    return `<div class="goal">${head}
      ${summary ? `<div class="goal-bar"><div style="width:${goal.progress}%"></div><span>${goal.progress}%</span></div>
      <div class="kpis" style="grid-template-columns:repeat(${kpis.length},minmax(0,1fr));margin-top:12px">${kpis.join('')}</div>` : ''}
      ${tips.length ? `<div class="stack" style="margin-top:10px">${tips.join('')}</div>` : ''}
      ${plan ? goalChart(goal) : ''}
      ${foot}
    </div>`;
  }
  const cur = q?.current;
  return `<div class="goal goal-form">
    <span class="lbl">Ponte un objetivo</span>
    <select id="goal-tier" class="inp">${GOAL_TIERS.map(([k, l]) => `<option value="${k}" ${cur && k === nextTier(cur.tier) ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select id="goal-div" class="inp">${['IV', 'III', 'II', 'I'].map((d) => `<option>${d}</option>`).join('')}</select>
    <input id="goal-date" class="inp" type="date" title="Fecha límite (opcional)">
    <button class="btn sm" onclick="saveGoal()">${icon('target')}Guardar</button>
    <span class="xs dim" style="flex-basis:100%">Con fecha límite verás tu plan semana a semana y la probabilidad de llegar a tiempo.</span>
  </div>`;
}

/** Gráfica del objetivo: tus LP reales, la línea del plan y la banda de lo que puede pasar a partir de hoy. */
function goalChart(goal) {
  const c = goal.chart;
  if (!c) return '';
  const W = 680, H = 230, L = 66, R = 74, T = 14, B = 24;
  const cone = c.cone || [];
  const t0 = goal.createdAt;
  const t1 = Math.max(c.now + 86_400_000, goal.deadline || 0, cone.at(-1)?.t || 0);
  const vals = [goal.start, goal.target, ...c.hist.map((p) => p.abs), ...cone.flatMap((p) => [p.p20, p.p80])];
  const lo = Math.min(...vals) - 15;
  const hi = Math.max(...vals) + 15;
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const P = (t, v) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`;

  const grid = [];
  for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) {
    if (v === goal.target) continue;
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v % 400 === 0 ? 'tier-l' : 'gl-line'}"/><text x="${L - 10}" y="${y(v) + 3}" text-anchor="end" class="ax ${v % 400 === 0 ? 'tier-t' : ''}">${esc(absDivLabel(v))}</text>`);
  }
  const band = cone.length > 1 ? `<path d="M${cone.map((p) => P(p.t, p.p80)).join(' L')} L${[...cone].reverse().map((p) => P(p.t, p.p20)).join(' L')} Z" class="goal-cone"/>
    <path d="M${cone.map((p) => P(p.t, p.p50)).join(' L')}" class="goal-med"/>` : '';
  const planLine = goal.deadline ? `<path d="M${P(t0, goal.start)} L${P(goal.deadline, goal.target)}" class="goal-plan"/>` : '';
  const hist = c.hist;
  const line = `M${hist.map((p) => P(p.t, p.abs)).join(' L')}`;
  const marks = [[t0, fmtDay(t0), 'start'], [c.now, 'Hoy', 'middle']];
  if (goal.deadline) marks.push([goal.deadline, fmtDay(goal.deadline), 'middle']);
  else if (cone.length) marks.push([cone.at(-1).t, fmtDay(cone.at(-1).t), 'middle']);
  // Si "Hoy" cae casi encima del inicio, no lo pintamos dos veces
  const shown = marks.filter(([t], i) => i !== 1 || x(t) - x(t0) > 40);

  return `<svg viewBox="0 0 ${W} ${H}" class="chart goal-chart" role="img" aria-label="Plan del objetivo y previsión">
    ${grid.join('')}
    <line x1="${L}" x2="${W - R}" y1="${y(goal.target)}" y2="${y(goal.target)}" class="goal-tgt"/>
    <text x="${W - R + 8}" y="${y(goal.target) + 4}" class="goal-tgt-t">${esc(goal.label)}</text>
    <line x1="${x(c.now)}" x2="${x(c.now)}" y1="${T}" y2="${H - B}" class="goal-now"/>
    ${goal.deadline ? `<line x1="${x(goal.deadline)}" x2="${x(goal.deadline)}" y1="${T}" y2="${H - B}" class="goal-dl"/>` : ''}
    ${band}${planLine}
    <path d="${line}" class="lp-line"/>
    ${hist.map((p, i) => `<circle cx="${x(p.t)}" cy="${y(p.abs)}" r="${i === hist.length - 1 ? 5 : 3.5}" class="${p.win === true ? 'pt-w' : p.win === false ? 'pt-l' : 'pt'}"><title>${esc(absLpText(p.abs))} · ${new Date(p.t).toLocaleString('es')}</title></circle>`).join('')}
    ${goal.plan ? `<circle cx="${x(goal.plan.milestone.t)}" cy="${y(goal.plan.milestone.abs)}" r="4.5" class="goal-ms"><title>Hito de esta semana: ${esc(absLpText(goal.plan.milestone.abs))}</title></circle>` : ''}
    ${shown.map(([t, l, a]) => `<text x="${x(t)}" y="${H - 6}" text-anchor="${a}" class="ax">${esc(l)}</text>`).join('')}
  </svg>
  <div class="legend-i"><span><i style="background:var(--gold-2)"></i>Tus LP</span>${goal.deadline ? '<span><i class="lg-plan"></i>Plan hasta la fecha</span>' : ''}${goal.plan ? '<span><i class="lg-ms"></i>Hito semanal</span>' : ''}${cone.length ? '<span><i class="lg-med"></i>Lo más probable</span><span><i class="lg-cone"></i>6 de cada 10 simulaciones</span>' : ''}</div>`;
}

function nextTier(t) {
  const i = GOAL_TIERS.findIndex(([k]) => k === t);
  return GOAL_TIERS[Math.min(GOAL_TIERS.length - 1, i + 1)]?.[0];
}

// ---------- Sesión (anti-tilt) ----------
function sessionPanel(se, heading = 'Sesión de hoy') {
  if (!se?.active) return '';
  const cls = { stop: 'bad', careful: 'warn', hot: 'good', ok: '' }[se.verdict];
  const title = { stop: 'Para y descansa', careful: 'Cuidado con el tilt', hot: 'Estás en racha', ok: 'Todo en orden' }[se.verdict];
  return panel(heading, 'clock', `
    <div class="session">
      <div><div class="sess-v ${cls}">${title}</div><div class="s muted">${se.games} partida${se.games === 1 ? '' : 's'} · ${Math.floor(se.minutes / 60)} h ${se.minutes % 60} min</div></div>
      <div class="row nw" style="gap:20px">
        <div class="kv2"><div class="v">${se.wins}<span class="dim">-</span>${se.losses}</div><div class="k">V-D</div></div>
        <div class="kv2"><div class="v ${se.lpNet > 0 ? 'good' : se.lpNet < 0 ? 'bad' : ''}">${se.lpNet == null ? '—' : (se.lpNet > 0 ? '+' : '') + se.lpNet}</div><div class="k">LP</div></div>
        <div class="kv2"><div class="v">${se.deaths ?? '—'}</div><div class="k">Muertes/part.</div></div>
      </div>
    </div>
    <div class="sess-form">${se.form.map((g) => `<div class="sf ${g.win ? 'w' : 'l'}">${img(g.champ, 's')}<span>${g.delta != null ? (g.delta >= 0 ? '+' : '') + g.delta : g.win ? 'V' : 'D'}</span></div>`).join('')}</div>
    ${se.warnings.length ? `<div class="stack" style="margin-top:12px">${se.warnings.map((w) => `<div class="note ${w.level === 'stop' ? 'stop' : ''}">${icon('alert')}<span>${esc(w.text)}</span></div>`).join('')}</div>` : ''}`,
    { cls: se.verdict === 'stop' ? 'danger' : se.verdict === 'hot' ? 'win-p' : '' });
}

// ---------- Tu evolución ----------
async function loadTrends() {
  if (trendsData) return;
  trendsData = 'loading';
  try {
    const t = await (await fetch('/api/trends')).json();
    trendsData = t.error ? { error: t.error } : t;
  } catch {
    trendsData = { error: 'No se pudieron calcular tus tendencias' };
  }
  render();
}

function sparkline(values, games, m, win = 5) {
  const W = 220, H = 46, P = 4;
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - 2 * P);
  const n = values.length;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <rect x="${x(n - win) - 3}" y="0" width="${W - x(n - win) + 3}" height="${H}" class="spark-win"/>
    <polyline points="${pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" class="spark-l ${m.trend}"/>
    ${pts.map((p) => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" class="${games[p.i]?.win ? 'w' : 'l'}"/>`).join('')}
  </svg>`;
}

function trendsPanel(t, title = 'Tu evolución', { insights = true } = {}) {
  if (!t || t === 'loading') return panel(title, 'up', '<div class="skel" style="height:220px"></div>');
  if (t.error || !t.total) return '';
  const fmtV = (m, v) => (v == null ? '—' : `${m.key === 'gold14' && v > 0 ? '+' : ''}${v}${m.unit}`);
  return panel(title, 'up', `
    ${!insights ? '' : t.insights.length ? `<div class="stack" style="margin-bottom:14px">${t.insights.map((i) => `<div class="insight ${i.type}">${icon(i.type === 'good' ? 'up' : 'down')}<span>${esc(i.text)}</span></div>`).join('')}</div>` : '<div class="s muted" style="margin-bottom:12px">Sin cambios claros entre las últimas partidas y las anteriores.</div>'}
    <div class="trends">${t.metrics.map((m) => `<div class="trend ${m.trend}">
      <div class="row nw"><span class="xs b dim ell" style="letter-spacing:.06em;text-transform:uppercase">${esc(m.label)}</span><span class="sp"></span>${m.change != null && m.trend !== 'flat' ? `<span class="tag ${m.trend === 'good' ? 'good' : 'bad'}">${m.change > 0 ? '+' : ''}${m.change}${m.absolute ? '' : '%'}</span>` : ''}</div>
      <div class="row nw" style="gap:8px;margin-top:4px"><span class="dsp" style="font-size:24px">${fmtV(m, m.recent)}</span><span class="xs dim">antes ${fmtV(m, m.before)}</span></div>
      ${sparkline(m.values, t.games, m, t.window)}
    </div>`).join('')}</div>
    <div class="legend-i"><span><i style="background:var(--win)"></i>Victoria</span><span><i style="background:var(--loss)"></i>Derrota</span><span class="dim">Zona resaltada: ${title === 'Tu evolución' ? 'tus' : 'sus'} últimas ${t.window} partidas, comparadas con las ${t.total - t.window} anteriores</span></div>`,
    { right: `${t.total} partidas analizadas` });
}

// ---------- Inicio ----------
// Filtros del perfil (cola y campeón): uno para tu inicio y otro para el jugador buscado
let homeFilter = { queue: 'auto', champ: null };
let searchFilter = { queue: 'auto', champ: null };
let profileLoading = false;
const filterQs = (f) => `queue=${f.queue}${f.champ ? '&champ=' + f.champ : ''}`;

function setHomeFilter(k, v) {
  homeFilter[k] = v;
  if (k === 'queue') homeFilter.champ = null;
  loadProfile(true);
}

async function setSearchFilter(k, v) {
  searchFilter[k] = v;
  if (k === 'queue') searchFilter.champ = null;
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

/** Barra de filtros del perfil: cola + campeón. */
function profileFilterBar(p, setter) {
  const f = p.filter;
  if (!f) return '';
  const order = [['auto', 'Recientes'], ['solo', 'Solo/Dúo'], ['flex', 'Flexible'], ['ranked', 'Clasificatorias'], ['normal', 'Normales'], ['aram', 'ARAM'], ['all', 'Todas']];
  return `<section class="panel pf-bar ${profileLoading ? 'busy' : ''}"><div class="pb">
    <span class="seg">${order.map(([k, l]) => `<button class="${f.queue === k ? 'on' : ''}" onclick="${setter}('queue','${k}')">${l}</button>`).join('')}</span>
    <select class="inp sel" onchange="${setter}('champ', Number(this.value) || null)">
      <option value="">Todos los campeones</option>
      ${f.champOptions.map((c) => `<option value="${c.key}" ${c.key === f.champ ? 'selected' : ''}>${esc(c.name)} (${c.games})</option>`).join('')}
    </select>
    <span class="sp"></span>
    <button class="chip" onclick="${setter === 'setHomeFilter' ? 'loadProfile(true)' : 'reloadSearchProfile()'}" title="Volver a cargar el historial">${icon('history')}Actualizar</button>
    <span class="xs dim">${p.summary ? esc(p.summary.label) : 'Sin partidas con este filtro'}${f.totalGames > 20 ? ` · ${f.totalGames} partidas guardadas` : ' · últimas 20 del cliente'}</span>
  </div></section>`;
}

async function loadProfile(force = false) {
  if (!force && Date.now() - profileAt < 60000) return;
  profileAt = Date.now();
  profileLoading = true;
  if (force) render();
  try {
    const p = await (await fetch(`/api/profile?${filterQs(homeFilter)}`)).json();
    if (!p.error) profileData = p;
  } catch { /* se reintenta */ }
  profileLoading = false;
  render();
  try {
    const c = await (await fetch('/api/coach')).json();
    if (!c.error) coachData = c;
  } catch { /* opcional */ }
  render();
}

function lpDeltaOf(gameId) {
  for (const q of Object.values(profileData?.lp || {})) {
    const g = q.games?.find((x) => x.gameId === gameId);
    if (g) return g.delta;
  }
  return null;
}

function lpChart(q) {
  const pts = q.points;
  const W = 680, H = 210, L = 66, R = 10, T = 14, B = 10;
  const vals = pts.map((p) => p.abs);
  const lo = Math.min(...vals, ...q.ticks.map((t) => t.abs)) - 10;
  const hi = Math.max(...vals) + 25;
  const x = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i / (pts.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.abs).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolución de tus LP">
    <defs><linearGradient id="lpf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d79c" stop-opacity=".3"/><stop offset="1" stop-color="#f3d79c" stop-opacity="0"/></linearGradient></defs>
    ${q.ticks.filter((t) => t.abs >= lo && t.abs <= hi).map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t.abs)}" y2="${y(t.abs)}" class="${t.abs % 400 === 0 ? 'tier-l' : 'gl-line'}"/><text x="${L - 10}" y="${y(t.abs) + 3}" text-anchor="end" class="ax ${t.abs % 400 === 0 ? 'tier-t' : ''}">${esc(t.label)}</text>`).join('')}
    <path d="${area}" fill="url(#lpf)"/><path d="${line}" class="lp-line"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.abs)}" r="${i === pts.length - 1 ? 5.5 : 4}" class="${p.win === true ? 'pt-w' : p.win === false ? 'pt-l' : 'pt'}"><title>${p.delta != null ? (p.delta >= 0 ? '+' : '') + p.delta + ' LP · ' : ''}${p.lp} LP · ${new Date(p.t).toLocaleString('es')}</title></circle>`).join('')}
  </svg>`;
}

// Pestaña abierta en "Progreso de LP": 'goal' | 'hist' | 'proj' (null = automática: objetivo si tienes uno)
let lpTab = null;

/**
 * Progreso de LP: cifras de un vistazo y, debajo, pestañas para no mezclar gráficas:
 * Objetivo (plan y simulación), Historial (LP partida a partida) y Proyección (cálculo rápido sin objetivo).
 * `proj` es la proyección de la previsión de rango (solo Solo/Dúo); si no se pasa, no hay pestaña.
 */
function lpPanel(lp, proj = null, { kpis = true, goalForm = true, goalSummary = true } = {}) {
  if (!lp) return '';
  const key = lp[lpQueue]?.points.length ? lpQueue : lp.solo.points.length ? 'solo' : 'flex';
  const q = lp[key];
  if (!q.points.length) return '';
  const d = (v) => `<span class="${v > 0 ? 'good' : v < 0 ? 'bad' : ''}">${v > 0 ? '+' : ''}${v}</span>`;
  const seg = `<span class="seg">${['solo', 'flex'].map((k) => `<button class="${k === key ? 'on' : ''}" onclick="lpQueue='${k}';render()">${lp[k].label}</button>`).join('')}</span>`;
  const goal = profileData?.goal && (profileData.goal.queue || 'solo') === key ? profileData.goal : null;
  const pj = key === 'solo' ? proj : null;
  const tabs = [['goal', 'Objetivo'], ['hist', 'Historial'], ...(pj ? [['proj', 'Proyección']] : [])];
  let tab = lpTab || (goal && !goal.noData ? 'goal' : 'hist');
  if (!tabs.some(([k]) => k === tab)) tab = 'goal';
  const side = {
    goal: goal && !goal.noData ? '' : 'Sin objetivo',
    hist: `Desde ${new Date(q.trackedSince).toLocaleDateString('es')}`,
    proj: 'Sin fecha ni simulaciones',
  }[tab];

  const goalHint = profileData?.goal && !profileData.goal.noData ? `Tu objetivo es de ${esc(lp[profileData.goal.queue || 'solo']?.label || '')}: elige esa cola arriba a la derecha.` : 'Ponte un objetivo en la tarjeta «Objetivo de rango» de arriba.';
  const body = tab === 'goal' ? (goal || goalForm ? goalBlock(goal, q, { summary: goalSummary }) : `<div class="hm-tip">${icon('flag')}<span>${goalHint}</span></div>`)
    : tab === 'proj' ? projBlock(pj, false, !!(goal && !goal.noData && on('home.goalOdds')))
    : q.points.length >= 2 ? `<div class="hm-chart">${lpChart(q)}</div><div class="legend-i"><span><i style="background:var(--win)"></i>Victoria</span><span><i style="background:var(--loss)"></i>Derrota</span><span class="dim">Cada punto es una clasificatoria</span></div>`
    : `<div class="hm-tip">${icon('info')}<span>Empiezo a apuntar tus LP desde hoy (${q.current.lp} LP en ${esc(q.current.text)}). Juega una ranked y aquí verás tu progreso partida a partida.</span></div>`;

  return panel('Progreso de LP', 'up', `
    ${kpis ? `<div class="kpis">
      <div class="kpi"><div class="k">Ahora</div><div class="v">${q.current.lp}<span class="s dim"> LP</span></div><div class="s">${esc(q.current.text)}</div></div>
      <div class="kpi"><div class="k">24 horas</div><div class="v">${d(q.today)}</div><div class="s">LP</div></div>
      <div class="kpi"><div class="k">7 días</div><div class="v">${d(q.week)}</div><div class="s">LP</div></div>
      <div class="kpi"><div class="k">Victoria / derrota</div><div class="v">${q.avgWin != null ? d(q.avgWin) : '—'}<span class="dim" style="font-size:18px"> / </span>${q.avgLoss != null ? d(q.avgLoss) : '—'}</div><div class="s">LP de media</div></div>
      <div class="kpi"><div class="k">Pico</div><div class="v" style="font-size:20px">${esc(q.peakLabel)}</div></div>
    </div>` : ''}
    <div class="hm-tabs ${kpis ? '' : 'flat'}"><span class="seg">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" onclick="lpTab='${k}';render()">${l}</button>`).join('')}</span><span class="xs dim">${esc(side)}</span></div>
    ${body}`, { right: seg, cls: 'gold' });
}

/**
 * Proyección rápida de LP (viene de la previsión de rango). Es otra cuenta distinta de la del objetivo:
 * se dice claramente para que no parezcan dos cifras que se contradicen.
 */
function projBlock(pj, other = false, hasGoal = false) {
  if (!pj) return '';
  return `<div class="hm-proj">
    <div class="s muted">Si ${other ? 'sigue' : 'sigues'} ganando un <b class="${wrClass(pj.wr, 50.5, 49.5)}">${fmtDec(pj.wr)}%</b> <span class="est">estim.</span> con ${pj.assumed ? (other ? '±20 LP por partida (sus LP no se conocen)' : '±20 LP por partida (aún sin datos de tus LP)') : `+${pj.W} / −${pj.L} LP por partida`}:</div>
    <div class="fc-proj">
      <div class="inset"><div class="xs dim">Siguiente división</div><div class="b">${pj.nextDiv ? `${esc(pj.nextDiv.label)} <span class="s muted">en ~${pj.nextDiv.games} partidas</span>` : `<span class="s muted">Con ${other ? 'su' : 'tu'} ritmo actual no sube${other ? '' : 's'}</span>`}</div></div>
      <div class="inset"><div class="xs dim">En 20 partidas</div><div class="b">${esc(pj.in20.label)}</div></div>
      <div class="inset"><div class="xs dim">En 50 partidas</div><div class="b">${esc(pj.in50.label)}</div></div>
      <div class="inset"><div class="xs dim">Winrate esperado</div><div class="b ${wrClass(pj.wr, 50.5, 49.5)}">${pj.wr}%</div></div>
    </div>
    <div class="xs dim hm-foot">Cálculo rápido, sin fecha ni simulaciones: ${other ? 'su' : 'tu'} winrate reciente, suavizado hacia el que ${other ? 'le' : 'te'} correspondería por ${other ? 'sus' : 'tus'} estadísticas.${hasGoal ? ' Por eso puede no coincidir con la estimación de tu objetivo, que usa tu winrate real, tu ritmo de partidas y simulaciones.' : ''}</div>
  </div>`;
}

// ---------- Fila de partida (al estilo de Blitz): resultado, KDA, CS, oro, runas, objetos, logros y los 10 jugadores ----------
const gameSums = new Map(); // "puuid:gameId" → resumen | null (cargando)

/** Pide al servidor los resúmenes que falten (jugadores, runas y logros) de esas partidas. */
async function loadGameSums(games, puuid = '') {
  const ids = games.filter((g) => !g.remake && !gameSums.has(`${puuid}:${g.gameId}`)).map((g) => g.gameId);
  if (!ids.length) return;
  for (const id of ids) gameSums.set(`${puuid}:${id}`, null);
  try {
    const data = await (await fetch(`/api/games/summary?ids=${ids.join(',')}${puuid ? '&puuid=' + puuid : ''}`)).json();
    for (const id of ids) gameSums.set(`${puuid}:${id}`, data?.[id] || { missing: true });
  } catch {
    for (const id of ids) gameSums.set(`${puuid}:${id}`, { missing: true });
  }
  render();
}

const fmtClock = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
const fmtK1 = (n) => (n >= 1000 ? `${fmtDec(Math.round(n / 100) / 10)}k` : String(n));

function gameRow(g, { onclick = null, puuid = '', limitBadges = 4 } = {}) {
  const res = g.remake ? 'Remake' : g.win ? 'Victoria' : 'Derrota';
  const lpd = lpDeltaOf(g.gameId);
  const sum = on('postgame.rowDetails') ? gameSums.get(`${puuid}:${g.gameId}`) : undefined;
  const slots = g.slots || [...(g.items || []), ...Array(Math.max(0, 8 - (g.items?.length || 0))).fill(null)];
  const slot = (it) => (it ? img(it, 'gs') : '<span class="ic gs gs-empty"></span>');
  const badges = on('postgame.badges') && sum?.badges?.length ? sum.badges : [];
  const pl = (p) => `<div class="gp ${p.self ? 'me' : ''}">${img(p.champ, 'xxs')}<span class="ell">${esc(p.name)}</span></div>`;
  const players = sum?.players?.length ? `<div class="g-pl"><div>${sum.players.filter((p) => p.team === 'ally').map(pl).join('')}</div><div>${sum.players.filter((p) => p.team === 'enemy').map(pl).join('')}</div></div>`
    : sum === null ? '<div class="g-pl"><div class="skel" style="height:96px"></div></div>' : '';
  const meta = [g.queue, g.secs ? fmtClock(g.secs) : `${g.duration} min`, timeAgo(g.date)].map(esc).join('<i>•</i>');
  return `<div role="button" tabindex="${g.remake ? -1 : 0}" class="game g2 ${g.remake ? 'rm' : g.win ? 'w' : 'l'} ${view === 'games' && g.gameId === selectedGame ? 'on' : ''}" ${g.remake ? '' : `onclick="${onclick || `go('games', ${g.gameId})`}" onkeydown="if(event.key==='Enter')this.click()"`}>
    <div class="g-por">${img(g.champ, 'l')}</div>
    <div class="g-main">
      <div class="g-head"><span class="g-res ${g.remake ? 'dim' : g.win ? 'good' : 'bad'}">${res}</span>${lpd != null ? `<i>•</i><span class="${lpd >= 0 ? 'good' : 'bad'} b">${lpd >= 0 ? '+' : ''}${lpd} LP</span>` : ''}<i>•</i><span class="dim ell">${meta}</span></div>
      <div class="g-body">
        <div class="g-st"><b>${g.kdaRatio != null ? fmtDec(g.kdaRatio) : '–'} KDA</b><small>${g.k ?? '?'} / ${g.d ?? '?'} / ${g.a ?? '?'}</small></div>
        <div class="g-st"><b>${g.csMin != null ? fmtDec(g.csMin) : '–'} CS/min</b><small>${g.cs ?? '–'} CS</small></div>
        <div class="g-st"><b>${g.goldMin != null ? g.goldMin : sum?.goldMin ?? '–'} oro/min</b><small>${g.gold ? fmtK1(g.gold) + ' de oro' : ''}</small></div>
        <div class="g-gear">
          <div class="g-rs"><div>${(g.spells || []).map((s) => img(s, 'gs')).join('')}</div><div>${sum?.keystone ? img(sum.keystone, 'gs round') : '<span class="ic gs gs-empty round"></span>'}${sum?.subStyle ? img(sum.subStyle, 'gs round sub') : '<span class="ic gs gs-empty round"></span>'}</div></div>
          <div class="g-it">${slots.map(slot).join('')}</div>
        </div>
      </div>
      ${badges.length ? `<div class="g-bd">${badges.slice(0, limitBadges).map((b) => `<span class="badge-mini b-${b.tier}" title="${esc(b.detail)}">${icon(b.icon)}${esc(b.title)}</span>`).join('')}${badges.length > limitBadges ? `<span class="xs dim">+${badges.length - limitBadges}</span>` : ''}</div>` : ''}
    </div>
    ${players}
  </div>`;
}

/** Previsión de rango: tu nivel por estadísticas, rango previsto y proyección de LP. */
function forecastPanel(f, other = false, { projection = true } = {}) {
  if (!f) return '';
  const cur = f.current;
  const pred = f.predicted;
  const pj = f.projection;
  const curT = cur ? Math.min(cur.abs, 2800) / 400 : null;
  const TIER_INI = ['H', 'B', 'P', 'O', 'P', 'E', 'D', 'M+'];
  const metric = (m) => {
    const cls = curT == null ? '' : m.t >= curT + 0.25 ? 'good' : m.t <= curT - 0.25 ? 'bad' : '';
    return `<div class="fc-m"><span class="fc-k">${esc(m.label)}</span><b class="num">${m.value}</b>
      <div class="fc-track">${curT != null ? `<span class="fc-cur" style="left:${(curT / 7.6) * 100}%" title="Tu rango actual"></span>` : ''}<i class="${cls}" style="left:${(Math.max(0, m.t) / 7.6) * 100}%"></i></div>
      <span class="fc-t ${cls}">${esc(m.tier)}</span></div>`;
  };
  return panel('Previsión de rango', 'up', `
    <div class="fc-top">
      ${cur ? `<div class="fc-rank">${emblem(cur.tier)}<div style="min-width:0"><div class="lbl">Ahora</div><div class="b">${esc(cur.label)}</div></div></div>
      <span class="fc-arrow ${f.diffDivs > 0 ? 'good' : f.diffDivs < 0 ? 'bad' : ''}">${icon(f.diffDivs < 0 ? 'down' : 'up')}</span>` : ''}
      ${pred ? `<div class="fc-rank main">${emblem(pred.tier)}<div style="min-width:0"><div class="lbl goldc">Rango previsto</div><div class="dsp">${esc(pred.label)}</div><div class="xs dim">${other ? 'El que le corresponde si mantiene' : 'El que te corresponde si mantienes'} este nivel</div></div></div>` : ''}
      <div class="fc-skill"><div class="lbl">Nivel de ${other ? 'sus' : 'tus'} estadísticas</div><div class="b">${esc(f.skill.label)}</div><span class="chip sm">Confianza ${f.confidence}</span></div>
    </div>
    <div class="hm-tip gold" style="margin-top:14px">${icon('bulb')}<span>${esc(f.verdict)}</span></div>
    ${lbl(`${other ? 'Sus' : 'Tus'} estadísticas, comparadas con cada rango`, `${f.games} partidas de ${esc(f.roleLabel)}`)}
    <div class="fc-scale"><span></span><span></span><div class="fc-ini">${TIER_INI.map((t) => `<span>${t}</span>`).join('')}</div><span></span></div>
    <div class="fc-metrics">${f.metrics.map(metric).join('')}</div>
    <div class="xs dim" style="margin-top:6px">La línea blanca es ${other ? 'su' : 'tu'} rango actual. Lo que más ${other ? 'le' : 'te'} frena: <b class="bad">${esc(f.worst.label)}</b> (nivel ${esc(f.worst.tier)}). ${other ? 'Su' : 'Tu'} punto fuerte: <b class="good">${esc(f.best.label)}</b>.</div>
    ${pj && projection ? `${lbl(`Proyección de LP a ${other ? 'su' : 'tu'} ritmo`)}${projBlock(pj, other)}` : ''}
    ${f.mmr ? `<div class="insight ${f.mmr.type}" style="margin-top:10px">${icon(f.mmr.type === 'good' ? 'up' : f.mmr.type === 'bad' ? 'alert' : 'info')}<span>${esc(f.mmr.text)}</span></div>` : ''}
    <div class="xs dim" style="margin-top:10px">Estimación orientativa: compara las medias de ${other ? "sus" : "tus"} últimas partidas con las habituales de cada rango en ${other ? "su" : "tu"} rol. No es un dato oficial de Riot.${pj && !projection ? ' La proyección de LP está en Progreso de LP, pestaña Proyección.' : ''}</div>`,
    { right: `<span class="chip sm">${posIcon(f.role)}${esc(f.roleLabel)}</span>` });
}

// ---------- Inicio ----------
// Pestaña abierta en "Más detalles" y bloques desplegados (p. ej. todos los avisos de la sesión)
let homeTab = 'lp';
const hmOpen = new Set();

function hmToggle(k) {
  if (hmOpen.has(k)) hmOpen.delete(k); else hmOpen.add(k);
  render();
}

/** Abre una pestaña de "Más detalles" (y, si se indica, la subpestaña de Progreso de LP) y baja hasta ella. */
function hmShow(tab, sub = null) {
  homeTab = tab;
  if (sub) lpTab = sub;
  render();
  document.getElementById('hm-more')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const hmSigned = (v, unit = '') => (v == null ? '<span class="dim">–</span>' : `<span class="${v > 0 ? 'good' : v < 0 ? 'bad' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit}</span>`);
const hmLink = (text, onclick) => `<button class="hm-link" onclick="${onclick}">${text}${icon('chevron')}</button>`;
const hmCell = (k, v, s = '', title = '') => `<div class="hm-cell" ${title ? `title="${esc(title)}"` : ''}><div class="lbl">${k}</div><div class="dsp hm-cell-v">${v}</div>${s ? `<div class="hm-cell-s">${s}</div>` : ''}</div>`;
const EST = '<span class="est">estim.</span>';

/** Cabecera: quién eres, tu rango en cada cola y tu forma reciente. */
function hmHero(p, me) {
  const sm = p.summary;
  const [nm, tg] = (me?.name || '').split('#');
  const role = p.roles[0];
  const main = p.champions[0];
  const ranks = p.ranks.map((r, i) => `<div class="hm-rank ${i ? '' : 'main'}">${emblem(r.tier)}<div class="hm-rank-tx">
      <div class="lbl">${esc(r.queue)}</div><div class="hm-rank-t">${esc(r.text)}</div>
      ${r.lp != null ? `<div class="hm-rank-s"><b class="goldc">${r.lp} LP</b>${r.winRate != null ? `<span class="${wrClass(r.winRate, 50.5, 49.5)}">${r.winRate}%</span>` : ''}<span class="dim">${r.wins}V ${r.losses}D</span></div>` : '<div class="hm-rank-s dim">Sin clasificar</div>'}
    </div></div>`).join('');
  const streak = p.streak >= 2 ? `<span class="chip sm good">${icon('flame')}${p.streak} victorias seguidas</span>`
    : p.streak <= -2 ? `<span class="chip sm bad">${icon('down')}${-p.streak} derrotas seguidas</span>` : '';
  const form = on('home.form') && sm ? `<div class="hm-form">
      <div class="lbl ell">${esc(sm.label)}</div>
      <div class="hm-form-v"><span class="dsp ${wrClass(sm.winRate)}">${sm.winRate}%</span><span class="s muted">${sm.wins}V ${sm.losses}D</span>${streak}</div>
      <div class="form" title="Tus últimas ${sm.form.length} partidas con este filtro (la más reciente a la izquierda)">${sm.form.map((w) => `<span class="${w ? 'w' : 'l'}">${w ? 'V' : 'D'}</span>`).join('')}</div>
    </div>` : '';
  return `<section class="hm-hero"><div class="hm-art" style="background-image:url('${esc(main?.champ?.splash || '')}')"></div>
    <div class="hm-id">
      <div class="hm-av"><img class="ic round" src="${esc(me?.icon || '')}" alt=""><span title="Nivel de invocador">${me?.level ?? '–'}</span></div>
      <div style="min-width:0">
        <div class="hm-name ell">${esc(nm)}<span>#${esc(tg || '')}</span></div>
        <div class="hm-meta">${role ? `<span>${posIcon(role.pos)}${esc(role.label)}</span>` : ''}${main ? `<span>${img(main.champ, 'xxs')}${esc(main.champ.name)}</span>` : ''}${!form && streak ? streak : ''}</div>
      </div>
    </div>
    ${ranks ? `<div class="hm-ranks">${ranks}</div>` : ''}
    ${form}
  </section>`;
}

/** Sesión de hoy: veredicto anti-tilt, cifras del día y avisos. */
function hmSession(p) {
  if (!on('home.session')) return '';
  const se = p.session;
  if (!se?.active) {
    const last = p.recent?.[0];
    return panel('Sesión de hoy', 'clock', `<div class="hm-big dim">Sin partidas hoy</div>
      <div class="s dim">${last ? `Última partida ${esc(timeAgo(last.date))}` : 'Aún no hay partidas'}</div>
      <div class="hm-tip" style="margin-top:14px">${icon('info')}<span>Cuando juegues verás aquí tu balance del día y avisos si empiezas a tiltear.</span></div>`, { cls: 'hm-card' });
  }
  const cls = { stop: 'bad', careful: 'warn', hot: 'good', ok: '' }[se.verdict];
  const title = { stop: 'Para y descansa', careful: 'Cuidado con el tilt', hot: 'Estás en racha', ok: 'Todo en orden' }[se.verdict];
  const open = hmOpen.has('warn');
  const warns = open ? se.warnings : se.warnings.slice(0, 1);
  const many = se.deaths != null && se.baseDeaths && se.deaths > se.baseDeaths * 1.3;
  return panel('Sesión de hoy', 'clock', `
    <div class="hm-big ${cls}">${title}</div>
    <div class="s dim">${se.games} partida${se.games === 1 ? '' : 's'} · ${Math.floor(se.minutes / 60)} h ${se.minutes % 60} min</div>
    <div class="hm-cells">
      ${hmCell('V-D', `${se.wins}<span class="dim">-</span>${se.losses}`)}
      ${hmCell('LP', hmSigned(se.lpNet), '', se.lpNet == null ? 'Sin datos: la app apunta tus LP cuando juegas ranked con ella abierta' : `Suma de los LP de ${se.lpKnown} partida${se.lpKnown === 1 ? '' : 's'} de hoy con LP conocidos`)}
      ${hmCell('Muertes/part.', se.deaths == null ? '<span class="dim">–</span>' : `<span class="${many ? 'bad' : ''}">${fmtDec(se.deaths)}</span>`, se.baseDeaths ? `media ${fmtDec(se.baseDeaths)}` : '', se.deaths == null ? 'Sin datos de muertes de hoy' : '')}
    </div>
    <div class="sess-form">${se.form.map((g) => `<div class="sf ${g.win ? 'w' : 'l'}">${img(g.champ, 's')}<span>${g.delta != null ? (g.delta >= 0 ? '+' : '') + g.delta : g.win ? 'V' : 'D'}</span></div>`).join('')}</div>
    ${warns.length ? `<div class="stack hm-warns">${warns.map((w) => `<div class="note ${w.level === 'stop' ? 'stop' : ''}">${icon('alert')}<span>${esc(w.text)}</span></div>`).join('')}</div>` : ''}
    ${se.warnings.length > 1 ? hmLink(open ? 'Ver menos' : `Ver ${se.warnings.length - 1} aviso${se.warnings.length === 2 ? '' : 's'} más`, "hmToggle('warn')") : ''}`,
    { cls: `hm-card ${se.verdict === 'stop' ? 'danger' : se.verdict === 'hot' ? 'win-p' : ''}` });
}

/** Objetivo de rango: lo que falta, cómo vas frente al plan y el hito de la semana. El detalle está en Progreso de LP. */
function hmGoal(p) {
  if (!on('home.goal')) return '';
  const goal = p.goal;
  const link = on('home.lpChart') && p.lp ? hmLink('Ver plan y simulaciones', "hmShow('lp','goal')") : '';
  if (!goal || goal.noData) {
    const q = p.lp?.[lpQueue]?.current ? p.lp[lpQueue] : p.lp?.solo;
    return panel('Objetivo de rango', 'flag', `${goal?.noData ? `<div class="hm-tip" style="margin-bottom:10px">${icon('info')}<span>Tu objetivo (${esc(goal.label)}) es de una cola sin rango todavía: elige otro.</span></div>` : ''}${goalBlock(null, q)}`, { cls: 'hm-card hm-goal' });
  }
  const queue = p.lp?.[goal.queue || 'solo']?.label || 'Solo/Dúo';
  const right = goal.deadline ? `<span class="chip sm">${icon('clock')}${esc(fmtDay(goal.deadline))}${goal.daysLeft != null ? ` · ${goal.daysLeft} día${goal.daysLeft === 1 ? '' : 's'}` : ''}</span>` : '';
  const top = `<div class="hm-goal-top">${emblem(goal.tier)}<div style="min-width:0"><div class="lbl">${esc(queue)}</div><div class="hm-goal-t">${esc(goal.label)}</div></div>`;
  if (goal.done) {
    return panel('Objetivo de rango', 'flag', `${top}</div><div class="advice" style="margin-top:12px">${icon('star')}<span><b>¡Objetivo conseguido!</b> Ponte uno nuevo.</span></div>
      <div class="row" style="margin-top:12px"><button class="btn ghost sm" onclick="saveGoal(true)">Quitar objetivo</button></div>`, { cls: 'hm-card hm-goal gold', right });
  }
  const m = goal.model;
  const odds = on('home.goalOdds');
  const plan = on('home.goalPlan') && goal.plan;
  const g = goal.games;
  const cells = [];
  if (odds) {
    cells.push(hmCell(`Partidas ${EST}`, g ? `~${g.p50}` : '<span class="dim">–</span>', g ? (g.p80 ? `entre ${g.p20} y ${g.p80}` : `llegas en el ${goal.reachProb}%`) : `llegas en el ${goal.reachProb}%`,
      g ? '' : `Con tu winrate actual no subes de forma fiable: necesitas ganar más del ${goal.breakEven}% de tus partidas`));
    if (goal.deadline) {
      const pr = goal.onTimeProb;
      cells.push(hmCell(`A tiempo ${EST}`, pr == null ? '<span class="dim">–</span>' : `<span class="${pr >= 60 ? 'good' : pr >= 30 ? 'warn' : 'bad'}">${pr}%</span>`, m.pace ? `~${goal.gamesAvail} partidas a tu ritmo` : 'sin ritmo reciente', pr == null ? 'Sin ritmo de partidas reciente para calcularlo' : 'Probabilidad de llegar antes de la fecha límite'));
    } else {
      cells.push(hmCell(`Fecha ${EST}`, goal.eta?.p50 ? esc(fmtDay(goal.eta.p50)) : '<span class="dim">–</span>', goal.eta?.p50 ? `a ${fmtDec(m.pace)} partidas/día` : m.pace ? 'no llegas a este ritmo' : 'sin ritmo reciente'));
    }
  }
  if (plan) cells.push(hmCell('Frente al plan', hmSigned(goal.plan.diff, ' LP'), goal.plan.diff >= 0 ? 'por delante' : 'por detrás', `Según el plan, hoy deberías ir por ${absLpText(goal.plan.now)}`));
  else cells.push(hmCell('Progreso', `${goal.progress}%`, 'desde que te lo pusiste'));
  let ms = '';
  if (plan) {
    const h = goal.plan.milestone;
    const day = new Date(h.t).toLocaleDateString('es', { weekday: 'long', day: 'numeric' }).replace(',', '');
    ms = `<div class="hm-ms">${icon('flag')}<span><b>Hito semanal:</b> ${esc(absLpText(h.abs))} antes del ${esc(day)}${h.need ? ` · faltan ${h.need} LP` : ' · ya lo tienes'}</span></div>`;
  }
  return panel('Objetivo de rango', 'flag', `${top}
      <div class="hm-goal-need"><div class="dsp">${goal.need}<small> LP</small></div><div class="xs dim">te faltan · ${goal.netWins} victorias netas</div></div></div>
    <div class="hm-gbar" title="${goal.progress}% del camino desde que te pusiste el objetivo"><div style="width:${goal.progress}%"></div></div>
    <div class="hm-gbar-l"><span>${esc(absLpText(goal.start))}</span><span class="goldc">Ahora ${esc(absLpText(goal.cur))}</span><span>${esc(goal.label)}</span></div>
    <div class="hm-cells" style="grid-template-columns:repeat(${cells.length},minmax(0,1fr))">${cells.join('')}</div>
    ${ms}${link}`, { cls: 'hm-card hm-goal gold', right });
}

/** Barras de LP partida a partida (verde sube, rojo baja). */
function hmLpBars(q) {
  const pts = q.points.filter((x) => x.delta != null).slice(-14);
  if (!pts.length) return `<div class="hm-bars-empty xs dim">Juega una ranked con la app abierta y aquí verás cuántos LP ganas o pierdes en cada una.</div>`;
  const max = Math.max(25, ...pts.map((x) => Math.abs(x.delta)));
  return `<div class="hm-bars-l"><span class="lbl">LP por partida</span><span class="xs dim">últimas ${pts.length}</span></div><div class="hm-bars" aria-label="LP de cada partida">${pts.map((x) => `<div class="hm-bar" title="${x.delta >= 0 ? '+' : ''}${x.delta} LP · ${esc(new Date(x.t).toLocaleString('es'))}"><i class="${x.delta >= 0 ? 'up' : 'dn'}" style="height:${Math.max(6, (Math.abs(x.delta) / max) * 50)}%"></i></div>`).join('')}</div>`;
}

/** Tus LP: dónde estás, cuánto has movido hoy y esta semana y lo que ganas o pierdes de media. */
function hmLp(p) {
  if (!on('home.lpCard')) return '';
  const lp = p.lp;
  const key = lp?.[lpQueue]?.points.length ? lpQueue : lp?.solo?.points.length ? 'solo' : 'flex';
  const q = lp?.[key];
  const seg = lp ? `<span class="seg">${['solo', 'flex'].map((k) => `<button class="${k === key ? 'on' : ''}" onclick="lpQueue='${k}';render()">${esc(lp[k].label)}</button>`).join('')}</span>` : '';
  if (!q?.points.length) {
    return panel('Tus LP', 'up', `<div class="hm-big dim" title="La app apunta tus LP cuando juegas clasificatorias con ella abierta">Sin datos</div>
      <div class="s dim">Juega una clasificatoria con la app abierta y empezaré a apuntar tus LP.</div>`, { cls: 'hm-card', right: seg });
  }
  return panel('Tus LP', 'up', `
    <div class="hm-lp-top"><div style="min-width:0"><div class="dsp hm-lp-v">${q.current.lp}<small> LP</small></div><div class="s muted">${esc(q.current.text)}</div></div>
      <div class="hm-lp-peak"><div class="lbl">Pico</div><div class="b">${esc(q.peakLabel)}</div></div></div>
    ${hmLpBars(q)}
    <div class="hm-cells">
      ${hmCell('24 horas', hmSigned(q.today))}
      ${hmCell('7 días', hmSigned(q.week))}
      ${hmCell('Media V / D', `${hmSigned(q.avgWin)}<span class="dim hm-sl">/</span>${hmSigned(q.avgLoss)}`, '', q.avgWin == null || q.avgLoss == null ? 'Aún no hay suficientes victorias y derrotas con LP apuntados' : 'LP que ganas por victoria y pierdes por derrota, de media')}
    </div>
    ${on('home.lpChart') ? hmLink('Ver historial de LP', "hmShow('lp','hist')") : ''}`, { cls: 'hm-card', right: seg });
}

/** Rendimiento: tus medias con su nivel por rango, el rango previsto y lo que ha cambiado últimamente. */
function hmPerf(p, t) {
  const sm = p.summary;
  if (!on('home.perf') || !sm) return '';
  const f = p.forecast;
  const fm = Object.fromEntries((f?.metrics || []).map((m) => [m.key, m]));
  const curT = f?.current ? Math.min(f.current.abs, 2800) / 400 : null;
  const tile = (key, label, value, extra = '') => {
    const m = fm[key];
    const cls = !m || curT == null ? '' : m.t >= curT + 0.25 ? 'good' : m.t <= curT - 0.25 ? 'bad' : '';
    return `<div class="hm-stat"><div class="lbl">${label}</div><div class="hm-stat-v"><span class="dsp">${value}</span>${extra}</div>
      ${m ? `<div class="hm-stat-tier" title="Nivel estimado de este dato en tus ${f.games} partidas de ${esc(f.roleLabel)}, comparado con las medias de cada rango. La línea blanca es tu rango actual.">
        <div class="fc-track">${curT != null ? `<span class="fc-cur" style="left:${(curT / 7.6) * 100}%"></span>` : ''}<i class="${cls}" style="left:${(Math.max(0, m.t) / 7.6) * 100}%"></i></div>
        <span class="${cls}">${esc(m.tier)}</span></div>` : '<div class="hm-stat-tier"><span class="dim" title="No hay referencia por rango para este dato">–</span></div>'}</div>`;
  };
  const pred = f?.predicted;
  const fc = on('home.forecast') && pred ? `<div class="hm-fc">
      ${emblem(pred.tier)}
      <div style="min-width:0"><div class="lbl">Rango previsto ${EST}</div><div class="hm-fc-t">${esc(pred.label)}</div></div>
      <div class="hm-fc-d"><div>Te frena: <b class="bad">${esc(f.worst.label)}</b> <span class="dim">(${esc(f.worst.tier)})</span></div><div>Tu fuerte: <b class="good">${esc(f.best.label)}</b> <span class="dim">(${esc(f.best.tier)})</span></div></div>
      ${hmLink('Ver previsión', "hmShow('forecast')")}
    </div>` : '';
  const ins = t && t !== 'loading' && !t.error && t.insights?.length ? `${lbl(`Tus últimas ${t.window} partidas frente a las ${t.total - t.window} anteriores`)}
    <div class="hm-ins">${t.insights.map((i) => `<div class="${i.type}">${icon(i.type === 'good' ? 'up' : 'down')}<span>${esc(i.text)}</span></div>`).join('')}</div>` : '';
  return panel('Rendimiento', 'chart', `
    <div class="hm-stats">
      ${tile('kda', 'KDA', sm.kdaRatio, `<small>${esc(sm.kda)}</small>`)}
      ${tile('csMin', 'CS/min', sm.csMin)}
      ${tile('visionMin', 'Visión/min', sm.visionMin)}
      ${tile('dmgMin', 'Daño/min', sm.dmgMin)}
      ${tile('goldMin', 'Oro/min', sm.goldMin)}
    </div>
    ${fc}${on('home.trends') ? ins : ''}`, { right: `${esc(sm.label)}${f?.metrics?.length ? ` · nivel ${EST}` : ''}` });
}

/** Flecha de evolución: "better" | "worse" | "same" (frente a tus partidas anteriores). */
function trendChip(trend, title = 'Frente a tus partidas anteriores') {
  if (!trend) return '';
  const m = { better: ['good', 'up', 'Mejorando'], worse: ['bad', 'down', 'Empeorando'], same: ['', 'swap', 'Igual'] }[trend];
  return `<span class="tr-chip ${m[0]}" title="${title}">${icon(m[1])}${m[2]}</span>`;
}

/** Nota por fase (fase de líneas, mitad, final) con su evolución. Con `detail`, tarjetas más completas para "Coach a fondo". */
function coachPhases(c, { detail = false } = {}) {
  if (!c?.phases?.length || !c.analyzed) return '';
  if (!detail && !c.phases.some((p) => p.score != null)) return '';
  const n = c.analyzed;
  const cell = (p) => {
    const head = `<div class="hm-ph-h"><span class="hm-ph-k" title="${esc(p.label)} (${esc(p.range)})">${esc(p.label)}</span><span class="hm-ph-r">${esc(p.range)}</span></div>`;
    if (p.score == null) {
      const why = p.games ? [`Pocas partidas`, `Solo ${p.games} de tus partidas analizadas llegó a esta fase: hacen falta al menos 2 para ponerle nota`]
        : ['Sin partidas tan largas', 'Ninguna de tus partidas analizadas llegó a esta fase'];
      return `<div class="hm-ph na ${detail ? 'big' : ''}">${head}<div class="hm-ph-m"><span class="hm-ph-g" title="${why[1]}">–</span></div><span class="xs dim" title="${why[1]}">${why[0]}</span></div>`;
    }
    const weak = p.key === c.weakestPhase;
    const d = p.scoreBefore != null ? p.score - p.scoreBefore : null;
    const dd = p.deathsBefore != null ? Math.round((p.deaths - p.deathsBefore) * 10) / 10 : null;
    const ddCls = dd == null || Math.abs(dd) < 0.3 ? '' : dd > 0 ? 'bad' : 'good';
    const grade = `<div class="hm-ph-m"><span class="hm-ph-g g-${p.grade}">${p.grade}</span><span class="hm-ph-s">${p.score}<small>/100</small></span>
      ${d ? `<span class="hm-ph-d ${d > 0 ? 'good' : 'bad'}" title="Antes: ${p.scoreBefore}/100">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : ''}
      ${weak ? '<span class="hm-ph-tag" title="La fase en la que peor nota sacas">Peor fase</span>' : ''}</div>`;
    if (!detail) {
      return `<div class="hm-ph ${weak ? 'weak' : ''}">${head}${grade}
        <div class="hm-ph-de" title="Muertes de media por partida en esta fase${p.deathsBefore != null ? `. Antes: ${fmtDec(p.deathsBefore)}` : ''}">${icon('skull')}<b class="${ddCls}">${fmtDec(p.deaths)}</b><span>${p.deaths === 1 ? 'muerte' : 'muertes'}</span>${p.deathsBefore != null ? `<span class="dim">· antes ${fmtDec(p.deathsBefore)}</span>` : ''}</div>
      </div>`;
    }
    const kv = (k, v, t = '') => `<div class="hm-ph-kv"${t ? ` title="${t}"` : ''}><span>${k}</span><b>${v}</b></div>`;
    const was = (v) => `<span class="dim"> · antes ${v}</span>`;
    return `<div class="hm-ph big ${weak ? 'weak' : ''}">${head}${grade}
      <div class="bar hm-ph-bar" title="Nota de 0 a 100${p.scoreBefore != null ? `. La raya blanca es tu nota de antes (${p.scoreBefore})` : ''}"><div class="${p.score >= 55 ? 'hm-hi' : p.score >= 40 ? 'gl' : 'hm-lo'}" style="width:${p.score}%"></div>${p.scoreBefore != null ? `<i style="left:${p.scoreBefore}%"></i>` : ''}</div>
      <div class="hm-ph-list">
        ${kv('Muertes por partida', `<span class="${ddCls}">${fmtDec(p.deaths)}</span>${p.deathsBefore != null ? was(fmtDec(p.deathsBefore)) : ''}`)}
        ${kv('Partidas', p.games === n ? `${p.games}` : `${p.games} de ${n}`, p.games === n ? '' : 'Partidas analizadas que llegaron a esta fase')}
        ${p.key === 'early' ? kv('CS al minuto 10', p.cs10 != null ? `${p.cs10}` : '–', p.cs10 == null ? 'No hay línea de tiempo de estas partidas' : 'Media de súbditos a los 10 minutos') : ''}
        ${p.key === 'early' ? kv('Oro frente a tu rival al minuto 14', p.gold14 != null ? `<span class="${p.gold14 >= 0 ? 'good' : 'bad'}">${p.gold14 >= 0 ? '+' : ''}${fmtDec(p.gold14)}</span>` : '–', p.gold14 == null ? 'No se pudo identificar a tu rival de línea' : 'Diferencia media de oro con tu rival de línea a los 14 minutos') : ''}
      </div>
    </div>`;
  };
  return `<div class="hm-phases ${detail ? 'big' : ''}">${c.phases.map(cell).join('')}</div>`;
}

/** Pestaña "Coach a fondo": fases en detalle, tus fallos antes y ahora y tu rendimiento con cada campeón. */
function hmCoachDeep(c) {
  if (!c) return '<div class="skel" style="height:260px"></div>';
  if (c.error) return panel('Coach a fondo', 'book', `<div class="s dim">${esc(c.error)}</div>`);
  if (!c.analyzed) return panel('Coach a fondo', 'book', coachEmpty());
  const PH = { early: 'Fase de líneas', mid: 'Mitad de partida', late: 'Final' };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // Resumen: nota media ahora frente a antes
  const dAvg = c.avgScore != null && c.avgScoreBefore != null ? c.avgScore - c.avgScoreBefore : null;
  const sum = c.avgScore != null ? `<div class="hm-cd-sum">
      <div class="hm-cd-n"><span class="lbl">Nota media ahora ${EST}</span><div><b class="hm-cd-g g-${gradeOf(c.avgScore)}">${gradeOf(c.avgScore)}</b><span class="s muted">${c.avgScore}/100</span></div><span class="xs dim">tus ${c.analyzed} últimas partidas</span></div>
      ${dAvg != null ? `<div class="hm-cd-n"><span class="lbl">Antes</span><div><b class="hm-cd-g g-${gradeOf(c.avgScoreBefore)}">${gradeOf(c.avgScoreBefore)}</b><span class="s muted">${c.avgScoreBefore}/100</span></div><span class="xs dim">las ${c.analyzedBefore} anteriores</span></div>
      <div class="hm-cd-delta ${dAvg > 0 ? 'good' : dAvg < 0 ? 'bad' : ''}">${icon(dAvg > 0 ? 'up' : dAvg < 0 ? 'down' : 'swap')}<span>${dAvg > 0 ? `Subes ${dAvg} puntos` : dAvg < 0 ? `Bajas ${-dAvg} puntos` : 'Igual que antes'}</span></div>`
        : '<div class="xs dim" title="Hacen falta más partidas analizadas para comparar">Aún no hay partidas anteriores con las que comparar.</div>'}
    </div>` : '';

  // Tus fallos: en cuántas partidas te pasa ahora y antes
  const hab = c.habits?.length ? `<div class="hm-cd-hab">${c.habits.map((h) => `<div class="hm-cd-hr">
      <b class="ell" title="${esc(h.title)}">${esc(h.title)}</b>
      <div class="hm-cd-b" title="Ahora: en ${h.games} de tus ${h.of} últimas partidas"><span>Ahora</span><div class="bar"><div class="hm-lo" style="width:${pct(h.games, h.of)}%"></div></div><b>${h.games}/${h.of}</b></div>
      ${h.before != null ? `<div class="hm-cd-b" title="Antes: en ${h.before} de tus ${h.beforeOf} partidas anteriores"><span>Antes</span><div class="bar"><div class="gl" style="width:${pct(h.before, h.beforeOf)}%"></div></div><b>${h.before}/${h.beforeOf}</b></div>`
        : '<div class="hm-cd-b" title="No hay partidas anteriores analizadas"><span>Antes</span><span class="dim">Sin datos</span></div>'}
      <span class="hm-cd-tr">${trendChip(h.trend) || '<span class="xs dim">–</span>'}</span>
    </div>`).join('')}</div>` : `<div class="s muted">No hay ningún fallo que se repita en tus últimas partidas.${c.analyzed < COACH_FEW ? ' Con tan pocas partidas aún es pronto para sacar conclusiones.' : ''}</div>`;

  // Por campeón
  const champs = c.champs?.length ? `<div class="hm-cc">${c.champs.map((x) => {
    const wr = pct(x.wins, x.games);
    const g = gradeOf(x.score);
    return `<div class="hm-cc-r">
      <div class="hm-cc-who">${img(x.champ, 'm')}<div style="min-width:0"><b class="ell">${esc(x.champ?.name || '–')}</b><span class="xs dim">${x.games} partidas · <span class="${wrClass(wr)}">${wr}%</span> (${x.wins}V ${x.games - x.wins}D)</span></div></div>
      <div class="hm-cc-c"><span class="lbl">Nota ${EST}</span><span><b class="hm-cc-g g-${g}">${g}</b> <span class="xs dim">${x.score}/100</span></span></div>
      <div class="hm-cc-c"><span class="lbl">Muertes</span><b>${fmtDec(x.deaths)}</b></div>
      <div class="hm-cc-c"><span class="lbl">CS/min</span><b>${fmtDec(x.csMin)}</b></div>
      <div class="hm-cc-c"><span class="lbl">Peor fase</span>${x.weakPhase ? `<b>${esc(PH[x.weakPhase])}</b>` : '<b class="dim" title="No hay datos de fases de este campeón">–</b>'}</div>
      <div class="hm-cc-c hm-cc-iss"><span class="lbl">Fallo más repetido</span>${x.topIssue ? `<span class="row nw" style="gap:6px;min-width:0"><b class="ell" title="${esc(x.topIssue.title)}">${esc(x.topIssue.title)}</b><span class="xs dim">${x.topIssue.games}/${x.games}</span></span>` : '<b class="good">Nada que se repita</b>'}</div>
    </div>`;
  }).join('')}</div>` : '<div class="s muted">Hace falta jugar al menos 2 partidas con un campeón para verlo aquí.</div>';

  const total = c.analyzed + (c.analyzedBefore || 0);
  return panel('Coach a fondo', 'book', `${coachFew(c)}${sum}
    ${lbl('Por fase de la partida')}${coachPhases(c, { detail: true }) || '<div class="s muted">Sin datos de fases.</div>'}
    ${lbl('Tus fallos, antes y ahora')}${hab}
    ${lbl('Por campeón', `tus ${total} últimas ${esc(c.queueLabel || 'partidas')} analizadas · mínimo 2 partidas`)}${champs}`,
    { right: `<span title="Las notas de 0 a 100 las calcula la app con tus partidas: son una estimación, no un dato de Riot">Notas calculadas por la app ${EST}</span>` });
}

/** Con menos partidas analizadas que esto, el coach avisa de que la muestra es pequeña. */
const COACH_FEW = 5;

/** Estado vacío del coach: aún no hay ninguna partida analizada. */
function coachEmpty() {
  return `<div class="hm-tip">${icon('info')}<span>Aún no hay partidas analizadas: juega alguna clasificatoria en la Grieta de más de 15 minutos y aquí verás tus fallos y tus puntos fuertes.</span></div>`;
}

/** Aviso discreto cuando hay pocas partidas analizadas. */
function coachFew(c) {
  if (!c?.analyzed || c.analyzed >= COACH_FEW) return '';
  return `<div class="xs dim hm-few" title="Con menos de ${COACH_FEW} partidas, un mal día pesa mucho en las notas y los fallos">Muestra pequeña: solo ${c.analyzed} ${c.analyzed === 1 ? 'partida analizada' : 'partidas analizadas'}. Tómalo con cautela.</div>`;
}

/** Tu coach: los fallos que más se repiten, con un consejo para cada uno, y tus puntos fuertes. */
function hmCoach(c) {
  if (!on('home.coach')) return '';
  const body = !c ? '<div class="stack"><div class="skel" style="height:90px"></div><div class="skel" style="height:90px"></div><div class="skel" style="height:90px"></div></div>'
    : !c.analyzed ? coachEmpty()
    : !c.habits?.length ? (c.analyzed < COACH_FEW ? `<div class="hm-tip">${icon('info')}<span>De momento no se repite ningún fallo, pero con tan pocas partidas aún es pronto para sacar conclusiones.</span></div>`
      : `<div class="hm-tip">${icon('check')}<span>No hay ningún fallo que se repita en tus últimas partidas. Bien jugado.</span></div>`)
    : `<div class="hm-habits">${c.habits.map((h, i) => `<div class="hm-habit">
        <span class="hm-hn">${i + 1}</span>
        <div style="min-width:0">
          <div class="hm-ht"><b>${esc(h.title)}</b><span class="row nw" style="gap:6px">${trendChip(h.trend, h.before != null ? `Antes: ${h.before} de ${h.beforeOf} partidas` : '')}<span class="xs dim">${h.games}/${h.of} partidas</span></span></div>
          <div class="bar" style="height:4px;margin:7px 0"><div class="wn" style="width:${Math.round((h.games / h.of) * 100)}%"></div></div>
          ${h.example ? `<div class="xs dim">Ej.: ${esc(h.example)}</div>` : ''}
          <div class="hm-advice">${icon('bulb')}<span>${esc(h.tip)}</span></div>
        </div></div>`).join('')}</div>`;
  const strengths = c?.strengths?.length ? `${lbl('Tus puntos fuertes')}<div class="row">${c.strengths.map((x) => `<span class="chip sm good">${icon('check')}${esc(x.title)} <b>${x.games}/${x.of}</b></span>`).join('')}</div>` : '';
  const phases = c && on('home.coachPhases') ? coachPhases(c) : '';
  return panel('Tu coach', 'book', coachFew(c) + phases + body + strengths,
    { right: c?.avgScore != null ? `Nota media <b class="g-${gradeOf(c.avgScore)}">${gradeOf(c.avgScore)}</b> <span title="Nota de 0 a 100 que calcula la app con tus partidas analizadas">(${c.avgScore}/100) ${EST}</span> · ${c.analyzed} ${c.analyzed === 1 ? 'partida' : 'partidas'}` : '' });
}

/** Tus campeones y roles (pestaña de "Más detalles"). */
function hmChamps(p) {
  if (!p.champions.length) return '';
  return panel('Tus campeones', 'star', `<div class="hm-champs">
    <table class="tbl"><thead><tr><th>Campeón</th><th>Partidas</th><th>Winrate</th><th>KDA</th><th>CS/min</th></tr></thead><tbody>
      ${p.champions.map((ch) => `<tr><td><div class="row nw">${img(ch.champ, 's')}<b style="color:var(--text)">${esc(ch.champ?.name)}</b></div></td><td>${ch.games}</td><td class="wr ${wrClass(ch.winRate)}">${ch.winRate}%</td><td><b>${ch.kdaRatio}</b> <span class="xs dim">${esc(ch.kda)}</span></td><td>${ch.csMin}</td></tr>`).join('')}
    </tbody></table>
    ${p.roles.length ? `<div>${lbl('Roles')}${p.roles.map((r) => `<div class="role-row">${posIcon(r.pos)}<span>${esc(r.label)}</span><div class="bar"><div class="gl" style="width:${r.pct}%"></div></div><span class="s dim">${r.games}</span></div>`).join('')}</div>` : ''}
  </div>`, { right: p.summary ? esc(p.summary.label) : '' });
}

function viewHome(s) {
  if (s.summoner) { loadProfile(); loadTrends(); }
  const p = profileData;
  const me = s.summoner;
  if (!p) {
    return `<div class="stack" style="gap:16px"><div class="skel" style="height:150px;border-radius:22px"></div>
      <div class="skel" style="height:58px"></div>
      <div class="hm-now"><div class="skel" style="height:300px"></div><div class="skel" style="height:300px"></div><div class="skel" style="height:300px"></div></div>
      <div class="hm-duo"><div class="skel" style="height:380px"></div><div class="skel" style="height:380px"></div></div></div>`;
  }
  const c = coachData;

  // Ahora: sesión, objetivo y LP
  const now = [hmSession(p), hmGoal(p), hmLp(p)].filter(Boolean);

  // Rendimiento y coach
  const perf = hmPerf(p, trendsData);
  const coach = hmCoach(c);

  // Partidas recientes: las 5 últimas; el historial completo está en Historial
  const RECENT = 5;
  let recent = '';
  if (on('home.recent')) {
    loadGameSums(p.recent.slice(0, RECENT));
    recent = panel('Partidas recientes', 'history', p.recent.length ? `<div class="games">${p.recent.slice(0, RECENT).map((g) => gameRow(g)).join('')}</div>
      ${p.recent.length > RECENT ? `<button class="btn ghost sm hm-more-btn" onclick="go('games')">${icon('history')}Ver las ${p.recent.length} partidas</button>` : ''}`
      : '<div class="s dim">Sin partidas con este filtro.</div>', { right: p.recent.length ? 'Clic para ver el análisis' : '' });
  }

  // Más detalles, en pestañas. La proyección rápida de LP va en Progreso de LP si hay historial de Solo/Dúo.
  const lpOn = on('home.lpChart');
  const lpHtml = lpOn ? lpPanel(p.lp, p.forecast?.projection, { kpis: false, goalForm: !on('home.goal'), goalSummary: !on('home.goal') }) : '';
  const projInLp = !!(p.forecast?.projection && p.lp?.solo?.points.length && lpHtml);
  const tabs = [
    ['lp', 'Progreso de LP', 'up', lpHtml],
    ['trends', 'Tu evolución', 'chart', on('home.trends') ? trendsPanel(trendsData, 'Tu evolución', { insights: !(on('home.perf') && p.summary) }) : ''],
    ['forecast', 'Previsión de rango', 'target', on('home.forecast') ? forecastPanel(p.forecast, false, { projection: !projInLp }) : ''],
    ['champs', 'Campeones y roles', 'star', on('home.champs') ? hmChamps(p) : ''],
    ['coach', 'Coach a fondo', 'book', on('home.coachDeep') ? hmCoachDeep(c) : ''],
    ['deaths', 'Dónde mueres', 'skull', on('home.deathMap') ? deathMapPanel(c?.deathMap) : ''],
  ].filter((x) => x[3]);
  const cur = tabs.find((x) => x[0] === homeTab) || tabs[0];
  const more = cur ? `<section class="hm-more" id="hm-more">
      <div class="hm-more-h"><span class="hm-more-t">Más detalles</span><span class="seg hm-seg">${tabs.map(([k, l, ic]) => `<button class="${k === cur[0] ? 'on' : ''}" onclick="homeTab='${k}';render()">${icon(ic)}${l}</button>`).join('')}</span></div>
      ${cur[3]}
    </section>` : '';

  return `<div class="stack hm" style="gap:16px">${hmHero(p, me)}${profileFilterBar(p, 'setHomeFilter')}
    <div class="stack ${profileLoading ? 'busy' : ''}" style="gap:16px">
      ${now.length ? `<div class="hm-now n${now.length}">${now.join('')}</div>` : ''}
      ${perf || coach ? `<div class="hm-duo ${perf && coach ? '' : 'one'}">${perf}${coach}</div>` : ''}
      ${recent}
      ${more}
    </div></div>`;
}
