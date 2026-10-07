'use strict';
/* LoL Coach — Partida en directo (estilo iTero), alertas, voz y avisos emergentes. */

// ---------- En partida ----------
function scoreboard(g) {
  const allies = g.players.filter((p) => p.team === g.myTeam);
  const enemies = g.players.filter((p) => p.team !== g.myTeam);
  const T = g.teams;
  const total = T.ally.gold + T.enemy.gold || 1;
  const aPct = (T.ally.gold / total) * 100;
  const sp = (p) => `<div class="sb-p ${p.isMe ? 'me' : ''} ${p.isDead ? 'dead' : ''}" title="${esc(p.name)}">
    <div class="iw">${img(p.champ, '')}<span class="lv">${p.level}</span></div>${p.isDead ? `<div class="dead-t">${p.respawn}</div>` : ''}
    <div class="sb-kda">${p.kills}/${p.deaths}/${p.assists}</div><div class="sb-g">${fmtNum(p.gold)}</div></div>`;
  return `<section class="panel"><div class="scoreboard">
    <div class="sb-team">${allies.map(sp).join('')}</div>
    <div class="sb-mid">
      <div class="xs dim b" style="letter-spacing:.14em;text-transform:uppercase">Kills</div>
      <div class="sb-score"><span class="allyc">${T.ally.kills}</span><span class="sep">vs</span><span class="enemyc">${T.enemy.kills}</span></div>
      <div class="sb-goldbar"><div style="left:0;width:${aPct}%;background:var(--ally)"></div><div style="left:${aPct}%;right:0;background:var(--enemy)"></div><div class="mid"></div></div>
      <div class="s b ${g.goldDiff >= 0 ? 'good' : 'bad'}">${g.goldDiff >= 0 ? '+' : '−'}${fmtNum(Math.abs(g.goldDiff))} de oro en objetos</div>
    </div>
    <div class="sb-team enemy">${enemies.map(sp).join('')}</div>
  </div></section>`;
}

function teamCol(t, title, side) {
  return `<div>
    <div class="lbl ${side === 'ally' ? 'allyc' : 'enemyc'}" style="margin-bottom:8px">${title}</div>
    <div class="bar"><div class="ap" style="width:${t.ap}%"></div><div class="ad" style="width:${t.ad}%"></div></div>
    <div class="legend"><span class="ap">AP ${t.ap}%</span><span class="ad">AD ${t.ad}%</span></div>
    <div class="tags" style="margin-top:9px">${t.style.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>
    <div class="comp">
      ${t.tanks.length ? `<div>${icon('shield')}<span class="ell">${esc(t.tanks.join(', '))}</span></div>` : ''}
      ${t.assassins.length ? `<div>${icon('sword')}<span class="ell">${esc(t.assassins.join(', '))}</span></div>` : ''}
      ${t.mages.length ? `<div>${icon('wand')}<span class="ell">${esc(t.mages.join(', '))}</span></div>` : ''}
      ${t.marksmen.length ? `<div>${icon('crosshair')}<span class="ell">${esc(t.marksmen.join(', '))}</span></div>` : ''}
      ${t.healers.length ? `<div>${icon('heart')}<span class="ell">${esc(t.healers.join(', '))}</span></div>` : ''}
    </div>
  </div>`;
}

function pairSide(p, side) {
  if (!p) return '<div></div>';
  const sc = p.scout;
  return `<div class="ps ${side} ${p.isMe ? 'me' : ''} ${p.isDead ? 'dead' : ''}">
    <div class="iw">${img(p.champ, 'l')}<span class="lv">${p.level}</span></div>
    <div>
      <div class="pn">${posIcon(p.pos)}<span class="ell">${esc(p.champ.name)}</span></div>
      <div class="st"><b>${p.kills}/${p.deaths}/${p.assists}</b> · ${p.cs} CS · <span class="goldc">${fmtNum(p.gold)}</span>${p.isDead ? ` · <span class="bad">${p.respawn}s</span>` : ''}</div>
      ${sc ? `<div class="xs dim" style="margin-top:2px">${esc(sc.rank.text)}</div>${sc.tags.length ? `<div class="tags" style="margin-top:4px">${sc.tags.slice(0, 2).map((t) => tag(t, side)).join('')}</div>` : ''}` : ''}
      <div class="items" style="margin-top:6px">${p.items.map((i) => img(i, 'xs')).join('')}</div>
    </div>
  </div>`;
}

const alertKey = (a) => `${a.t}-${a.id}`;
const ALERT_ICON = { good: 'up', bad: 'alert', warn: 'flame', info: 'info' };

function toggleVoice() {
  setOpt('alerts.voice', !voiceOn);
}

// Voz, velocidad y volumen elegidos en Ajustes (dependen del PC, así que se guardan aquí)
let voicePrefs = (() => { try { return JSON.parse(localStorage.getItem('lolcoach.voicePrefs')) || {}; } catch { return {}; } })();
const VOICE_SAMPLES = [
  'Caitlyn ha completado Óptica hextech. Cuidado.',
  'Tienes la ulti antes que Caitlyn. Es tu momento.',
  'El dragón sale en treinta segundos.',
  'Tu rival ha muerto. Empuja la oleada.',
];

