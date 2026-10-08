'use strict';
/* LoL Coach — Ajustes. */

// ---------- Ajustes ----------
const SETTINGS_UI = [
  { group: 'overlay', title: 'Overlay encima del juego', icon: 'layers', desc: 'Ventanitas sobre el LoL mientras juegas. Necesita el juego en modo "Ventana sin bordes".', master: 'enabled', items: [
    ['cs', 'Contador de CS', 'Tu CS, CS por minuto, objetivo según tu rol y diferencia con tu rival.'],
    ['bench', '· Comparativa con tu rango', 'Tu CS/min, KDA y visión/min frente a lo habitual en el rango de tu objetivo (o en el tuyo), desde el minuto 5. Referencia estimada.'],
    ['skill', 'Qué habilidad subir', 'Aviso encima de tu barra de habilidades cuando tienes un punto sin gastar.'],
    ['back', 'Vuelve a base', 'Aviso cuando te llega el oro para tu objeto o un componente importante (con X para quitarlo).'],
    ['loading', 'Scouting en la pantalla de carga', 'Rango, experiencia y KDA con el campeón, rachas y premades de los 10 jugadores mientras carga.'],
    ['loadingCards', '· Encima de cada carta', 'Cada jugador, pegado arriba de su carta de la pantalla de carga (cada uno se cierra con su X). Si lo apagas, se ven dos paneles a los lados que puedes mover.'],
    ['timers', 'Timers de objetivos', 'Avisos de dragón, Barón, etc. en el overlay.'],
    ['timersPopup', '· Solo 1 minuto antes', 'Aparecen 1 minuto antes de que salga el objetivo, se quitan con la X y desaparecen al matarlo. Si lo apagas, se ven siempre.'],
    ['timerDragon', '· Dragón', ''], ['timerGrubs', '· Larvas del Vacío', ''], ['timerHerald', '· Heraldo', ''], ['timerBaron', '· Barón', ''], ['timerInhibs', '· Inhibidores', 'Cuándo reaparecen los inhibidores destruidos.'],
  ] },
  { group: 'alerts', title: 'Alertas en partida', icon: 'alert', desc: 'Avisos cuando pasa algo importante en tu partida.', master: 'enabled', items: [
    ['toasts', 'Avisos emergentes', 'Las tarjetas que aparecen en la app (abajo a la derecha; se pueden mover, fijar y cerrar).'],
    ['voice', 'Leer en voz alta', 'Lee cada alerta con una frase corta, también con el juego en primer plano. Elige la voz y pulsa «Probar».'],
    ['oppItems', 'Tu rival completa un objeto', 'Su power spike.'],
    ['levels', 'Niveles clave (6, 11, 16)', 'Quién tiene la R primero.'],
    ['advantage', 'Cambio de ventaja en tu línea', ''],
    ['myItems', 'Completas un objeto', ''],
    ['oppDeath', 'Tu rival muere', 'Momento de empujar o coger placas.'],
    ['canBuy', 'Tienes oro para tu siguiente objeto', ''],
    ['fedEnemies', 'Un rival fed completa un objeto', ''],
    ['objectives', 'Dragón y Barón a punto de salir', ''],
  ] },
  { group: 'live', title: 'Panel de partida', icon: 'live', desc: 'Qué bloques ves en la pantalla "Partida" mientras juegas.', items: [
    ['power', 'Tu línea y power spikes', ''], ['alertsPanel', 'Historial de alertas', ''], ['buy', 'Compra ahora', ''], ['situational', 'Ajustes de build según la partida', ''],
    ['skills', 'Orden de habilidades', ''], ['objectives', 'Objetivos y dragones', ''], ['spells', 'Hechizos rivales', ''], ['draft', 'Predicción del draft', ''],
    ['insights', 'Cómo va la partida', ''], ['comps', 'Composiciones', ''], ['pairs', 'Jugador a jugador', ''],
  ] },
  { group: 'champSelect', title: 'Selección de campeón', icon: 'target', desc: 'Qué bloques ves durante la selección.', items: [
    ['autoRunes', 'Importar runas al bloquear', 'Crea la página de runas de la build recomendada en cuanto bloqueas tu campeón.'],
    ['autoSpells', 'Poner hechizos al bloquear', 'Los hechizos de invocador más jugados con tu campeón.'],
    ['autoItems', 'Importar set de objetos al bloquear', 'La build aparece en la tienda del juego.'],
    ['dodge', 'Asesor de dodge', 'Solo en clasificatorias.'], ['picks', 'Mejores picks', ''], ['bans', 'Baneos sugeridos', ''], ['matchups', 'Matchups de tu campeón', ''],
    ['why', 'Por qué de la predicción', ''], ['notes', 'Tus notas del matchup', ''],
  ] },
  { group: 'postgame', title: 'Análisis de partida', icon: 'star', desc: 'Qué ves al revisar una partida terminada.', items: [
    ['badges', 'Logros de la partida', 'MVP/ACE, primera sangre, multikills, más farm, más daño, remontadas… en el análisis y en el informe de fin de partida.'],
    ['mvp', 'MVP, ACE y puesto en la tabla', 'Etiqueta de cada jugador en «Los 10 jugadores» según una puntuación estimada.'],
    ['rowDetails', 'Detalle en las filas del historial', 'Runas, logros y los 10 jugadores en cada partida del historial y de «Partidas recientes».'],
    ['suggestions', 'Sugerencias del coach de tu rol', 'Consejos suaves que no cuentan como fallo (p. ej. el trinket de un ADC o un ward de control ocasional en top o mid).'],
  ] },
  { group: 'home', title: 'Inicio', icon: 'home', desc: 'Qué bloques ves en la pantalla de inicio.', items: [
    ['form', 'Forma reciente en la cabecera', 'Winrate con el filtro elegido, racha y tus últimas 10 partidas.'],
    ['session', 'Sesión de hoy', 'Balance del día (victorias, LP, muertes) y avisos de tilt.'],
    ['goal', 'Objetivo de rango', 'Lo que te falta para tu objetivo, cómo vas frente al plan y el hito de la semana.'],
    ['goalOdds', '· Estimación de partidas y probabilidad', 'Cuántas partidas te faltan, la fecha probable y la probabilidad de llegar a tiempo, simuladas con tus LP, tu winrate y tu ritmo.'],
    ['goalPlan', '· Plan y gráfica del objetivo', 'Si vas por delante o por detrás del plan hasta la fecha límite, el hito de la semana y la gráfica con la previsión.'],
    ['lpCard', 'Tus LP', 'LP actuales, cambio en 24 horas y 7 días, media por victoria y derrota y LP de cada partida.'],
    ['perf', 'Rendimiento', 'Tus medias (KDA, CS, visión, daño y oro) con su nivel estimado por rango y lo que ha cambiado últimamente.'],
    ['coach', 'Tu coach', 'Los fallos que más repites, con un consejo para cada uno, y tus puntos fuertes.'],
    ['coachPhases', '· Nota por fase', 'Fase de líneas, mitad y final: nota, muertes y si mejoras frente a tus partidas anteriores.'],
    ['coachDeep', 'Detalles: Coach a fondo', 'Las fases en detalle y tu rendimiento con cada campeón (nota, muertes, CS, peor fase y fallo más repetido).'],
    ['recent', 'Partidas recientes', 'Tus 5 últimas partidas.'],
    ['lpChart', 'Detalles: Progreso de LP', 'Gráfica del objetivo, historial de LP y proyección.'],
    ['trends', 'Detalles: Tu evolución', 'Cómo cambian tus datos partida a partida.'],
    ['forecast', 'Detalles: Previsión de rango', 'Rango que te corresponde por tus estadísticas (también el resumen en Rendimiento).'],
    ['champs', 'Detalles: Campeones y roles', ''],
    ['deathMap', 'Detalles: Dónde mueres', 'Mapa y zonas de tus muertes.'],
  ] },
];

