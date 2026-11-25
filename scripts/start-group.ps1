# ============================================================
# 越韵智传 · 组员一键启动脚本（本机演示用）
# 功能：检测 Node → 检测 MySQL/数据库 → 启动后端 + PDF OCR → 打开浏览器
# 不启动 Cloudflare 隧道；PDF 导入是教师端核心功能，因此随本机演示一同启动。
# ============================================================
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lowResourceDefaults = @{
    PDF_IMPORT_CONCURRENCY = '1'
    PDF_IMPORT_MAX_MB      = '100'
    PDF_OCR_CONCURRENCY    = '1'
    PDF_OCR_DPI            = '180'
    PDF_OCR_THREADS        = '2'
}
foreach ($setting in $lowResourceDefaults.GetEnumerator()) {
    if (-not [Environment]::GetEnvironmentVariable($setting.Key, 'Process')) {
        [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, 'Process')
    }
}

function Write-Step([string]$m) { Write-Host ("[启动] {0}" -f $m) -ForegroundColor Cyan }
function Write-OK([string]$m) { Write-Host ("[OK]   {0}" -f $m) -ForegroundColor Green }
function Write-Bad([string]$m) { Write-Host ("[警告] {0}" -f $m) -ForegroundColor Yellow }

# ---------- 1. Node 检测 ----------
Write-Step '检测 Node.js'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "未检测到 Node.js。" -ForegroundColor Red
    Write-Host "请先安装 Node.js 18 或更高版本（LTS）：https://nodejs.org/ 完成后重新双击本脚本。" -ForegroundColor Yellow
    Write-Host "按任意键退出。"
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}
Write-OK "Node.js: $($node.Source)"

# ---------- 2. 依赖检查 ----------
Write-Step '检查依赖 (node_modules)'
$nodeModules = Join-Path $projectRoot 'node_modules'
if (-not (Test-Path (Join-Path $nodeModules 'express'))) {
    Write-Host "未找到依赖，正在安装（约 1-3 分钟，请耐心等待）..." -ForegroundColor Yellow
    Push-Location $projectRoot
    try { npm install --no-audit --no-fund 2>&1 | Out-Host }
    finally { Pop-Location }
    if (-not (Test-Path (Join-Path $nodeModules 'express'))) {
        Write-Host "依赖安装失败，请联网重试。" -ForegroundColor Red
        exit 1
    }
}
Write-OK "依赖已就绪"

# ---------- 3. 数据库检测 ----------
Write-Step '检测 MySQL 数据库连接'
# 读取 .env 的数据库配置
$envMap = @{}
$envFile = Join-Path $projectRoot '.env'
if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$') { $envMap[$Matches[1]] = $Matches[2].Trim() }
    }
}
$dbHost = if ($envMap['DB_HOST']) { $envMap['DB_HOST'] } else { '127.0.0.1' }
$dbPort = if ($envMap['DB_PORT']) { $envMap['DB_PORT'] } else { '3306' }
$dbUser = if ($envMap['DB_USER']) { $envMap['DB_USER'] } else { 'root' }
$dbPass = if ($envMap['DB_PASSWORD']) { $envMap['DB_PASSWORD'] } else { '123456' }
$dbName = if ($envMap['DB_NAME']) { $envMap['DB_NAME'] } else { 'yueyun_db' }

$mysql = Get-Command mysql.exe -ErrorAction SilentlyContinue
$dumpFile = Join-Path $projectRoot 'server\sql\full_dump.sql'

$dbOk = $false
if ($mysql) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # 尝试连接
        & $mysql.Source -h $dbHost -P $dbPort -u $dbUser "--password=$dbPass" -e "SELECT 1;" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            # 再确认库/表是否存在
            $dbCheck = & $mysql.Source -h $dbHost -P $dbPort -u $dbUser "--password=$dbPass" -e "USE $dbName; SHOW TABLES LIKE 'users';" 2>&1 | Select-String 'users'
            if ($dbCheck) {
                $dbOk = $true
            } elseif (Test-Path $dumpFile) {
                Write-Bad "数据库 $dbName 存在但尚未初始化（或用户表缺失），将自动导入数据..."
                $sqlText = Get-Content -LiteralPath $dumpFile -Raw -Encoding UTF8
                $sqlText | & $mysql.Source -h $dbHost -P $dbPort -u $dbUser "--password=$dbPass" 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { $dbOk = $true; Write-OK "数据导入完成" }
            }
        }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

