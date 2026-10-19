@echo off
rem Inicia el Himnario. Deja esta ventana abierta mientras lo uses.
cd /d "%~dp0"
title Himnario - Servidor
node servidor.js
pause