/** Voces del sistema, primero las de español. */
function esVoices() {
  if (!('speechSynthesis' in window)) return [];
  const all = window.speechSynthesis.getVoices();
  return [...all.filter((x) => x.lang?.startsWith('es')), ...all.filter((x) => !x.lang?.startsWith('es'))];
}
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { if (view === 'settings') render(); };

function setVoicePref(k, v) {
  voicePrefs[k] = v;
  try { localStorage.setItem('lolcoach.voicePrefs', JSON.stringify(voicePrefs)); } catch { /* opcional */ }
  testVoice();
}

/** Lee una alerta de ejemplo (cada vez una distinta), aunque la voz esté desactivada. */
function testVoice() {
  if (!('speechSynthesis' in window)) return toast('Este navegador no tiene voz', true);
  window.speechSynthesis.cancel();
  testVoice.i = ((testVoice.i ?? -1) + 1) % VOICE_SAMPLES.length;
  speak(VOICE_SAMPLES[testVoice.i]);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES';
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find((x) => x.voiceURI === voicePrefs.voice) || voices.find((x) => x.lang?.startsWith('es'));
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = voicePrefs.rate || 1.08;
  u.volume = voicePrefs.volume ?? 1;
  window.speechSynthesis.speak(u);
}

/** Registra las alertas nuevas (y las lee en voz alta si está activado). */
function trackAlerts(list) {
  const now = Date.now();
  const fresh = [];
  for (const a of list || []) {
    const k = alertKey(a);
    if (!alertSeen.has(k)) {
      alertSeen.set(k, now);
      fresh.push(a);
    }
  }
  // La primera vez que llega la lista (al abrir el panel a mitad de partida) no leemos el historial entero
  if (voiceOn && fresh.length && fresh.length < 4) fresh.slice().reverse().forEach((a) => speak(a.voice));
}

/** Avisos emergentes: las alertas recientes (y las fijadas). Se pueden mover, fijar y cerrar. */
function alertToasts() {
  const g = state?.inGame;
  if (state?.status !== 'ingame' || !g?.alerts?.length || !on('alerts.toasts')) return '';
  const now = Date.now();
  const age = (a) => now - (alertSeen.get(alertKey(a)) || 0);
  const shown = g.alerts.filter((a) => !toastClosed.has(alertKey(a)) && (toastPinned.has(alertKey(a)) || age(a) < ALERT_MS));
  const list = [...shown.filter((a) => toastPinned.has(alertKey(a))), ...shown.filter((a) => !toastPinned.has(alertKey(a))).slice(0, 3)];
  if (!list.length) return '';
  const pos = toastPos ? `left:${toastPos.x}px;top:${toastPos.y}px;right:auto` : '';
  return `<div class="toasts" id="toasts" style="${pos}">${list.map((a) => {
    const k = alertKey(a);
    const pinned = toastPinned.has(k);
    return `<div class="atoast ${a.type} ${pinned ? 'pinned' : ''}" style="--age:${Math.min(1, age(a) / ALERT_MS)}" title="Arrastra para mover">
    <span class="at-ic">${icon(a.icon || ALERT_ICON[a.type] || 'info')}</span><span class="at-tx"><b class="num">${fmtTime(a.t)}</b> ${esc(a.text)}</span>
    <span class="at-btns"><button class="${pinned ? 'on' : ''}" onclick="pinToast('${k}')" title="${pinned ? 'Soltar' : 'Fijar'}">${icon('pin')}</button><button onclick="closeToast('${k}')" title="Cerrar">${icon('x')}</button></span>
    ${pinned ? '' : '<span class="at-bar"></span>'}</div>`;
  }).join('')}</div>`;
}

function pinToast(k) {
  if (toastPinned.has(k)) { toastPinned.delete(k); alertSeen.set(k, Date.now()); } // al soltarla vuelve a contar el tiempo
  else toastPinned.add(k);
  render();
}
function closeToast(k) {
  toastPinned.delete(k);
  toastClosed.add(k);
  render();
}

// Arrastrar los avisos (se mueve el grupo entero; la posición se recuerda). Doble clic: volver a su sitio.
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.atoast');
  if (!t || e.target.closest('button') || e.button !== 0) return;
  const box = document.getElementById('toasts').getBoundingClientRect();
  toastDrag = { dx: e.clientX - box.left, dy: e.clientY - box.top, w: box.width };
  document.body.classList.add('dragging');
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!toastDrag) return;
  const el = document.getElementById('toasts');
  toastPos = {
    x: Math.round(Math.max(0, Math.min(window.innerWidth - toastDrag.w, e.clientX - toastDrag.dx))),
    y: Math.round(Math.max(0, Math.min(window.innerHeight - 60, e.clientY - toastDrag.dy))),
  };
  if (el) Object.assign(el.style, { left: toastPos.x + 'px', top: toastPos.y + 'px', right: 'auto' });
});
document.addEventListener('pointerup', () => {
  if (!toastDrag) return;
  toastDrag = null;
  document.body.classList.remove('dragging');
  try { localStorage.setItem('lolcoach.toastPos', JSON.stringify(toastPos)); } catch { /* opcional */ }
});
document.addEventListener('dblclick', (e) => {
  if (!e.target.closest('.atoast') || e.target.closest('button')) return;
  toastPos = null;
  try { localStorage.removeItem('lolcoach.toastPos'); } catch { /* opcional */ }
  render();
});