if (-not $dbOk) {
    Write-Host "" 
    Write-Host "数据库连接或初始化失败。请检查：" -ForegroundColor Red
    Write-Host "  1. 本机是否已安装并启动 MySQL（默认 3306，root/$dbPass）"; 
    Write-Host "  2. .env 中的 DB_* 是否正确；"
    if (Test-Path $dumpFile) {
        Write-Host "  3. 若数据库中尚无数据，请运行： 【一键初始化数据库.bat】（会重建完整演示数据）"
    } else {
        Write-Host "  3. 包内缺少数据文件，请用 init.sql 初始化表结构： mysql -u root -p < server\sql\init.sql"
    }
    Write-Host ""
    Write-Host "修好后重新双击本脚本。按任意键退出。"
    $null = $Host.UI.RawUI.ReadKey("NoKey")
    exit 1
}
Write-OK "数据库就绪 ($dbName)"

# ---------- 4. 启动后端 ----------
Write-Step '启动后端服务 (127.0.0.1:3000)'
$serverEntry = Join-Path $projectRoot 'server\server.js'
$logDir = Join-Path $projectRoot '.tools\runtime-logs'
$pdfImportDir = Join-Path $projectRoot 'server\python\pdf-import'
$pdfImportPython = Join-Path $projectRoot 'server\python\pose-eval\.venv\Scripts\python.exe'
$pdfImportHealthUrl = 'http://127.0.0.1:8768/health'

function Test-PdfImportReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $pdfImportHealthUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = Join-Path $logDir "backend-$stamp.stdout.log"
$errLog = Join-Path $logDir "backend-$stamp.stderr.log"

# 若端口已被占用（旧进程），提示是否清理
$busy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Bad '端口 3000 已被占用，正在清理旧的后端进程后重启...'
    Stop-Process -Id $busy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Push-Location $projectRoot
$proc = Start-Process -FilePath $node.Source -ArgumentList 'server\server.js' -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
Pop-Location

Write-OK "后端已启动 (PID $($proc.Id))"

# ---------- 5. 启动 PDF OCR 服务 ----------
Write-Step '启动 PDF 识别服务'
if (Test-PdfImportReady) {
    Write-OK 'PDF 识别服务已就绪 (127.0.0.1:8768)'
} elseif (-not (Test-Path -LiteralPath $pdfImportPython)) {
    Write-Bad 'PDF 识别服务依赖未安装，PDF 导入暂不可用。请先运行 scripts\start-all.ps1 完成首次环境准备。'
} else {
    $pdfOutLog = Join-Path $logDir "pdf-import-$stamp.stdout.log"
    $pdfErrLog = Join-Path $logDir "pdf-import-$stamp.stderr.log"
    $pdfProc = Start-Process -FilePath $pdfImportPython `
        -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8768') `
        -WorkingDirectory $pdfImportDir `
        -RedirectStandardOutput $pdfOutLog -RedirectStandardError $pdfErrLog `
        -WindowStyle Hidden -PassThru
    $pdfReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-PdfImportReady) { $pdfReady = $true; break }
        if ($pdfProc.HasExited) { break }
    }
    if ($pdfReady) {
        Write-OK "PDF 识别服务已启动 (PID $($pdfProc.Id))"
    } else {
        Write-Bad "PDF 识别服务启动失败，请查看日志：$pdfErrLog"
    }
}

# ---------- 6. 等待就绪并打开浏览器 ----------
Write-Step '等待服务就绪'
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/api/system/health' -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    if ($proc.HasExited) { break }
}

if ($ready) {
    Write-OK '服务已就绪，正在打开浏览器...'
    Start-Process 'http://localhost:3000/app'
    Write-Host ""
    Write-Host '  访问地址: http://localhost:3000/app' -ForegroundColor White
    Write-Host '  教师账号: teacher / teacher123' -ForegroundColor DarkGray
    Write-Host '  学生账号: student1 / student123' -ForegroundColor DarkGray
    Write-Host "  日志目录: $logDir" -ForegroundColor DarkGray
} else {
    Write-Host "启动超时或失败，请查看日志：$errLog / $outLog" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "如需停止服务：关闭本脚本所在的黑窗口即可（后端为独立进程，可随时关闭）。" -ForegroundColor DarkGray
