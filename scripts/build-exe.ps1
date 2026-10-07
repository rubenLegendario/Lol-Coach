# Compila "LoL Coach.exe" (lanzador sin consola con icono) usando el compilador de C# que trae Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1
# Para probar sin cerrar la app abierta, compila a otra ruta:
#   powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1 -Out C:\ruta\de\prueba\LoL Coach.exe
param([string]$Out = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'No encuentro csc.exe (.NET Framework 4)' }

$out = if ($Out) { $Out } else { Join-Path $root 'LoL Coach.exe' }
& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
  "/out:$out" `
  "/win32icon:$(Join-Path $root 'assets\icon.ico')" `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll `
  /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
  (Join-Path $root 'launcher\LoLCoach.cs') (Join-Path $root 'launcher\Overlay.cs') (Join-Path $root 'launcher\Updater.cs')
if ($LASTEXITCODE -ne 0) { throw 'Error al compilar' }
Write-Host "Generado: $out"