function alertsPanel(list) {
  if (!list?.length) return '';
  return panel('Alertas de la partida', 'alert', `<div class="stack" style="gap:5px">${list.map((a) => `<div class="insight ${a.type}">${icon(a.icon || ALERT_ICON[a.type] || 'info')}<span><b class="num">${fmtTime(a.t)}</b> · ${esc(a.text)}</span></div>`).join('')}</div>`,
    { right: `<button class="chip ${voiceOn ? 'gold' : ''}" onclick="toggleVoice()">${voiceOn ? '🔊 Voz activada' : '🔈 Activar voz'}</button>` });
}

function spikeCol(sp, who, name) {
  if (!sp) return '';
  const left = 6 - sp.level;
  const lvlTxt = sp.hasUlt ? (sp.nextLevel ? `Nivel ${sp.level} · R mejorada al ${sp.nextLevel}` : `Nivel ${sp.level}`) : `Nivel ${sp.level} · <b>sin R</b>: ${who === 'me' ? 'te' : 'le'} falta${left === 1 ? '' : 'n'} ${left} nivel${left === 1 ? '' : 'es'}`;
  return `<div class="spike ${who}">
    <div class="lbl ${who === 'me' ? 'goldc' : 'enemyc'}" style="margin-bottom:8px">${who === 'me' ? 'Tu próximo spike' : `Próximo spike de ${esc(name)}`}</div>
    ${sp.next ? `<div class="row nw" style="gap:10px">
        ${ring(52, 5, [{ v: sp.progress, color: who === 'me' ? 'var(--gold-2)' : 'var(--enemy)' }], img(sp.next, 's'))}
        <div style="min-width:0"><div class="b ell">${esc(sp.next.name)}</div>
          <div class="xs dim">${esc(sp.next.spike)}${sp.next.twoItem ? ' · gran spike' : ''}</div>
          <div class="s" style="margin-top:2px">${who === 'me' ? (sp.missing > 0 ? `Te faltan <b class="goldc">${sp.missing}</b> de oro` : '<b class="good">¡Puedes comprarlo!</b>') : `Le faltan <b>~${sp.remaining}</b> de oro`}</div></div></div>`
      : '<div class="s muted">Build principal completa</div>'}
    <div class="row" style="margin-top:8px;gap:4px">${sp.completed.map((i) => img(i, 'xs')).join('')}<span class="xs dim">${sp.itemsDone}/${sp.itemsTotal} objetos de la build</span></div>
    <div class="xs ${sp.hasUlt ? 'muted' : who === 'me' ? 'warn' : 'good'}" style="margin-top:6px">${lvlTxt}</div>
  </div>`;
}

function powerPanel(pw) {
  if (!pw) return '';
  const cls = { ahead: 'good', even: '', behind: 'bad' }[pw.verdict];
  const cmp = (k, a, b, fmt = (x) => x) => `<div class="pw-row"><span class="${a > b ? 'good b' : ''}">${fmt(a)}</span><span class="pw-k">${k}</span><span class="${b > a ? 'bad b' : ''}">${fmt(b)}</span></div>`;
  const w = Math.min(50, Math.abs(pw.score) * 8);
  return panel(`Tu línea vs ${esc(pw.opp?.name || 'rival')}`, 'swords', `
    <div class="pw-head"><div class="pw-v ${cls}">${esc(pw.title)}</div>
      <div class="pw-meter"><div style="${pw.score >= 0 ? `left:50%;width:${w}%;background:var(--win)` : `left:${50 - w}%;width:${w}%;background:var(--enemy)`}"></div><span></span></div></div>
    <div class="pw-vs">
      <div class="pw-face">${img(state.inGame.me.champ, 'l')}<span class="xs dim">Tú</span></div>
      <div class="pw-tbl">${cmp('Nivel', pw.me.level, pw.them.level)}${cmp('Objetos completos', pw.me.items, pw.them.items)}${cmp('Oro en objetos', pw.me.gold, pw.them.gold, fmtNum)}</div>
      <div class="pw-face">${img(pw.opp, 'l')}<span class="xs dim">Rival</span></div>
    </div>
    ${pw.spikes ? `<div class="spikes">${spikeCol(pw.spikes.me, 'me')}${spikeCol(pw.spikes.them, 'them', pw.opp?.name)}</div>` : ''}
    ${pw.reasons.length ? `<div class="stack" style="margin-top:12px">${pw.reasons.map((r) => `<div class="insight ${r.type}">${icon(r.type === 'good' ? 'up' : r.type === 'bad' ? 'alert' : 'info')}<span>${esc(r.text)}</span></div>`).join('')}</div>` : ''}`,
    { cls: pw.verdict === 'ahead' ? 'win-p' : pw.verdict === 'behind' ? 'danger' : '' });
}

