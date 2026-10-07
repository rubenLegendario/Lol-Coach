#!/usr/bin/env bash
# Comprobación visual de la interfaz: arranca servidores de prueba, saca capturas de todas las pantallas
# con Chrome sin ventana y apunta los errores de JavaScript de la consola.
#
#   bash scripts/ui-check.sh <carpeta-salida> [carpeta-referencia]
#
# Si das una carpeta de referencia (capturas de antes del cambio), compara píxel a píxel e indica
# qué pantallas han cambiado. Los servidores de prueba usan los puertos 3804 (datos reales; necesita el
# cliente del LoL abierto), 3802 (demo en partida), 3806 (demo selección) y 3803 (demo pantalla de carga),
# y se cierran al terminar. No toca la app que tengas abierta (puerto 3737).
#
# Variables de entorno:
#   UI_CHECK_SEARCH  Riot ID (Nombre#TAG) del jugador para la captura del buscador de perfiles, p. ej.
#                    UI_CHECK_SEARCH='Nombre#TAG' bash scripts/ui-check.sh capturas
#                    Si no se da, esa captura se salta (así el script no lleva el nombre de nadie).
set -u
OUT="$1"; REF="${2:-}"
cd "$(dirname "$0")/.."
mkdir -p "$OUT"
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"

PIDS=()
start() { PORT=$1 node src/index.js ${2:-} > "$OUT/server-$1.log" 2>&1 & PIDS+=($!); }
start 3804
start 3802 "--demo ingame"
start 3806 "--demo"
start 3803 "--demo loading"
sleep 12

declare -A URLS=(
  [home]="http://localhost:3804/?snapshot&view=home"
  [games]="http://localhost:3804/?snapshot&view=games"
  [pool]="http://localhost:3804/?snapshot&view=pool"
  [builds]="http://localhost:3804/?snapshot&view=builds"
  [settings]="http://localhost:3804/?snapshot&view=settings"
  [report]="http://localhost:3804/?snapshot&report=1"
  [ingame]="http://localhost:3802/?snapshot&view=live"
  [champselect]="http://localhost:3806/?snapshot&view=live"
  [loading]="http://localhost:3803/?snapshot&view=live"
)
if [ -n "${UI_CHECK_SEARCH:-}" ]; then
  URLS[search]="http://localhost:3804/?snapshot&search=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$UI_CHECK_SEARCH")"
else
  echo "UI_CHECK_SEARCH sin definir: se salta la captura del buscador."
fi
: > "$OUT/errors.txt"
for k in "${!URLS[@]}"; do
  timeout 120 "$CH" --headless=new --disable-gpu --hide-scrollbars --window-size=1500,2400 --virtual-time-budget=25000 \
    --enable-logging=stderr --v=0 --screenshot="$OUT/$k.png" "${URLS[$k]}" 2>"$OUT/$k.chrome.log" >/dev/null
  grep -i "Uncaught\|SyntaxError\|ReferenceError\|TypeError" "$OUT/$k.chrome.log" | grep -v "favicon\|net::ERR" | sed "s/^/[$k] /" >> "$OUT/errors.txt"
done
for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
# node lanzado desde bash en Windows a veces sobrevive al kill: cerramos los de los puertos de prueba
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*src/index.js*' -and (Get-CimInstance Win32_Process -Filter \"ProcessId=\$(\$_.ParentProcessId)\").Name -ne 'LoL Coach.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null

echo "Capturas en $OUT"
if [ -s "$OUT/errors.txt" ]; then echo "ERRORES DE JAVASCRIPT:"; cat "$OUT/errors.txt"; else echo "Sin errores de JavaScript."; fi

if [ -n "$REF" ]; then
  echo "Diferencias con $REF (% de píxeles distintos):"
  powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; Get-ChildItem '$REF\\*.png' | ForEach-Object { \$k=\$_.BaseName; \$b='$OUT\\'+\$k+'.png'; if (-not (Test-Path \$b)) { return }; \$x1=[System.Drawing.Bitmap]::FromFile(\$_.FullName); \$x2=[System.Drawing.Bitmap]::FromFile(\$b); \$d=0; \$n=0; for(\$y=0;\$y -lt [Math]::Min(\$x1.Height,\$x2.Height);\$y+=13){ for(\$x=0;\$x -lt [Math]::Min(\$x1.Width,\$x2.Width);\$x+=13){ \$n++; \$p=\$x1.GetPixel(\$x,\$y); \$q=\$x2.GetPixel(\$x,\$y); if([Math]::Abs(\$p.R-\$q.R)+[Math]::Abs(\$p.G-\$q.G)+[Math]::Abs(\$p.B-\$q.B) -gt 40){\$d++} } }; '{0,-12} {1,6:P1}' -f \$k, (\$d/\$n) }"
fi
