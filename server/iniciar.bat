@echo off
cd /d "%~dp0"
if not exist ".env" (
  echo.
  echo   No encontre el archivo .env en esta carpeta.
  echo   Copia ".env.example" a ".env" y completa tus datos antes de
  echo   arrancar el puente. Ver CONECTAR_SQL.md para el paso a paso.
  echo.
  pause
  exit /b 1
)
echo Prendiendo el puente "Lista de corte"...
echo Deja esta ventana abierta mientras uses la app.
echo.
call npm start
pause