/** Estimación en vivo: parte del draft y la corrige con el oro y los dragones (1k de oro pesa más al principio). */
function liveProb(g) {
  const base = Math.min(90, Math.max(10, g.teams.draft?.winProb ?? 50));
  const min = Math.max(5, gameTimeNow() / 60);
  const drakes = (g.objectives?.drakes.ally.length || 0) - (g.objectives?.drakes.enemy.length || 0);
  const x = Math.log(base / (100 - base)) + (g.goldDiff / 1000) * 0.28 * Math.sqrt(15 / min) + drakes * 0.12;
  return Math.min(97, Math.max(3, 100 / (1 + Math.exp(-x))));
}

function gameVerdict(p) {
  if (p >= 70) return { t: 'Gran ventaja', s: 'Cerrad la partida: objetivos y visión, sin regalar muertes.', c: 'good' };
  if (p >= 57) return { t: 'Vais por delante', s: 'Convertid la ventaja en torres y dragones.', c: 'good' };
  if (p > 43) return { t: 'Partida igualada', s: 'La decide la próxima pelea por un objetivo.', c: '' };
  if (p > 30) return { t: 'Vais por detrás', s: 'Jugad seguros y esperad a vuestro power spike.', c: 'bad' };
  return { t: 'Gran desventaja', s: 'Defended bajo torre, farmead y buscad un pick limpio.', c: 'bad' };
}

const OBJ_FRAME = { inhib: 1, baron: 2, dragon: 3, herald: 4, grubs: 5 };
function objTile(o, kind, cls = '') {
  if (!o) return '';
  return `<div class="timer mini obj-${kind} ${cls}" data-at="${o.at}"><span class="ti"><span class="objic" style="--f:${OBJ_FRAME[kind]}"></span></span><span class="ell">${esc(o.label)}</span><span class="t"></span></div>`;
}

function stateHero(g) {
  const T = g.teams;
  const p = liveProb(g);
  const v = gameVerdict(p);
  const total = T.ally.gold + T.enemy.gold || 1;
  const aPct = (T.ally.gold / total) * 100;
  const O = g.objectives;
  const drakes = (list, side) => list.map((d) => `<span class="drk ${side}" title="${esc(d)}">${esc(d.slice(0, 1))}</span>`).join('') || '<span class="xs dim">—</span>';
  const timers = on('live.objectives') && O ? `${objTile(O.dragon, 'dragon')}${objTile(O.grubs, 'grubs')}${objTile(O.herald, 'herald')}${objTile(O.baron, 'baron')}${(O.inhibs || []).map((i) => objTile(i, 'inhib', i.team)).join('')}` : '';
  return `<section class="panel gs-hero gs-${v.c || 'even'}">
    <div class="gs-prob">${ring(118, 10, [{ v: p, color: 'var(--ally)' }, { v: 100 - p, color: 'var(--enemy)' }], `<div class="dsp" style="font-size:31px">${Math.round(p)}%</div><div class="xs dim b gs-cap">Ahora</div>`)}
      ${T.draft ? `<div class="xs dim" title="Probabilidad según el draft, antes de empezar">Draft ${T.draft.winProb.toFixed(1)}%</div>` : ''}</div>
    <div class="gs-mid">
      <div class="gs-v ${v.c}">${v.t}</div>
      <div class="s muted">${v.s}</div>
      <div class="gs-score">
        <div class="gs-side"><span class="lbl allyc">Tu equipo</span><span class="dsp allyc">${T.ally.kills}</span></div>
        <div class="gs-gold">
          <div class="gs-gl"><span class="num">${fmtNum(T.ally.gold)}</span><b class="${g.goldDiff >= 0 ? 'good' : 'bad'}">${g.goldDiff >= 0 ? '+' : '−'}${fmtNum(Math.abs(g.goldDiff))} oro</b><span class="num">${fmtNum(T.enemy.gold)}</span></div>
          <div class="sb-goldbar"><div style="left:0;width:${aPct}%;background:var(--ally)"></div><div style="left:${aPct}%;right:0;background:var(--enemy)"></div><div class="mid"></div></div>
          ${O ? `<div class="gs-drk"><span>${drakes(O.drakes.ally, 'ally')}</span><span class="xs dim">Dragones</span><span>${drakes(O.drakes.enemy, 'enemy')}</span></div>` : ''}
        </div>
        <div class="gs-side r"><span class="lbl enemyc">Rival</span><span class="dsp enemyc">${T.enemy.kills}</span></div>
      </div>
    </div>
    ${timers ? `<div class="gs-obj">${timers}</div>` : ''}
  </section>`;
}

function laneSide(p, side) {
  if (!p) return '<div></div>';
  const sc = p.scout;
  return `<div class="ln-p ${side} ${p.isMe ? 'me' : ''} ${p.isDead ? 'dead' : ''}">
    <div class="iw">${img(p.champ, 'm')}<span class="lv">${p.level}</span>${p.isDead ? `<span class="rsp">${p.respawn}</span>` : ''}</div>
    <div class="ln-i">
      <div class="pn">${posIcon(p.pos)}<span class="ell">${esc(p.isMe ? 'Tú' : p.champ.name)}</span>${sc?.tags?.[0] ? tag(sc.tags[0], side) : ''}</div>
      <div class="st"><b>${p.kills}/${p.deaths}/${p.assists}</b> · ${p.cs} CS</div>
      <div class="items">${p.items.filter((i) => i.gold > 0 || i.id !== 3363).slice(0, 8).map((i) => img(i, 'xs')).join('')}</div>
    </div>
  </div>`;
}

