@echo off
cd /d "%~dp0"
start "" "http://127.0.0.1:5173"
"C:\Users\HC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\server.mjs
