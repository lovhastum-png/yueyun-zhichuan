@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   越韵智传 - 一键启动（本机演示）
echo ============================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-group.ps1"

echo.
echo 操作完成。
pause
exit /b 0