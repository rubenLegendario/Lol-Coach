<#
  Prepara una versión de LoL Coach para GitHub Releases.

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1
    powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1 -Publish -Notes "Novedades..."
    powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1 -Publish -NotesFile notas.md

  Genera dist\LoL-Coach-X.Y.Z.zip con UNA carpeta raíz "LoL Coach\" que lleva el exe (el que haya en
  la raíz: este script no recompila), runtime\node.exe (+ licencia), el código y LEEME.txt.
  Nunca incluye data\ (clave de Riot, notas, historial), .backup\, .claude\, CLAUDE.md, .git\, logs...
  Tampoco lo que solo sirve para desarrollar: test\, scripts\ui-check.sh ni este script. De scripts\ van
  solo build-exe.ps1 y make-icon.mjs (para recompilar el exe con el código de launcher\: "npm run build:exe").
  Nada de scripts\ se usa en tiempo de ejecución (ni el lanzador ni el servidor).
  Al final revisa el contenido buscando datos personales y aborta si encuentra algo.
#>
[CmdletBinding()]
param(
  [switch]$Publish,
  [string]$Notes = '',
  [string]$NotesFile = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fail([string]$msg) {
  Write-Host ''
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

# --- Versión y repo (package.json) ---
$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'package.json') | ConvertFrom-Json
$version = [string]$pkg.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { Fail "La versión de package.json ('$version') no tiene el formato X.Y.Z." }
$repo = ''
if ($pkg.PSObject.Properties.Name -contains 'updateRepo' -and $pkg.updateRepo) { $repo = ([string]$pkg.updateRepo).Trim() }
$tag = "v$version"
$zipName = "LoL-Coach-$version.zip"
Write-Host "LoL Coach $version" -ForegroundColor Cyan

# --- Comprobaciones previas ---
$exe = Join-Path $root 'LoL Coach.exe'
if (-not (Test-Path -LiteralPath $exe)) { Fail "No está 'LoL Coach.exe' en la raíz. Compílalo antes con scripts\build-exe.ps1." }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail 'No se encuentra node.exe en el PATH (hace falta para copiarlo a runtime\).' }
$nodeExe = $nodeCmd.Source
$nodeVersion = ([string](& $nodeExe -v)).Trim()   # p. ej. v24.15.0
if ($nodeVersion -notmatch '^v\d+\.\d+\.\d+$') { Fail "Versión de Node inesperada: '$nodeVersion'." }
Write-Host "Node: $nodeExe ($nodeVersion)"

# --- Carpeta de trabajo limpia ---
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('lolcoach-release-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'LoL Coach'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$zipPath = $null
$count = 0

try {
  # Carpetas de código. Se copian enteras y luego se quitan logs y similares.
  foreach ($dir in @('src', 'public', 'assets', 'launcher')) {
    $from = Join-Path $root $dir
    if (-not (Test-Path -LiteralPath $from)) { Fail "Falta la carpeta $dir." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $stage $dir) -Recurse -Force
  }
  # De scripts\ solo lo necesario para recompilar el exe (los tests y el resto son solo para desarrollar)
  New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
  foreach ($file in @('build-exe.ps1', 'make-icon.mjs')) {
    $from = Join-Path $root "scripts\$file"
    if (-not (Test-Path -LiteralPath $from)) { Fail "Falta el archivo scripts\$file." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $stage "scripts\$file") -Force
  }
  foreach ($file in @('LoL Coach.exe', 'package.json', 'README.md', '.env.example', 'iniciar.bat')) {
    $from = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $from)) { Fail "Falta el archivo $file." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $stage $file) -Force
  }
  # Basura que nunca debe ir (por si alguien la deja dentro de las carpetas de código)
  Get-ChildItem -LiteralPath $stage -Recurse -Force -File |
    Where-Object { $_.Name -like '*.log' -or $_.Name -like '*.tmp' -or $_.Name -eq '.env' -or $_.Name -eq 'Thumbs.db' } |
    Remove-Item -Force
  Get-ChildItem -LiteralPath $stage -Recurse -Force -Directory |
    Where-Object { @('node_modules', '.git', '.claude', '.backup') -contains $_.Name } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  # --- Runtime de Node ---
  $runtime = Join-Path $stage 'runtime'
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtime 'node.exe') -Force
  $licUrl = "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE"
  $licPath = Join-Path $runtime 'LICENSE-node.txt'
  Write-Host "Descargando licencia de Node: $licUrl"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'lolcoach-release')
    $wc.DownloadFile($licUrl, $licPath)
  } catch {
    Fail "No se pudo descargar la licencia de Node ($licUrl): $($_.Exception.Message). Node.js exige distribuir su licencia junto a node.exe; revisa la conexión y vuelve a intentarlo."
  }
  if ((Get-Item -LiteralPath $licPath).Length -lt 1000) { Fail 'La licencia de Node descargada está vacía o incompleta.' }

  # --- LEEME.txt ---
  $leeme = @"
