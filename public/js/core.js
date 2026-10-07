'use strict';
/* LoL Coach — Estado global, utilidades, iconos y piezas básicas (imágenes, paneles, anillos…). */

/* ==========================================================================
   LoL Coach — interfaz v3
   El estado llega por SSE; la vista se re-pinta con morphdom (solo cambia lo que cambia).
   ========================================================================== */

const $root = document.getElementById('root');
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins';
const POS = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const POS_FILE = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };
const PHASES = { PLANNING: 'Planificación', BAN_PICK: 'Bans y picks', FINALIZATION: 'Últimos segundos' };

let state = null;
let receivedAt = 0;
let view = 'home'; // 'home' | 'live' | 'games'
let runeTab = 0;
let lpQueue = 'solo';
let selectedGame = null;
let gameList = null;
let profileData = null;
let coachData = null;
let profileAt = 0;
let poolData = null;
let notesAll = null;
const notesCache = new Map(); // "me:vs" -> { matchup, general, history }
let selectedPlayer = null; // puuid del jugador cuyo análisis estás viendo (null = tú)
const playerCache = new Map();
const anKey = (id, puuid = null) => `${id}:${puuid || ''}`;
let trendsData = null;
let searchQ = '';
let searchRes = null; // perfil del jugador buscado | 'loading' | { error }
let searchCoach = null;
let searchTrends = null;
let searchGame = null;
let replayTimer = null;
const alertSeen = new Map(); // clave de alerta -> momento (ms) en que la vimos por primera vez
const ALERT_MS = 12000;
const toastPinned = new Set(); // alertas fijadas (no desaparecen solas)
const toastClosed = new Set(); // alertas cerradas con la X
let toastPos = (() => { try { return JSON.parse(localStorage.getItem('lolcoach.toastPos')) || null; } catch { return null; } })();
let toastDrag = null;
let voiceOn = false; // se sincroniza con Ajustes > Alertas > Voz
/** ¿Está activado este ajuste? ("live.pairs") Por defecto, sí. */
const on = (p) => {
  const [g, k] = p.split('.');
  return state?.settings?.[g]?.[k] !== false;
};
async function setOpt(path, value) {
  const [g, k] = path.split('.');
  if (state?.settings?.[g]) state.settings[g][k] = value; // respuesta inmediata en pantalla
  if (path === 'alerts.voice') { voiceOn = value; if (value) speak('Avisos por voz activados'); else window.speechSynthesis?.cancel(); }
  render();
  try {
    const r = await (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, value }) })).json();
    if (r.error) toast(r.error, true);
  } catch {
    toast('No se pudo guardar el ajuste', true);
  }
}
async function resetSettings() {
  try {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) });
    toast('Ajustes restaurados');
  } catch {
    toast('No se pudieron restaurar los ajustes', true);
  }
}
let mapView = null; // explorador del mapa: { gameId, data, minute, playing, layers, tab, focus }
const mapCache = new Map();
let mapTimer = null;
const analyses = new Map();
const spellTimers = new Map(); // "campeón|hechizo" -> tiempo de partida en que vuelve a estar listo

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtNum = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const signed = (v, unit = '%') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}${unit}`;
const gradeOf = (x) => (x >= 85 ? 'S' : x >= 70 ? 'A' : x >= 55 ? 'B' : x >= 40 ? 'C' : 'D');
const wrClass = (x, hi = 52, lo = 48) => (x == null ? '' : x >= hi ? 'good' : x <= lo ? 'bad' : '');

function timeAgo(ts) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

// ---------- iconos (SVG propios, trazo de 24 px) ----------
const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  live: 'M12 13a1 1 0 100-2 1 1 0 000 2zM8.5 15.5a5 5 0 010-7M15.5 8.5a5 5 0 010 7M5.6 18.4a9 9 0 010-12.8M18.4 5.6a9 9 0 010 12.8',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2',
  sword: 'M14.5 4H20v5.5L9 20.5 3.5 15zM6 18l-3 3M12.5 7.5l4 4',
  swords: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5L18 3h3v3l-3.5 8.5M5 14l-2 2 2 2 2-2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  coins: 'M12 21a9 9 0 100-18 9 9 0 000 18zM14.8 9.2c-.4-.8-1.5-1.4-2.8-1.4-1.7 0-3 .9-3 2s1.3 1.7 3 2.1 3 1 3 2.1-1.3 2-3 2c-1.3 0-2.4-.6-2.8-1.4M12 6v1.8M12 16.2V18',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  skull: 'M6 15.5A8 8 0 1118 15.5V19a1 1 0 01-1 1H7a1 1 0 01-1-1zM9 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM15 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM10 20v-2.5M14 20v-2.5',
  flame: 'M12 22a6 6 0 006-6c0-4.5-3.5-6.5-4.5-11-2.5 2-4 4.5-3.5 8-1-.5-2-1.5-2-3-1.5 1.5-2 3.5-2 6a6 6 0 006 6z',
  up: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  down: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 13a1 1 0 100-2 1 1 0 000 2z',
  crosshair: 'M12 21a9 9 0 100-18 9 9 0 000 18zM22 12h-4M6 12H2M12 6V2M12 22v-4',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  burst: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8M12 15a3 3 0 100-6 3 3 0 000 6z',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.7A4 4 0 0119 10c0 5.6-7 10-7 10z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  wand: 'M15 4V2M15 10V8M11 6H9M21 6h-2M18.5 3.5L17 5M18.5 8.5L17 7M3 21l12-12',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.8 10.6c.6.6.8 1.4.8 2.4h6c0-1 .2-1.8.8-2.4A6 6 0 0012 3z',
  cart: 'M3 4h2.2l2.3 11a1 1 0 001 .8h9.4a1 1 0 001-.8L20.5 8H6.3M9 20.5h.01M17 20.5h.01',
  dice: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01M15.5 8.5h.01M8.5 15.5h.01',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M16 3.5a4 4 0 010 7.5M22 21a7 7 0 00-4.5-6.5',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  ban: 'M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5zM4 19.5A2.5 2.5 0 006.5 22H20v-5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  rune: 'M12 2l8 5v10l-8 5-8-5V7zM12 7v10M8 9.5l8 5M16 9.5l-8 5',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0zM12 18v4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  x: 'M6 6l12 12M18 6L6 18',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 017 0V11',
  pin: 'M12 16v6M8 3h8l-1.5 6.5L18 13H6l3.5-3.5z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M8 5v14M16 5v14',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 006 0zM19 7l-3 7a3.5 3.5 0 006 0zM8 21h8',
};
const icon = (name, cls = '') => `<svg class="svg ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.info}"/></svg>`;

const LOGO = `<svg class="rail-logo" viewBox="0 0 40 40" aria-hidden="true">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d79c"/><stop offset="1" stop-color="#b9914b"/></linearGradient></defs>
  <path d="M20 1.5l16.5 9.5v18L20 38.5 3.5 29V11z" fill="#0e131c" stroke="url(#lg)" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M20 9l9.5 16.5h-19z" fill="url(#lg)"/><path d="M20 17l3.6 6.3h-7.2z" fill="#0e131c"/>
</svg>`;

// ---------- piezas ----------
function img(o, cls = '') {
  if (!o?.icon) return `<span class="ic ic-ph ${cls}" ${o?.name ? `title="${esc(o.name)}"` : ''}></span>`;
  return `<img class="ic ${cls}" src="${esc(o.icon)}" alt="${esc(o.name)}" title="${esc(o.name)}${o.gold ? ' · ' + o.gold + ' de oro' : ''}" loading="lazy">`;
}
const posIcon = (pos, cls = 'pos-ic') => (POS_FILE[pos] ? `<img class="${cls}" src="${CDRAGON}/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${POS_FILE[pos]}.png" alt="${POS[pos]}" title="${POS[pos]}">` : '');
const emblem = (tier) => (tier ? `<span class="rank-emb"><img src="${CDRAGON}/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png" alt=""></span>` : '<span class="rank-emb"></span>');
const wr = (x) => (x == null ? '<span class="dim">—</span>' : `<span class="wr ${wrClass(x)}">${Number(x).toFixed(1)}%</span>`);
const tierB = (t) => (t ? `<span class="tier t${t}" title="Tier ${t} del parche">T${t}</span>` : '');
const chev = `<span class="chev">${icon('chevron')}</span>`;
const lbl = (text, right = '') => `<div class="lbl-row"><span class="lbl">${text}</span>${right ? `<span class="lbl-r">${right}</span>` : ''}</div>`;

/** Panel de cristal con cabecera. */
function panel(title, ic, body, { right = '', cls = '' } = {}) {
  return `<section class="panel ${cls}">${title ? `<header class="ph"><span class="ph-t">${ic ? icon(ic) : ''}${title}</span>${right ? `<span class="ph-r">${right}</span>` : ''}</header>` : ''}<div class="pb">${body}</div></section>`;
}

/** Anillo de progreso (SVG). parts: [{ v: 0-100, color }]; se dibujan en orden, uno tras otro. */
function ring(size, stroke, parts, inner = '') {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = parts.map((p) => {
    const len = (Math.max(0, Math.min(100, p.v)) / 100) * C;
    const a = `<circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" style="stroke:${p.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return a;
  }).join('');
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>${arcs}</svg><div class="ring-in">${inner}</div></div>`;
}

// Etiquetas de scouting: "fuerte"/"débil" se colorean según si el jugador es aliado o rival
function tag(t, side = 'ally') {
  const cls = t.type === 'strong' ? (side === 'enemy' ? 'bad' : 'good') : t.type === 'weak' ? (side === 'enemy' ? 'good' : 'warn') : t.type === 'info' ? 'info' : t.type;
  return `<span class="tag ${cls}">${esc(t.text)}</span>`;
}
const reasonRow = (r) => `<div class="reason ${r.value >= 0 ? 'pos' : 'neg'}"><b>${signed(r.value)}</b><span>${esc(r.text)}</span></div>`;
const factorRow = (r) => `<div class="factor ${r.value >= 0 ? 'pos' : 'neg'}"><b>${signed(r.value)}</b><span>${esc(r.text)}</span></div>`;

function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.innerHTML = `${icon(err ? 'alert' : 'check', err ? 'bad' : 'good')}<span>${esc(msg)}</span>`;
  el.className = `toast show ${err ? 'err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3500);
}

async function apply(kind, body = {}) {
  try {
    const res = await fetch(`/api/apply/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    toast(data.message, !data.ok);
  } catch {
    toast('Error de conexión con el servidor', true);
  }
}

function go(v, gameId) {
  view = v;
  if (gameId) { selectedGame = gameId; selectedPlayer = null; } else if (v === 'games') { selectedGame = null; selectedPlayer = null; }
  render();
  window.scrollTo({ top: 0 });
}

function emptyState(ic, title, text, extra = '') {
  return `<section class="panel"><div class="empty"><div class="eic">${icon(ic)}</div><h2>${title}</h2><p>${text}</p>${extra}</div></section>`;
}