function lanesPanel(g) {
  const T = g.teams;
  const max = Math.max(1500, ...T.pairs.map((x) => Math.abs(x.diff)));
  const rows = T.pairs.map((pr) => {
    const w = (Math.abs(pr.diff) / max) * 50;
    return `<div class="ln ${g.players[pr.ally]?.isMe ? 'mine' : ''}">${laneSide(g.players[pr.ally], 'ally')}
      <div class="ln-d"><b class="${pr.diff > 0 ? 'good' : pr.diff < 0 ? 'bad' : 'dim'}">${pr.diff > 0 ? '+' : pr.diff < 0 ? '−' : '±'}${fmtNum(Math.abs(pr.diff))}</b>
        <div class="ln-bar"><div style="${pr.diff >= 0 ? `right:50%;width:${w}%;background:var(--ally)` : `left:50%;width:${w}%;background:var(--enemy)`}"></div><span></span></div></div>
      ${laneSide(g.players[pr.enemy], 'enemy')}</div>`;
  }).join('');
  return panel(g.aram ? 'Jugador a jugador' : 'Línea a línea', 'users', `<div class="lanes">${rows}</div>`, { right: g.aram ? 'Emparejados por oro' : 'Diferencia de oro en objetos' });
}

function nextBuyPanel(g) {
  const sh = g.shopping;
  const have = sh ? Math.max(0, sh.remaining - sh.missing) : 0;
  const pct = sh && sh.remaining ? (have / sh.remaining) * 100 : 100;
  const body = sh ? `<div class="nb">
      ${ring(64, 5, [{ v: pct, color: 'var(--gold-2)' }], img(sh.target, ''))}
      <div style="min-width:0;flex:1"><div class="b ell">${esc(sh.target.name)}</div>
        <div class="s muted">${sh.missing > 0 ? `Faltan <b class="goldc">${sh.missing}</b> de oro` : '<b class="good">Puedes comprarlo</b>'}</div>
        ${sh.why ? `<div class="xs warn" style="margin-top:2px">${esc(sh.why)}</div>` : ''}</div>
      ${sh.buyNow.length && sh.missing > 0 ? `<div class="nb-now" title="Con tu oro ahora (${sh.spend})">${sh.buyNow.map((i) => img(i, 's')).join('')}</div>` : ''}
    </div>
    <div class="nb-order">${g.buildOrder.map((i) => `<div class="iw">${img(i, i.owned ? 'xs dim' : 'xs')}</div>`).join('')}</div>`
    : g.buildOrder.length ? '<div class="s muted">Build completa.</div>' : '<div class="skel" style="height:64px"></div>';
  const sit = on('live.situational') ? [
    ...(g.bootsSwap ? [{ item: g.bootsSwap.item, reason: g.bootsSwap.reason, priority: 2 }] : []),
    ...g.situational,
  ] : [];
  return panel('Siguiente compra', 'cart', `${body}
    ${sit.length ? `<div class="nb-sit">${sit.map((s) => `<div class="nb-s ${s.priority >= 3 ? 'urgent' : ''}">${img(s.item, 's')}<div style="min-width:0"><div class="s b ell">${esc(s.item.name)}</div><div class="xs dim ell" title="${esc(s.reason)}">${esc(s.reason)}</div></div></div>`).join('')}</div>` : ''}`,
    { right: `<span class="chip gold sm">${icon('coins')}<b class="goldc">${g.me.gold}</b></span>` });
}

// ---------- Partida en directo, al estilo iTero ----------
/** Color de una puntuación 0-5 (2.5 = normal). */
const scCls = (v) => (v == null ? 'it-n' : v >= 3.3 ? 'it-g' : v >= 2 ? 'it-y' : 'it-r');
const scTxt = (v) => (v == null ? '—' : Number(v).toFixed(1));
const info = (t) => `<span class="it-i" title="${esc(t)}">i</span>`;

/** Dos iconos superpuestos (tú + otro), con la puntuación debajo. */
function itPair(meChamp, other, score, sub) {
  return `<div class="it-pair" title="${esc(other.champ?.name || '')}${sub ? ' · ' + esc(sub) : ''}">
    <div class="it-pi">${img(meChamp, 'it-a')}${img(other.champ, 'it-b')}${other.pos ? `<span class="it-pos">${posIcon(other.pos)}</span>` : ''}</div>
    <b class="${scCls(score)}">${score == null ? '–' : scTxt(score)}</b></div>`;
}

function itRow(label, tip, value, cls = null) {
  return `<div class="it-row"><span>${label} ${tip ? info(tip) : ''}</span><b class="${cls || scCls(value)}">${typeof value === 'number' ? scTxt(value) : value ?? '—'}</b></div>`;
}

function itVsRow(label, tip, my, enemy, fmt = (x) => x) {
  return `<div class="it-row it-vs2"><span>${label} ${tip ? info(tip) : ''}</span>
    <span class="it-col2"><small>Tu equipo</small><b class="it-g">${my == null ? '—' : fmt(my)}</b></span>
    <span class="it-col2"><small>Rival</small><b class="${enemy != null && my != null && enemy > my ? 'it-r' : 'it-y'}">${enemy == null ? '—' : fmt(enemy)}</b></span></div>`;
}