LoL Coach $version
==================

Asistente para League of Legends: selección de campeón, partida en directo (panel y overlay
encima del juego), análisis post-partida, perfiles, builds y tier list.

CÓMO EMPEZAR
------------
1. No hay que instalar nada: Node.js ya viene incluido en la carpeta "runtime".
2. Descomprime esta carpeta donde quieras (por ejemplo, en Documentos) y haz doble clic en
   "LoL Coach.exe". Se abre la ventana de la app y aparece un icono en la bandeja del sistema
   (clic derecho en el icono para abrir la ventana, reiniciar o salir).
3. La primera vez, Windows puede mostrar el aviso de SmartScreen ("Windows protegió tu PC")
   porque el programa no está firmado. Pulsa "Más información" y luego "Ejecutar de todas formas".

OVERLAY ENCIMA DEL JUEGO
------------------------
Para ver el overlay encima de la partida, pon el juego en modo "Sin bordes" (Opciones del
juego > Vídeo > Modo de ventana: Sin bordes). En pantalla completa el overlay no se ve.

TUS DATOS
---------
Todo se guarda solo en este PC, en la carpeta "data" que se crea junto al programa (ajustes,
notas, historial y, si la pones, tu clave de la API de Riot). No se envía a ningún sitio.
Si mueves la app a otra carpeta, copia también "data" para no perder nada.

ACTUALIZACIONES
---------------
La app comprueba si hay una versión nueva y te pregunta antes de instalarla. Tus datos de la
carpeta "data" se conservan al actualizar.

SI ALGO FALLA
-------------
- Si la ventana no carga, usa "iniciar.bat": arranca el servidor en una consola donde se ven
  los errores y abre la app en http://localhost:3737.
- Registro: clic derecho en el icono de la bandeja > ver el registro.

