@echo off
rem Compila la app y deja el APK en android\LasAmericas.apk
rem Toma la interfaz y los datos de la carpeta de arriba (web\ y datos\ del Himnario).
rem No necesita Android Studio ni permisos de administrador.

setlocal
cd /d "%~dp0"

rem JDK 17 (el que pide el plugin de Android)
if exist "C:\Program Files\Java\jdk-17\bin\java.exe" (
  set "JAVA_HOME=C:\Program Files\Java\jdk-17"
) else (
  set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)

rem Carpeta temporal propia: evita el error "Unable to establish loopback connection"
if not exist ".tmp" mkdir ".tmp"
set "JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=%~dp0.tmp -Djava.io.tmpdir=%~dp0.tmp"

echo Compilando LasAmericas para Android...
call "%~dp0gradlew.bat" assembleDebug --console=plain
if errorlevel 1 (
  echo.
  echo *** La compilacion fallo. Revisa los mensajes de arriba. ***
  exit /b 1
)

copy /y "app\build\outputs\apk\debug\app-debug.apk" "LasAmericas.apk" >nul
echo.
echo Listo: %~dp0LasAmericas.apk
echo Copialo al celular e instalalo (permite "instalar apps desconocidas").
endlocal