function voiceTools(disabled) {
  const voices = esVoices();
  const cur = voices.find((x) => x.voiceURI === voicePrefs.voice) || voices.find((x) => x.lang?.startsWith('es'));
  const rate = voicePrefs.rate || 1.08;
  const vol = voicePrefs.volume ?? 1;
  return `<div class="voice-tools ${disabled ? 'off' : ''}">
    <select class="inp sel" title="Voz" onchange="setVoicePref('voice', this.value)">${voices.length ? voices.map((x) => `<option value="${esc(x.voiceURI)}" ${x === cur ? 'selected' : ''}>${esc(x.name.replace(/^Microsoft /, '').replace(/ - .*/, ''))} (${esc(x.lang)})</option>`).join('') : '<option>Voz del sistema</option>'}</select>
    <select class="inp sel" title="Velocidad" onchange="setVoicePref('rate', Number(this.value))">${[[0.9, 'Lenta'], [1, 'Normal'], [1.08, 'Algo rápida'], [1.2, 'Rápida'], [1.35, 'Muy rápida']].map(([v, l]) => `<option value="${v}" ${v === rate ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="inp sel" title="Volumen" onchange="setVoicePref('volume', Number(this.value))">${[[0.4, 'Volumen bajo'], [0.7, 'Volumen medio'], [1, 'Volumen alto']].map(([v, l]) => `<option value="${v}" ${v === vol ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn sm" onclick="testVoice()">${icon('play')}Probar</button>
  </div>`;
}

function toggleRow(group, key, label, desc, disabled) {
  const v = on(`${group}.${key}`);
  return `<div class="opt ${disabled ? 'off' : ''} ${label.startsWith('·') ? 'sub' : ''}">
    <div style="min-width:0"><div class="opt-l">${esc(label.replace(/^·\s*/, ''))}</div>${desc ? `<div class="xs dim">${esc(desc)}</div>` : ''}</div>
    <button class="sw ${v ? 'on' : ''}" role="switch" aria-checked="${v}" ${disabled ? 'disabled' : ''} onclick="setOpt('${group}.${key}', ${!v})"><span></span></button>
  </div>${group === 'alerts' && key === 'voice' ? voiceTools(disabled) : ''}`;
}

function overlayPlaceRow() {
  const locked = on('overlay.locked');
  const moved = ['posCs', 'posTimers', 'posSkill'].some((k) => state?.settings?.overlay?.[k]);
  return `<div class="ov-place ${locked ? '' : 'editing'}">
    <span class="ov-lock">${icon('lock')}</span>
    <div style="min-width:0;flex:1"><div class="opt-l">${locked ? 'Mover los widgets desde el propio overlay' : 'Modo colocar activo en el overlay'}</div>
      <div class="xs dim">En partida, deja el ratón medio segundo sobre un widget y pulsa el candado que aparece en su esquina. Arrástralo y vuelve a pulsar el candado para bloquearlo. Atajo: <b>Ctrl+Mayús+L</b>.</div></div>
    ${moved ? '<button class="btn ghost sm" onclick="resetOverlayPos()">Restablecer posiciones</button>' : ''}
  </div>`;
}
async function resetOverlayPos() {
  for (const k of ['posCs', 'posTimers', 'posSkill']) await setOpt('overlay.' + k, null);
  toast('Widgets del overlay en su sitio por defecto');
}

async function saveRiotKey() {
  const v = document.getElementById('riot-key')?.value || '';
  await setOpt('riot.apiKey', v.trim());
  liveCache.clear();
  toast(v.trim() ? 'Clave guardada' : 'Clave borrada');
}

function riotKeyPanel() {
  const has = !!state?.settings?.riot?.apiKey;
  return panel('API de Riot (opcional)', 'plug', `
    <div class="s muted" style="margin:-4px 0 12px">Sin clave, la app solo puede saber si un jugador está en partida cuando es <b>tu amigo</b> en el LoL. Con una clave de la API de Riot lo sabe de <b>cualquier jugador</b> y además muestra sus 10 jugadores, baneos y la predicción del draft. Consíguela gratis en developer.riotgames.com (las de desarrollo caducan cada 24 h).</div>
    <div class="row nw" style="gap:8px"><input id="riot-key" class="inp" type="password" placeholder="RGAPI-…" value="${has ? '••••••••••••••••' : ''}" onfocus="if(this.value.startsWith('•'))this.value=''" style="flex:1;height:38px;padding:0 12px" autocomplete="off" spellcheck="false">
      <button class="btn sm" onclick="saveRiotKey()">Guardar</button>${has ? '<button class="btn ghost sm" onclick="document.getElementById(\'riot-key\').value=\'\';saveRiotKey()">Borrar</button>' : ''}</div>
    <div class="xs ${has ? 'good' : 'dim'}" style="margin-top:8px">${has ? 'Clave configurada.' : 'Sin clave.'}</div>`);
}

function viewSettings() {
  const cards = SETTINGS_UI.map((sec) => {
    const masterOn = sec.master ? on(`${sec.group}.${sec.master}`) : true;
    const timersOff = sec.group === 'overlay' && !on('overlay.timers');
    return panel(sec.title, sec.icon, `
      <div class="s muted" style="margin:-4px 0 12px">${esc(sec.desc)}</div>
      ${sec.group === 'overlay' && masterOn ? overlayPlaceRow() : ''}
      ${sec.master ? `<div class="opt master">${'<div class="opt-l">Activado</div>'}<button class="sw ${masterOn ? 'on' : ''}" role="switch" aria-checked="${masterOn}" onclick="setOpt('${sec.group}.${sec.master}', ${!masterOn})"><span></span></button></div>` : ''}
      <div class="opts">${sec.items.map(([k, l, d]) => toggleRow(sec.group, k, l, d, !masterOn || (timersOff && k.startsWith('timer') && k !== 'timers') || (sec.group === 'overlay' && k === 'loadingCards' && !on('overlay.loading')))).join('')}</div>`, { cls: sec.master && masterOn ? 'gold' : '' });
  });
  return `<div class="grid g-2"><div class="col">${cards[0]}${cards[1]}${cards[4]}</div><div class="col">${cards[2]}${cards[3]}${cards[5]}
    ${riotKeyPanel()}
    <section class="panel"><div class="pb row"><span class="s muted" style="flex:1">Los cambios se guardan al momento y se aplican también a una partida en curso.</span><button class="btn ghost sm" onclick="resetSettings()">Restaurar por defecto</button></div></section></div></div>`;
}