LoL Coach no está respaldado por Riot Games. Solo lee datos que Riot expone a propósito
(cliente y Live Client API); no modifica el juego ni lee su memoria.
"@
  # Con BOM y CRLF para que el Bloc de notas muestre bien las tildes
  [System.IO.File]::WriteAllText((Join-Path $stage 'LEEME.txt'), ($leeme -replace "`r?`n", "`r`n"), (New-Object System.Text.UTF8Encoding($true)))

  # --- Zip (entradas con "/" y una sola carpeta raíz) ---
  # No se usa Compress-Archive: en PowerShell 5.1 guarda las rutas con "\" y otros programas las leen mal.
  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
  $zipPath = Join-Path $dist $zipName
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in Get-ChildItem -LiteralPath $stage -Recurse -Force -File) {
      $rel = $f.FullName.Substring($work.Length).TrimStart('\') -replace '\\', '/'
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }

  # --- Revisión de datos personales ---
  Write-Host 'Revisando el contenido en busca de datos personales...'
  $problems = New-Object System.Collections.Generic.List[string]

  # Identificadores personales: puuids (claves de primer nivel de data\*.json) y la clave de Riot guardada
  $secrets = New-Object System.Collections.Generic.HashSet[string]
  $dataDir = Join-Path $root 'data'
  if (Test-Path -LiteralPath $dataDir) {
    foreach ($jf in Get-ChildItem -LiteralPath $dataDir -Filter '*.json' -File) {
      try { $obj = Get-Content -Raw -Encoding UTF8 -LiteralPath $jf.FullName | ConvertFrom-Json } catch { continue }
      if ($null -eq $obj -or $obj -is [array]) { continue }
      foreach ($p in $obj.PSObject.Properties) {
        if ($p.Name -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or $p.Name.Length -ge 60) { [void]$secrets.Add($p.Name) }
      }
      if ($jf.Name -eq 'settings.json' -and $obj.PSObject.Properties.Name -contains 'riot' -and $obj.riot -and
          $obj.riot.PSObject.Properties.Name -contains 'apiKey' -and $obj.riot.apiKey) { [void]$secrets.Add([string]$obj.riot.apiKey) }
    }
  }
  Write-Host "  identificadores personales a buscar: $($secrets.Count)"

  # Claves de Riot: RGAPI- seguido de letras/números (el ejemplo de Ajustes, 'RGAPI-…', no cuenta).
  # Único valor permitido: el del test de ajustes.
  $rgapiOk = @('RGAPI-123')
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $tops = @{}
    foreach ($e in $zip.Entries) {
      $name = $e.FullName
      $tops[$name.Split('/')[0]] = $true
      $sub = if ($name.Contains('/')) { $name.Substring($name.IndexOf('/') + 1) } else { $name }
      if ($sub -match '^(data|\.backup|\.claude|\.git|node_modules|dist)/' -or $sub -match '(^|/)(node_modules|\.git)/' -or
          $sub -match '^test/' -or $sub -eq 'scripts/ui-check.sh' -or $sub -eq 'scripts/make-release.ps1' -or
          $sub -eq 'CLAUDE.md' -or $sub -eq '.env' -or $sub -match '\.log$' -or $sub -eq 'LoL Coach.old.exe') {
        $problems.Add("archivo prohibido: $name")
      }
      if ($name -match '\.(exe|png|ico|jpg|webp)$') { continue }   # binarios: no se busca texto
      $sr = New-Object System.IO.StreamReader($e.Open(), $utf8)
      try { $text = $sr.ReadToEnd() } finally { $sr.Dispose() }
      foreach ($m in [regex]::Matches($text, 'RGAPI-[A-Za-z0-9-]+')) {
        if ($rgapiOk -notcontains $m.Value) { $problems.Add("posible clave de Riot en ${name}: $($m.Value)") }
      }
      foreach ($s in $secrets) {
        if ($text.Contains($s)) { $problems.Add("dato personal (puuid o clave) en $name") }
      }
    }
    if ($tops.Count -ne 1 -or -not $tops.ContainsKey('LoL Coach')) { $problems.Add("el zip debe tener una sola carpeta raíz 'LoL Coach/' (tiene: $($tops.Keys -join ', '))") }
    $count = $zip.Entries.Count
  } finally { $zip.Dispose() }

  if ($problems.Count -gt 0) {
    Remove-Item -LiteralPath $zipPath -Force
    Fail ("El zip contenía cosas que no deben publicarse (se ha borrado):`n  - " + ($problems -join "`n  - "))
  }
  $sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
  Write-Host "OK: $zipPath ($count archivos, $sizeMb MB)" -ForegroundColor Green
}
finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- Publicación ---
$repoText = if ($repo) { " $repo" } else { ' (créalo y pon "updateRepo": "propietario/repo" en package.json)' }
$manual = @"

Pasos para publicar a mano:
  1. En GitHub, abre el repo$repoText > Releases > Draft a new release.
  2. Tag: $tag   Título: LoL Coach $version
  3. Adjunta el archivo: $zipPath
  4. Escribe las novedades y pulsa "Publish release".
"@

if (-not $Publish) {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    if ($repo) { Write-Host "`nPara publicarla con GitHub CLI: vuelve a ejecutar con -Publish -Notes `"...`" (o -NotesFile archivo)." }
    else { Write-Host "`nPara publicar con -Publish, rellena antes `"updateRepo`" en package.json." }
  }
  Write-Host $manual
  exit 0
}

if (-not $repo) { Fail "No se puede publicar: 'updateRepo' está vacío en package.json (formato propietario/repo).$manual" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'No está instalado GitHub CLI (gh): https://cli.github.com' -ForegroundColor Yellow
  Write-Host $manual
  exit 1
}
$ghArgs = @('release', 'create', $tag, $zipPath, '--repo', $repo, '--title', "LoL Coach $version")
if ($NotesFile) {
  if (-not (Test-Path -LiteralPath $NotesFile)) { Fail "No existe el archivo de notas: $NotesFile" }
  $ghArgs += @('--notes-file', (Resolve-Path -LiteralPath $NotesFile).Path)
} elseif ($Notes) {
  $ghArgs += @('--notes', $Notes)
} else {
  $ghArgs += @('--notes', "LoL Coach $version")
}
Write-Host "Publicando $tag en $repo..."
& gh @ghArgs
if ($LASTEXITCODE -ne 0) { Fail "gh release create ha fallado (código $LASTEXITCODE)." }
Write-Host "Publicada: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
