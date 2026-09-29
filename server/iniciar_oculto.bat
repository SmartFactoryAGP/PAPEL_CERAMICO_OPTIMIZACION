@echo off
rem =========================================================
rem   ARRANQUE AUTOMATICO Y OCULTO DEL PUENTE "LISTA DE CORTE"
rem =========================================================
rem   Este archivo NO se abre a mano — lo usa el Programador de tareas
rem   de Windows (a traves de iniciar_oculto.vbs) para prender el
rem   puente solo, sin ventana, cada vez que arranca la PC.
rem
rem   Si el proceso de Node se cae por cualquier motivo (SQL Server
rem   caido, un error, lo que sea), este archivo lo vuelve a prender
rem   solo despues de unos segundos — no hace falta que nadie lo
rem   reinicie a mano.
rem
rem   Para USAR la app normal, seguis abriendo el navegador en
rem   http://localhost:4000 (o la IP de red) como siempre — este
rem   archivo solo se ocupa de que el puente este siempre prendido
rem   por detras.
rem =========================================================
cd /d "%~dp0"

:loop
if not exist ".env" (
  rem sin .env no tiene sentido reintentar en bucle — sale y ya.
  exit /b 1
)
call npm start
rem si npm start termina (se cerro solo, se cayo, lo que sea),
rem espera 5 segundos y lo vuelve a prender.
timeout /t 5 /nobreak >nul
goto loop
