@echo off
rem Abre o TDB Launcher (Online / Offline / atualizacao). Precisa do Python com o pacote frida.
cd /d "%~dp0"
where pythonw >nul 2>nul && (start "" pythonw -I "%~dp0launcher\tdb_launcher.py") || (start "" python -I "%~dp0launcher\tdb_launcher.py")