/** Rastreador de oro (como el overlay de iTero): oro en objetos de cada pareja con la diferencia en el centro. */
function itGold(g) {
  const T = g.teams;
  const diamond = (d, big = false) => {
    const ally = d >= 0;
    const arrows = Math.abs(d) >= 1000 ? 2 : Math.abs(d) >= 150 ? 1 : 0;
    const ch = (dir) => `<span class="it-ch ${ally ? 'al' : 'en'}">${(dir === 'l' ? '‹' : '›').repeat(arrows)}</span>`;
    return `<div class="it-dm ${big ? 'big' : ''}">${ally ? ch('l') : '<span class="it-ch"></span>'}<div class="it-dmi ${ally ? 'al' : 'en'}"><span>${fmtNum(Math.abs(d))}</span></div>${!ally ? ch('r') : '<span class="it-ch"></span>'}</div>`;
  };
  const rows = T.pairs.map((pr) => {
    const a = g.players[pr.ally];
    const e = g.players[pr.enemy];
    if (!a || !e) return '';
    return `<div class="it-gr ${a.isMe ? 'me' : ''}">
      <div class="it-gs">${img(a.champ, 'it-gi')}<span class="num">${fmtNum(a.gold)}</span></div>
      ${diamond(pr.diff)}
      <div class="it-gs r"><span class="num">${fmtNum(e.gold)}</span>${img(e.champ, 'it-gi')}</div></div>`;
  }).join('');
  return `<div class="it-box">
    <div class="it-gr top"><div class="it-gs"><span class="it-tn al">Tu equipo</span><span class="num">${fmtNum(T.ally.gold)}</span></div>${diamond(g.goldDiff, true)}<div class="it-gs r"><span class="num">${fmtNum(T.enemy.gold)}</span><span class="it-tn en">Rival</span></div></div>
    ${rows}
    <div class="it-foot">Oro en objetos de cada jugador frente a su rival de línea</div>
  </div>`;
}

