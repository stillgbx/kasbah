@echo off
rem Starts the Android Auto Desktop Head Unit (DHU) against the phone plugged in by USB.
rem Usage: dhu          wide screen, close to a car's
rem        dhu sensors  800x480 with simulated car data (fuel, range, speed, odometer commands)
rem ASCII only, CRLF line endings: cmd misreads a batch file otherwise.
setlocal
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "CONFIG=default_wide.ini"
if /i "%~1"=="sensors" set "CONFIG=default_sensors.ini"

"%ANDROID_HOME%\platform-tools\adb.exe" forward tcp:5277 tcp:5277 >nul || (
  echo No phone found: plug it in by USB and accept USB debugging.
  exit /b 1
)

echo On the phone, unlocked:
echo   1. Open the Android Auto settings ^(developer mode on^).
echo   2. Top-right menu: "Start head unit server" ^("Demarrer le serveur de l'unite principale"^).
echo   3. Keep the phone unlocked: it asks to launch Android Auto once the simulator connects.
echo.
pause

cd /d "%ANDROID_HOME%\extras\google\auto"
.\desktop-head-unit.exe -c config\%CONFIG% -a
