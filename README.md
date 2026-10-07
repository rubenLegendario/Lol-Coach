# LoL Coach

Asistente en tiempo real para League of Legends, al estilo de iTero, DeepLoL o Porofessor. Es un panel web local que se actualiza solo según el momento de la partida.

## Arrancar

Doble clic en **LoL Coach** (el acceso directo del escritorio o `LoL Coach.exe`). Arranca el servidor sin consola, abre la app en su propia ventana y deja un icono en la bandeja del sistema. Con clic derecho en ese icono puedes abrir la ventana, reiniciar el servidor, ver el registro o salir.

Si cambias el lanzador (`launcher/LoLCoach.cs`) o el logo (`assets/icon.svg`):

```bash
node scripts/make-icon.mjs                                       # regenera assets/icon.ico
powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1   # recompila LoL Coach.exe
```

Modo desarrollo, con consola:

```bash
npm start            # o doble clic en iniciar.bat
```

Abre **http://localhost:3737** (en un segundo monitor queda perfecto). No necesita `npm install`, porque no tiene dependencias, ni tampoco una clave de la API de Riot.

Para ver cómo queda sin estar en partida:

```bash
npm run demo              # selección de campeón simulada
npm run demo -- ingame    # partida simulada
```

Para probarlo de verdad, entra en la **Herramienta de práctica** con cualquier campeón.

## Funciones inspiradas en iTero

- **Probabilidad de victoria del draft** durante la selección, explicada con razones: fuerza de cada campeón en el parche, enfrentamientos de línea, sinergias, experiencia de cada jugador con su campeón (según el estudio de iTero sobre 1M de partidas) y balance de la composición. Durante la partida se recalcula con la experiencia de los 10 jugadores.
- **Picks recomendados con su porqué**: "Jinx 51,5% (+2,4): está fuerte este parche, la dominas y combina bien con Ahri".
- **Builds con nombre y etiquetas** ("Crítico", "Letalidad · con Filo de la noche", "Tanque"…).
- **Scouting legible**: etiquetas como "Muere mucho", "Fuera de su rol", "Farmea muy bien" o "Agresivo early", en verde o rojo según si es aliado o rival.
- **Análisis post-partida** (pestaña *Mis partidas*, y automático al terminar una partida): nota global y por fases, las 3 cosas que más te costaron con un consejo concreto, lo que hiciste bien, gráfica de oro, fase de líneas contra tu rival, tus muertes (ganks, en territorio enemigo) y tus números frente al objetivo de tu rol y frente a tu propia media.

## Qué hace

| Momento | Recomendaciones |
|---|---|
| **Fuera de partida** | Tu rango, tus últimas 10 partidas, tu racha y tus campeones con más maestría |
| **Selección de campeón** | Picks recomendados según tu rival de línea probable (meta y de tu pool), baneos sugeridos, build completa (runas, hechizos, objetos iniciales, core, botas, habilidades), build específica del matchup, matchups fáciles y difíciles, análisis AP/AD de ambos equipos, info de tus aliados |
| | Botones para **aplicar runas**, **aplicar hechizos** (respeta en qué tecla llevas Flash) y **crear un set de objetos**, que aparece en la tienda del juego |
| **En partida** | Qué comprar **ahora** con tu oro, teniendo en cuenta los componentes que ya llevas. Ajustes situacionales según la partida (antiheal, resistencias, penetración, anti-CC, anti-burst) y qué habilidad subir. Timers de dragón y barón, dragones de cada equipo, temporizador de hechizos de los rivales (haz clic al gastarlo), amenaza rival y diferencia de oro |
| | Rango, winrate, racha, maestría y etiquetas (main, OTP, primera vez con el campeón…) de los 10 jugadores |

## Cómo funciona

```
LoL Client (LCU API, lockfile) ──┐
Juego (Live Client API :2999) ───┼──> servidor Node (src/) ──SSE──> panel web (public/)
Data Dragon / Meraki / OP.GG ────┘
```

- `src/lcu.js`: conexión con el cliente (fase, selección, rangos, historial y aplicar runas o hechizos).
- `src/liveclient.js`: datos de la partida en curso.
- `src/data/stats.js`: estadísticas meta. Usa la API JSON interna de OP.GG, que **no es oficial**: si un día deja de funcionar, solo hay que cambiar este archivo.
- `src/engine/champselect.js` y `src/engine/ingame.js`: la lógica de las recomendaciones.
- `src/players.js`: análisis de cada jugador mediante el cliente local.

## Configuración

Copia `.env.example` a `.env` para cambiar el puerto, el rango de las estadísticas (`emerald_plus` por defecto), la región o la ruta del LoL. Con `HOST=0.0.0.0` puedes abrir el panel desde el móvil, conectado a la misma WiFi.

## Publicar una versión

Las versiones se publican como Releases de GitHub en el repo de `updateRepo` (`package.json`), con tag `vX.Y.Z` y el asset `LoL-Coach-X.Y.Z.zip`. La versión del servidor se ve en `/api/version`.

1. Sube `"version"` en `package.json` (por ejemplo, `1.1.0` → `1.2.0`).
2. Si ha cambiado el lanzador, recompila el exe: `powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1`.
3. Genera el zip: `powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1`. Crea `dist\LoL-Coach-X.Y.Z.zip` con una carpeta `LoL Coach\` que incluye el exe de la raíz, `runtime\node.exe` (el Node instalado más su licencia), el código y `LEEME.txt`. Nunca incluye `data\` y aborta si encuentra datos personales (claves `RGAPI-`, tu puuid).
4. Publica: añade `-Publish -Notes "Novedades..."` (o `-NotesFile notas.md`) si tienes [GitHub CLI](https://cli.github.com) (`gh`). Si no lo tienes, crea la release a mano en GitHub (el script imprime los pasos).

## Sobre las normas de Riot

Solo **lee** datos que Riot expone a propósito (LCU y Live Client API) y muestra información en una ventana aparte, igual que Porofessor, Blitz o U.GG. No inyecta nada en el juego ni lee su memoria. Los únicos cambios que hace en el cliente (runas, hechizos y set de objetos) ocurren cuando pulsas el botón correspondiente.
