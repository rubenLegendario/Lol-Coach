/**
 * Zonas de la Grieta del Invocador a partir de coordenadas de partida.
 * El mapa va de ~(-120, -120) a ~(14870, 14980); la base azul está abajo a la izquierda,
 * el mid es la diagonal x≈y y el río la diagonal x+y≈14800.
 */
const MIN = -120;
const SIZE_X = 14990;
const SIZE_Y = 15100;

/** Posición en % sobre la imagen del minimapa (origen arriba a la izquierda). */
export function toMapPercent({ x, y }) {
  return {
    left: Math.max(0, Math.min(100, ((x - MIN) / SIZE_X) * 100)),
    top: Math.max(0, Math.min(100, (1 - (y - MIN) / SIZE_Y) * 100)),
  };
}

/** Zona legible para un punto, desde el punto de vista de un equipo (100 azul, 200 rojo). */
export function zoneOf({ x, y }, teamId) {
  const ownBase = teamId === 100 ? x < 3200 && y < 3200 : x > 11600 && y > 11600;
  const enemyBase = teamId === 100 ? x > 11600 && y > 11600 : x < 3200 && y < 3200;
  if (ownBase) return 'Tu base';
  if (enemyBase) return 'Base enemiga';
  if (x < 2300 || y > 12600) return 'Línea de top';
  if (y < 2300 || x > 12600) return 'Línea de bot';
  if (Math.abs(x - y) < 1400) return 'Línea de mid';
  if (Math.abs(x + y - 14800) < 1700) return x > y ? 'Río de bot' : 'Río de top';
  const blueSide = x + y < 14800;
  return (teamId === 100) === blueSide ? 'Tu jungla' : 'Jungla enemiga';
}
