@echo off
echo Instalando lo que necesita el puente para correr...
echo (esto puede tardar 1-2 minutos la primera vez)
echo.
cd /d "%~dp0"
call npm install
echo.
echo Listo. Ahora completa tu archivo .env (ver CONECTAR_SQL.md) y despues
echo usa iniciar.bat para prender el puente.
pause
