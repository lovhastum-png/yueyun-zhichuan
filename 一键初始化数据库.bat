@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   越韵智传 - 一键初始化数据库
echo   用途：把完整演示数据导入本机 MySQL
echo ============================================

set "DUMP=%~dp0server\sql\full_dump.sql"
if not exist "%DUMP%" (
    echo [错误] 未找到数据文件：server\sql\full_dump.sql
    echo        请确认压缩包完整。
    pause
    exit /b 1
)

rem 读取 .env 中的数据库配置
set "DBUSER=root"
set "DBPASS=123456"
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0.env") do (
    if /i "%%a"=="DB_USER"  set "DBUSER=%%b"
    if /i "%%a"=="DB_PASSWORD"  set "DBPASS=%%b"
)

where mysql.exe >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 mysql 命令，请确认已安装 MySQL 8 并加入 PATH。
    echo        或将 MySQL 的 bin 目录加入系统环境变量 PATH。
    pause
    exit /b 1
)

echo.
echo 正在导入数据（会先删除并重建 yueyun_db，请耐心等待）...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dump=[System.IO.File]::ReadAllText('%DUMP%'); $dump | mysql -h 127.0.0.1 -u '%DBUSER%' --password='%DBPASS%'"

if errorlevel 1 (
    echo.
    echo [失败] 数据库导入出错。请检查：
    echo       1. MySQL 服务是否已启动（默认端口 3306）
    echo       2. root 密码是否为 %DBPASS%（如不是，请打开 .env 修改 DB_PASSWORD）
    echo.
    echo   [手动导入方式] 在数据库管理工具(SQLyog/DBeaver/Navicat)中执行 server\sql\full_dump.sql
    pause
    exit /b 1
)

echo.
echo [成功] 数据已导入！
echo        现在可双击「一键启动-越韵智传.bat」启动系统。
echo        教师账号 teacher / teacher123
echo        学生账号 student1 / student123
pause