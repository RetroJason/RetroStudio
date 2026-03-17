@echo off
cd /d "%~dp0"
echo Serving RetroStudio at http://localhost:8000
python -m http.server 8000