function viewInGame(g) {
  const it = g.itero;
  const T = g.teams;
  const d = T.draft;
  const me = g.players.find((p) => p.isMe);
  const allies = g.players.filter((p) => p.team === g.myTeam);
  const enemies = g.players.filter((p) => p.team !== g.myTeam);
  const p = liveProb(g);
  const overall = d ? Math.max(0, Math.min(5, ((d.winProb - 40) / 20) * 5)) : null;

  // ---- Barra superior: tu equipo VS rival ----
  const icon5 = (list, side) => list.map((x) => `<div class="it-ti ${x.isMe ? 'me' : ''} ${x.isDead ? 'dead' : ''} ${side}" title="${esc(x.champ?.name || '')} · ${x.kills}/${x.deaths}/${x.assists}">${img(x.champ, '')}${x.isDead ? `<span class="it-rs">${x.respawn}</span>` : `<span class="it-lv">${x.level}</span>`}</div>`).join('');
  const top = `<div class="it-top">
    <div class="it-teamrow">${icon5(allies, 'al')}</div>
    <div class="it-mid"><div class="it-k"><b class="al">${T.ally.kills}</b><span>VS</span><b class="en">${T.enemy.kills}</b></div><div class="it-clock num" id="gtime">${fmtTime(g.gameTime)}</div></div>
    <div class="it-teamrow">${icon5(enemies, 'en')}</div>
    ${on('live.draft') ? `<div class="it-prob" title="Probabilidad de victoria estimada ahora mismo (draft + oro + dragones)"><b class="${p >= 55 ? 'it-g' : p <= 45 ? 'it-r' : 'it-y'}">${Math.round(p)}%</b><small>Victoria</small></div>` : ''}
  </div>`;

  // ---- Columna izquierda: tu campeón ----
  const sit = on('live.situational') ? [...(g.bootsSwap ? [{ item: g.bootsSwap.item, reason: g.bootsSwap.reason, priority: 2 }] : []), ...g.situational] : [];
  const sh = g.shopping;
  const left = `
    <div class="it-box it-name">${img(g.me.champ, 's')}<b>${esc(g.me.champ?.name || '')}</b><span class="it-sub">${esc(POS[g.me.pos] || '')} · Nivel ${g.me.level}</span></div>
    <div class="it-tabs">
      <div class="it-tab"><div class="it-th">Puntuación general ${info('Lo bien que pinta tu draft (0-5; 2.5 = partida igualada)')}</div><b class="${scCls(overall)}">${scTxt(overall)}</b></div>
      <div class="it-tab"><div class="it-th">Fase de líneas ${info('Fuerza de tu campeón en early y matchup contra tu rival (0-5)')}</div><b class="${scCls(it?.me?.laning)}">${scTxt(it?.me?.laning)}</b></div>
    </div>
    <div class="it-box it-kv">
      <div><span>Maestría ${info('Puntos de maestría con este campeón')}</span><b class="${(it?.me?.mastery || 0) >= 100000 ? 'it-g' : (it?.me?.mastery || 0) >= 20000 ? 'it-y' : 'it-r'}">${it?.me ? (it.me.mastery ? fmtNum(it.me.mastery) : '0') : '—'}</b></div>
      <div><span>WR del campeón ${info('Winrate de tu campeón en tu rol este parche')}</span><b class="${it?.me?.champWr != null ? (it.me.champWr >= 51 ? 'it-g' : it.me.champWr >= 49 ? 'it-y' : 'it-r') : 'it-n'}">${it?.me?.champWr != null ? it.me.champWr + '%' : '—'}</b></div>
      <div><span>Sinergia media ${info('Media de lo bien que combinas con tus aliados (0-5)')}</span><b class="${scCls(it?.me?.synergyAvg)}">${scTxt(it?.me?.synergyAvg)}</b></div>
      <div><span>Counter medio ${info('Media de tus matchups contra los rivales (0-5)')}</span><b class="${scCls(it?.me?.counterAvg)}">${scTxt(it?.me?.counterAvg)}</b></div>
    </div>
    <div class="it-box it-kv">
      <div><span>Ratio AD ${info('Porcentaje de daño físico de tu equipo')}</span><b class="${T.ally.ad >= 75 || T.ally.ad <= 25 ? 'it-r' : 'it-y'}">${T.ally.ad}%</b></div>
      <div><span>Ventaja early ${info('Fuerza de tu equipo frente al rival al principio de la partida (0-5)')}</span><b class="${scCls(it?.team?.early)}">${scTxt(it?.team?.early)}</b></div>
    </div>
    ${on('live.buy') && !g.spectator ? `<div class="it-sec">Build</div>
    <div class="it-box">
      ${sh ? `<div class="it-buy">${img(sh.target, 'm')}<div style="min-width:0;flex:1"><div class="b ell">${esc(sh.target.name)}</div><div class="xs">${sh.missing > 0 ? `Te faltan <b class="it-y">${sh.missing}</b> de oro` : '<b class="it-g">Puedes comprarlo</b>'}</div></div><span class="it-goldc">${icon('coins')}${g.me.gold}</span></div>` : '<div class="xs dim">Build completa</div>'}
      <div class="it-order">${g.buildOrder.map((i) => img(i, i.owned ? 'xs dim' : 'xs')).join('<span class="it-arr">›</span>')}</div>
      ${sit.length ? `<div class="it-sit">${sit.map((s) => `<div class="it-si ${s.priority >= 3 ? 'urg' : ''}">${img(s.item, 'xs')}<span class="ell" title="${esc(s.reason)}">${esc(s.item.name)}</span><small class="ell">${esc(s.reason)}</small></div>`).join('')}</div>` : ''}
    </div>` : ''}
    ${on('live.skills') ? `<div class="it-sec">Habilidades</div><div class="it-box">${g.skill ? `<div class="it-skup"><b>${g.skill.key}</b> Sube la ${g.skill.key}</div>` : ''}${skillGrid(g.skillOrder, g.me.level)}${g.skillMax.length ? `<div class="xs dim" style="margin-top:6px">Maximiza ${g.skillMax.join(' › ')}</div>` : ''}</div>` : ''}`;

  // ---- Columna central: fase de líneas y equipos ----
  const pw = g.power;
  const sp = pw?.spikes;
  const opp = it?.laning?.opp;
  const mid = `
    ${on('live.draft') ? `<div class="it-sec">Probabilidad de victoria</div><div class="it-box">${probChart(g.probHistory, { height: 130, note: 'Estimación con el draft, el oro y los dragones; un punto cada 30 s.' })}</div>` : ''}
    ${on('live.power') ? `<div class="it-sec">Fase de líneas</div>
    <div class="it-box">
      ${itRow('Fuerza en línea', 'Winrate de tu campeón en los primeros minutos (0-5)', it?.laning?.strength)}
      <div class="it-subh">Matchup de línea ${info('Tu winrate contra tu rival de línea (0-5)')}</div>
      ${opp ? `<div class="it-mu">${itPair(g.me.champ, { champ: opp.champ }, opp.score)}<div class="xs dim">${opp.wr != null ? `${opp.wr}% de victorias en ${fmtNum(opp.games)} partidas` : 'Sin datos del matchup'}</div></div>` : '<div class="xs dim" style="padding:6px 0">Sin rival de línea claro</div>'}
      ${pw ? `<div class="it-pw ${pw.verdict}"><b>${esc(pw.title)}</b>
        <div class="it-pwr">${itRow('Nivel', null, `${pw.me.level} vs ${pw.them.level}`, pw.me.level >= pw.them.level ? 'it-g' : 'it-r')}
        ${itRow('Objetos completos', null, `${pw.me.items} vs ${pw.them.items}`, pw.me.items >= pw.them.items ? 'it-g' : 'it-r')}
        ${sp?.me?.next ? itRow('Tu próximo spike', null, `${esc(sp.me.next.name)}`, 'it-g') : ''}
        ${sp?.them?.next ? itRow(`Spike de ${esc(pw.opp?.name || 'rival')}`, null, `${esc(sp.them.next.name)} (~${sp.them.remaining})`, 'it-r') : ''}</div></div>` : ''}
    </div>` : ''}
    ${on('live.comps') ? `<div class="it-sec">Estadísticas de equipo</div>
    <div class="it-box it-acc">
      ${itRow('Ventaja early', 'Fuerza de tu equipo frente al rival hasta el minuto 25 (0-5)', it?.team?.early)}
      ${itRow('Ventaja mid', 'Entre el minuto 25 y el 35 (0-5)', it?.team?.mid)}
      ${itRow('Ventaja late', 'A partir del minuto 35 (0-5)', it?.team?.late)}
      ${itVsRow('Ratio AD', 'Porcentaje de daño físico', T.ally.ad, T.enemy.ad, (x) => x + '%')}
      ${itVsRow('Daño total', 'Daño de cada equipo según las valoraciones de Riot (0-5)', it?.team?.damage?.my, it?.team?.damage?.enemy, (x) => x.toFixed(1))}
      ${itVsRow('Tanqueza', 'Lo duro de matar que es cada equipo (0-5)', it?.team?.tankiness?.my, it?.team?.tankiness?.enemy, (x) => x.toFixed(1))}
    </div>` : ''}
    ${on('live.objectives') && g.objectives ? `<div class="it-sec">Objetivos</div><div class="it-box it-objs">${objTile(g.objectives.dragon, 'dragon')}${objTile(g.objectives.grubs, 'grubs')}${objTile(g.objectives.herald, 'herald')}${objTile(g.objectives.baron, 'baron')}${(g.objectives.inhibs || []).map((i) => objTile(i, 'inhib', i.team)).join('')}
      <div class="it-drk"><span class="xs dim">Dragones</span>${g.objectives.drakes.ally.map((x) => `<span class="it-dk al">${esc(x)}</span>`).join('')}<span class="sp"></span>${g.objectives.drakes.enemy.map((x) => `<span class="it-dk en">${esc(x)}</span>`).join('')}</div></div>` : ''}
    ${on('live.insights') && T.insights.length ? `<div class="it-sec">Claves</div><div class="it-box">${T.insights.map((i) => `<div class="it-ins ${i.type}">${esc(i.text)}</div>`).join('')}</div>` : ''}`;

  // ---- Columna derecha: sinergias, counters, oro ----
  const right = `
    ${it && !it.aram ? `<div class="it-box">
      <div class="it-bh"><span>Sinergia media ${info('Cómo combinas con cada aliado (0-5; 2.5 = normal)')}</span><b class="${scCls(it.me.synergyAvg)}">${scTxt(it.me.synergyAvg)}</b></div>
      <div class="it-pairs">${it.synergy.map((s) => itPair(g.me.champ, s, s.score, s.wr != null ? `${s.wr}% juntos (${fmtNum(s.games)} partidas)` : 'Sin datos')).join('')}</div>
    </div>
    <div class="it-box">
      <div class="it-bh"><span>Counter medio ${info('Tu matchup contra cada rival (0-5; más alto = mejor para ti)')}</span><b class="${scCls(it.me.counterAvg)}">${scTxt(it.me.counterAvg)}</b></div>
      <div class="it-pairs">${it.counters.map((c) => itPair(g.me.champ, c, c.score, c.wr != null ? `${c.wr}% de victorias (${fmtNum(c.games)} partidas)` : 'Sin datos: no suelen enfrentarse')).join('')}</div>
    </div>` : !it ? '<div class="it-box"><div class="skel" style="height:150px"></div></div>' : ''}
    ${on('live.pairs') ? `<div class="it-sec">Oro por línea</div>${itGold(g)}` : ''}
    ${on('live.alertsPanel') && g.alerts?.length ? `<div class="it-sec">Alertas</div><div class="it-box">${g.alerts.map((a) => `<div class="it-ins ${a.type}"><b class="num">${fmtTime(a.t)}</b> ${esc(a.text)}</div>`).join('')}</div>` : ''}
    ${on('live.spells') ? `<div class="it-sec">Hechizos rivales</div><div class="it-box"><div class="spl-grid">${enemies.map((x) => `<div class="spl">${img(x.champ, 's')}
      ${x.spells.map((s) => `<button class="spell-btn" data-timer="${esc(`${x.champ.name}|${s.key}`)}" data-cd="${s.cooldown}" title="${esc(x.champ.name)} · ${esc(s.name)} (${s.cooldown}s) · clic cuando lo gaste">${img(s, '')}<span class="cd" style="display:none"></span></button>`).join('')}</div>`).join('')}</div></div>` : ''}`;

  const notes = [
    g.spectator ? `<div class="note info">${icon('play')}<span>Modo espectador: estás viendo a <b>${esc(g.spectator.name)}</b> (${esc(g.spectator.champ)}) con unos 3 minutos de retraso.</span></div>` : '',
    g.unknownChamp ? `<div class="note">${icon('alert')}<span>No he podido reconocer tu campeón: no muestro objetos situacionales.</span></div>` : '',
    g.notes && (g.notes.matchup || g.notes.general) ? `<div class="note">${icon('book')}<span><b>Tus notas vs ${esc(g.notes.vs.name)}:</b> ${esc((g.notes.matchup || g.notes.general)?.text || '')}</span></div>` : '',
  ].join('');

  return `<div class="it">${notes}${top}<div class="it-grid"><div class="it-c">${left}</div><div class="it-c">${mid}</div><div class="it-c">${right}</div></div></div>`;
}
