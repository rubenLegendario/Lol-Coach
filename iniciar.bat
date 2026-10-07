@echo off
cd /d "%~dp0"
start "" http://localhost:3737
if exist runtime\node.exe (runtime\node.exe src/index.js) else (node src/index.js)
pause
