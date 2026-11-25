@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Yueyun Zhichuan - One-click startup
echo ============================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
set "launcherExitCode=%ERRORLEVEL%"

echo.
if "%launcherExitCode%"=="0" (
    echo Startup completed. You may close this window.
) else (
    echo Startup failed. Keep the error above for troubleshooting.
)
echo.
pause
exit /b %launcherExitCode%
