[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5 cannot start child processes when an inherited
# environment block contains both Path and PATH. Recreate one process-local
# entry without changing the user's system environment.
$inheritedPathValue = $env:Path
Remove-Item Env:Path -ErrorAction SilentlyContinue
$env:Path = $inheritedPathValue

try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
    # Continue with the current console encoding when no interactive console exists.
}

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
$serverEntry = Join-Path $projectRoot 'server\server.js'
$tunnelConfig = Join-Path $projectRoot '.cloudflared\config.yml'
$localCloudflared = Join-Path $projectRoot '.tools\cloudflared.exe'
$runtimeDirectory = Join-Path $projectRoot '.tools\runtime-logs'
$backendPidFile = Join-Path $runtimeDirectory 'backend.pid'
$tunnelPidFile = Join-Path $runtimeDirectory 'cloudflared.pid'
$localHealthUrl = 'http://127.0.0.1:3000/api/system/health'
$tunnelProtocol = if ($env:CLOUDFLARED_PROTOCOL -in @('auto', 'quic', 'http2')) { $env:CLOUDFLARED_PROTOCOL } else { 'auto' }

# 演唱测评 Python 分析服务（sidecar，仅本机回环 127.0.0.1:8765）
$pythonEvalDir = Join-Path $projectRoot 'server\python\singing-eval'
$pythonEvalVenv = Join-Path $pythonEvalDir '.venv'
$pythonEvalPython = Join-Path $pythonEvalVenv 'Scripts\python.exe'
$pythonEvalPidFile = Join-Path $runtimeDirectory 'python-eval.pid'
$pythonEvalHealthUrl = 'http://127.0.0.1:8765/health'

# 剧本比对 Python 分析服务（sidecar，仅本机回环 127.0.0.1:8766）
$pythonCmpDir = Join-Path $projectRoot 'server\python\script-compare'
$pythonCmpVenv = Join-Path $pythonCmpDir '.venv'
$pythonCmpPython = Join-Path $pythonCmpVenv 'Scripts\python.exe'
$pythonCmpPidFile = Join-Path $runtimeDirectory 'python-cmp.pid'
$pythonCmpHealthUrl = 'http://127.0.0.1:8766/health'

# 姿态比对评分服务（sidecar，仅本机回环 127.0.0.1:8767，虚拟试衣页直连）
$pythonPoseDir = Join-Path $projectRoot 'server\python\pose-eval'
$pythonPoseVenv = Join-Path $pythonPoseDir '.venv'
$pythonPosePython = Join-Path $pythonPoseVenv 'Scripts\python.exe'
$pythonPosePidFile = Join-Path $runtimeDirectory 'python-pose.pid'
$pythonPoseHealthUrl = 'http://127.0.0.1:8767/health'

# PDF 导入 OCR 服务（sidecar，本机回环 127.0.0.1:8768；复用 pose-eval venv 的 rapidocr）
$pdfImportDir = Join-Path $projectRoot 'server\python\pdf-import'
$pdfImportPython = Join-Path $pythonPoseVenv 'Scripts\python.exe'
$pdfImportPidFile = Join-Path $runtimeDirectory 'pdf-import.pid'
$pdfImportHealthUrl = 'http://127.0.0.1:8768/health'

# 越剧知识问答/ASR 纠错模型（serve.py，本机回环 127.0.0.1:3456）
# 优先使用项目内 venv；否则回退到此前手工创建的英文路径 venv（基座已缓存）；
# 都没有时才会在项目内创建并安装依赖（torch 较大，一次性较慢）。
$yuejuModelDir = Join-Path $projectRoot 'models\yueju_asr_correct'
$yuejuModelVenv = Join-Path $yuejuModelDir '.venv'
$yuejuModelPythonProject = Join-Path $yuejuModelVenv 'Scripts\python.exe'
$yuejuModelPythonFallback = 'C:\Users\ASUS\yueju_asr_venv\Scripts\python.exe'
$yuejuModelPidFile = Join-Path $runtimeDirectory 'yueju-model.pid'
$yuejuModelHealthUrl = 'http://127.0.0.1:3456/health'

function Write-Step([string]$Message) {
    Write-Host ("[START] {0}" -f $Message) -ForegroundColor Cyan
}

function Write-Success([string]$Message) {
    Write-Host ("[OK] {0}" -f $Message) -ForegroundColor Green
}

function Write-WarningMessage([string]$Message) {
    Write-Host ("[NOTICE] {0}" -f $Message) -ForegroundColor Yellow
}

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -Uri $localHealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PythonEvalReady {
    try {
        $response = Invoke-WebRequest -Uri $pythonEvalHealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PythonCmpReady {
    try {
        $response = Invoke-WebRequest -Uri $pythonCmpHealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PythonPoseReady {
    try {
        $response = Invoke-WebRequest -Uri $pythonPoseHealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-YuejuModelReady {
    try {
        $response = Invoke-WebRequest -Uri $yuejuModelHealthUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ne 200) { return $false }
        $data = $response.Content | ConvertFrom-Json
        return ($data.model_loaded -eq $true)
    } catch {
        return $false
    }
}

function Test-PdfImportReady {
    try {
        $response = Invoke-WebRequest -Uri $pdfImportHealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-TrackedProcess([string]$PidFile, [string]$ExpectedName) {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }

    $processIdText = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $processId = 0
    if (-not [int]::TryParse($processIdText, [ref]$processId)) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return $null
    }

    $trackedProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $trackedProcess -or $trackedProcess.ProcessName -ine $ExpectedName) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return $null
    }

    return $trackedProcess
}

function Find-MatchingTunnelProcess([string]$ConfigPath) {
    try {
        $normalizedConfig = [System.IO.Path]::GetFullPath($ConfigPath)
        return Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($normalizedConfig, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
            Select-Object -First 1
    } catch {
        return $null
    }
}

function Show-LogTail([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        Write-Host ("Recent log output ({0}):" -f $Path) -ForegroundColor DarkYellow
        Get-Content -LiteralPath $Path -Encoding UTF8 -Tail 30 -ErrorAction SilentlyContinue
    }
}

try {
    Set-Location -LiteralPath $projectRoot
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $runStamp = $null

    Write-Step 'Checking prerequisites'
    if (-not (Test-Path -LiteralPath $serverEntry)) {
        throw "Backend entry file was not found: $serverEntry"
    }
    if (-not (Test-Path -LiteralPath $tunnelConfig)) {
        throw "Cloudflare Tunnel config was not found: $tunnelConfig"
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw 'Node.js was not found. Install Node.js 18 or newer first.'
    }

    if (Test-Path -LiteralPath $localCloudflared) {
        $cloudflaredPath = $localCloudflared
    } else {
        $cloudflaredCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
        if ($null -eq $cloudflaredCommand) {
            throw 'cloudflared.exe was not found in the project or system PATH.'
        }
        $cloudflaredPath = $cloudflaredCommand.Source
    }

    $validationOutput = & $cloudflaredPath tunnel --config $tunnelConfig ingress validate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw ("Cloudflare Tunnel config validation failed: {0}" -f $validationOutput.Trim())
    }
    Write-Success 'Node.js, backend files, and tunnel config are valid'

    Write-Step 'Starting backend service'
    if (Test-BackendReady) {
        Write-Success 'Backend is already running at 127.0.0.1:3000'
    } else {
        $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backendStdout = Join-Path $runtimeDirectory ("backend-{0}.stdout.log" -f $runStamp)
        $backendStderr = Join-Path $runtimeDirectory ("backend-{0}.stderr.log" -f $runStamp)
        $backendProcess = Start-Process -FilePath $nodeCommand.Source `
            -ArgumentList @('server\server.js') `
            -WorkingDirectory $projectRoot `
            -RedirectStandardOutput $backendStdout `
            -RedirectStandardError $backendStderr `
            -WindowStyle Hidden `
            -PassThru
        Set-Content -LiteralPath $backendPidFile -Value $backendProcess.Id -Encoding ASCII

        $backendReady = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if (Test-BackendReady) {
                $backendReady = $true
                break
            }
            if ($backendProcess.HasExited) {
                break
            }
            Start-Sleep -Milliseconds 500
        }

        if (-not $backendReady) {
            Show-LogTail $backendStderr
            Show-LogTail $backendStdout
            if (-not $backendProcess.HasExited) {
                Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
            }
            throw 'Backend did not pass its health check within 20 seconds. The tunnel was not started.'
        }
        Write-Success ("Backend started (PID {0})" -f $backendProcess.Id)
    }

    # ------------------------------------------------------------------
    # 演唱测评 Python 分析服务（可选 sidecar）：
    #   已运行 → 跳过；未装 → 首次自动建 venv 装依赖（一次性，较慢）；
    #   启动失败仅告警不阻断主服务（网关会返回友好的 503 提示）。
    # ------------------------------------------------------------------
    Write-Step 'Starting singing evaluation service (Python sidecar)'
    if (Test-PythonEvalReady) {
        Write-Success 'Singing evaluation service is already running at 127.0.0.1:8765'
    } else {
        $pythonEvalStarted = $false
        if (-not (Test-Path -LiteralPath $pythonEvalPython)) {
            $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
            if ($null -eq $pythonCommand) {
                Write-WarningMessage 'Python was not found: singing evaluation stays offline. Install Python 3.10+ and rerun to enable it.'
            } else {
                Write-WarningMessage 'First-time setup for singing evaluation: creating venv and installing librosa/pyworld (one time, may take a few minutes)...'
                & $pythonCommand.Source -m venv $pythonEvalVenv
                if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pythonEvalPython)) {
                    Write-WarningMessage 'Failed to create the Python venv: singing evaluation stays offline.'
                } else {
                    & $pythonEvalPython -m pip install -r (Join-Path $pythonEvalDir 'requirements.txt') --no-warn-script-location
                    if ($LASTEXITCODE -ne 0) {
                        Write-WarningMessage 'Failed to install Python dependencies: singing evaluation stays offline.'
                    }
                }
            }
        }

        if (Test-Path -LiteralPath $pythonEvalPython) {
            if ($null -eq $runStamp) {
                $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            }
            $pythonEvalStdout = Join-Path $runtimeDirectory ("python-eval-{0}.stdout.log" -f $runStamp)
            $pythonEvalStderr = Join-Path $runtimeDirectory ("python-eval-{0}.stderr.log" -f $runStamp)
            $pythonEvalProcess = Start-Process -FilePath $pythonEvalPython `
                -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8765') `
                -WorkingDirectory $pythonEvalDir `
                -RedirectStandardOutput $pythonEvalStdout `
                -RedirectStandardError $pythonEvalStderr `
                -WindowStyle Hidden `
                -PassThru
            Set-Content -LiteralPath $pythonEvalPidFile -Value $pythonEvalProcess.Id -Encoding ASCII

            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                if (Test-PythonEvalReady) {
                    $pythonEvalStarted = $true
                    break
                }
                if ($pythonEvalProcess.HasExited) {
                    break
                }
                Start-Sleep -Milliseconds 500
            }

            if ($pythonEvalStarted) {
                Write-Success ("Singing evaluation service started (PID {0})" -f $pythonEvalProcess.Id)
            } else {
                Show-LogTail $pythonEvalStderr
                Write-WarningMessage 'Singing evaluation service did not become ready in time; the feature will return a friendly error until it is fixed.'
            }
        }
    }

    # ------------------------------------------------------------------
    # 剧本比对 Python 分析服务（可选 sidecar，127.0.0.1:8766）：
    #   已运行 → 跳过；未装 → 首次自动建 venv 装依赖（rapidfuzz/jieba/opencc）；
    #   启动失败仅告警不阻断主服务（网关会返回友好的 503 提示）。
    # ------------------------------------------------------------------
    Write-Step 'Starting script comparison service (Python sidecar)'
    if (Test-PythonCmpReady) {
        Write-Success 'Script comparison service is already running at 127.0.0.1:8766'
    } else {
        $pythonCmpStarted = $false
        if (-not (Test-Path -LiteralPath $pythonCmpPython)) {
            $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
            if ($null -eq $pythonCommand) {
                Write-WarningMessage 'Python was not found: script comparison stays offline. Install Python 3.10+ and rerun to enable it.'
            } else {
                Write-WarningMessage 'First-time setup for script comparison: creating venv and installing rapidfuzz/jieba/opencc (one time, may take a few minutes)...'
                & $pythonCommand.Source -m venv $pythonCmpVenv
                if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pythonCmpPython)) {
                    Write-WarningMessage 'Failed to create the Python venv: script comparison stays offline.'
                } else {
                    & $pythonCmpPython -m pip install -r (Join-Path $pythonCmpDir 'requirements.txt') --no-warn-script-location
                    if ($LASTEXITCODE -ne 0) {
                        Write-WarningMessage 'Failed to install Python dependencies: script comparison stays offline.'
                    }
                }
            }
        }

        if (Test-Path -LiteralPath $pythonCmpPython) {
            if ($null -eq $runStamp) {
                $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            }
            $pythonCmpStdout = Join-Path $runtimeDirectory ("python-cmp-{0}.stdout.log" -f $runStamp)
            $pythonCmpStderr = Join-Path $runtimeDirectory ("python-cmp-{0}.stderr.log" -f $runStamp)
            $pythonCmpProcess = Start-Process -FilePath $pythonCmpPython `
                -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8766') `
                -WorkingDirectory $pythonCmpDir `
                -RedirectStandardOutput $pythonCmpStdout `
                -RedirectStandardError $pythonCmpStderr `
                -WindowStyle Hidden `
                -PassThru
            Set-Content -LiteralPath $pythonCmpPidFile -Value $pythonCmpProcess.Id -Encoding ASCII

            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                if (Test-PythonCmpReady) {
                    $pythonCmpStarted = $true
                    break
                }
                if ($pythonCmpProcess.HasExited) {
                    break
                }
                Start-Sleep -Milliseconds 500
            }

            if ($pythonCmpStarted) {
                Write-Success ("Script comparison service started (PID {0})" -f $pythonCmpProcess.Id)
            } else {
                Show-LogTail $pythonCmpStderr
                Write-WarningMessage 'Script comparison service did not become ready in time; the feature will return a friendly error until it is fixed.'
            }
        }
    }

    # ------------------------------------------------------------------
    # 姿态比对评分服务（可选 sidecar，127.0.0.1:8767）：
    #   虚拟试衣页「越剧姿态挑战」直连此服务做 DTW 打分；
    #   已运行 → 跳过；未装 → 首次自动建 venv 装依赖（fastapi/numpy）；
    #   启动失败仅告警不阻断主服务（页面会显示评分服务未连接，换装不受影响）。
    # ------------------------------------------------------------------
    Write-Step 'Starting pose evaluation service (Python sidecar)'
    if (Test-PythonPoseReady) {
        Write-Success 'Pose evaluation service is already running at 127.0.0.1:8767'
    } else {
        $pythonPoseStarted = $false
        if (-not (Test-Path -LiteralPath $pythonPosePython)) {
            $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
            if ($null -eq $pythonCommand) {
                Write-WarningMessage 'Python was not found: pose evaluation stays offline. Install Python 3.10+ and rerun to enable it.'
            } else {
                Write-WarningMessage 'First-time setup for pose evaluation: creating venv and installing fastapi/numpy (one time)...'
                & $pythonCommand.Source -m venv $pythonPoseVenv
                if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pythonPosePython)) {
                    Write-WarningMessage 'Failed to create the Python venv: pose evaluation stays offline.'
                } else {
                    & $pythonPosePython -m pip install -r (Join-Path $pythonPoseDir 'requirements.txt') --no-warn-script-location
                    if ($LASTEXITCODE -ne 0) {
                        Write-WarningMessage 'Failed to install Python dependencies: pose evaluation stays offline.'
                    }
                }
            }
        }

        if (Test-Path -LiteralPath $pythonPosePython) {
            if ($null -eq $runStamp) {
                $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            }
            $pythonPoseStdout = Join-Path $runtimeDirectory ("python-pose-{0}.stdout.log" -f $runStamp)
            $pythonPoseStderr = Join-Path $runtimeDirectory ("python-pose-{0}.stderr.log" -f $runStamp)
            $pythonPoseProcess = Start-Process -FilePath $pythonPosePython `
                -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8767') `
                -WorkingDirectory $pythonPoseDir `
                -RedirectStandardOutput $pythonPoseStdout `
                -RedirectStandardError $pythonPoseStderr `
                -WindowStyle Hidden `
                -PassThru
            Set-Content -LiteralPath $pythonPosePidFile -Value $pythonPoseProcess.Id -Encoding ASCII

            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                if (Test-PythonPoseReady) {
                    $pythonPoseStarted = $true
                    break
                }
                if ($pythonPoseProcess.HasExited) {
                    break
                }
                Start-Sleep -Milliseconds 500
            }

            if ($pythonPoseStarted) {
                Write-Success ("Pose evaluation service started (PID {0})" -f $pythonPoseProcess.Id)
            } else {
                Show-LogTail $pythonPoseStderr
                Write-WarningMessage 'Pose evaluation service did not become ready in time; the pose challenge feature stays offline.'
            }
        }
    }

    # ------------------------------------------------------------------
    # PDF 导入 OCR 服务（可选 sidecar，127.0.0.1:8768）：
    #   教师「PDF 导入课程」依赖此服务做 OCR；复用 pose-eval venv 的 rapidocr。
    #   已运行 → 跳过；pose-eval venv 不存在 → 仅告警不阻断主服务。
    # ------------------------------------------------------------------
    Write-Step 'Starting PDF OCR service (Python sidecar)'
    if (Test-PdfImportReady) {
        Write-Success 'PDF OCR service is already running at 127.0.0.1:8768'
    } elseif (Test-Path -LiteralPath $pdfImportPython) {
        if ($null -eq $runStamp) {
            $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        }
        $pdfImportStdout = Join-Path $runtimeDirectory ("pdf-import-{0}.stdout.log" -f $runStamp)
        $pdfImportStderr = Join-Path $runtimeDirectory ("pdf-import-{0}.stderr.log" -f $runStamp)
        $pdfImportProcess = Start-Process -FilePath $pdfImportPython `
            -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8768') `
            -WorkingDirectory $pdfImportDir `
            -RedirectStandardOutput $pdfImportStdout `
            -RedirectStandardError $pdfImportStderr `
            -WindowStyle Hidden `
            -PassThru
        Set-Content -LiteralPath $pdfImportPidFile -Value $pdfImportProcess.Id -Encoding ASCII

        $pdfImportStarted = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-PdfImportReady) {
                $pdfImportStarted = $true
                break
            }
            if ($pdfImportProcess.HasExited) {
                break
            }
            Start-Sleep -Milliseconds 500
        }
        if ($pdfImportStarted) {
            Write-Success ("PDF OCR service started (PID {0})" -f $pdfImportProcess.Id)
        } else {
            Show-LogTail $pdfImportStderr
            Write-WarningMessage 'PDF OCR service did not become ready in time; PDF import feature stays offline.'
        }
    } else {
        Write-WarningMessage 'pose-eval venv not found; PDF OCR service stays offline. Run once to create it (pip install rapidocr pymupdf onnxruntime).'
    }

    # ------------------------------------------------------------------
    # 越剧知识问答 / ASR 纠错模型（可选 sidecar，127.0.0.1:3456）：
    #   server/services/yuejuAsrCorrect.js、yuejuLocalLlm.js 会调用它。
    #   已运行 → 跳过；未装 venv → 优先回退到已存在的英文路径 venv；
    #   都没有才在项目内建 venv 装依赖（torch 较大，首次较慢）。
    #   模型加载较慢，健康等待时间放长；失败仅告警不阻断主服务。
    # ------------------------------------------------------------------
    Write-Step 'Starting yueju QA/ASR-correct model (Python service)'

    # 低内存模式：.env 中配置 YUEJU_LOW_MEM=1 时，ASR 模型改用 fp16 半精度加载（内存减半，适合 4G 服务器）
    $lowMemFlag = $false
    $envFilePath = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $envFilePath) {
        $lowMemLine = Get-Content -LiteralPath $envFilePath -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '^\s*YUEJU_LOW_MEM\s*=\s*1\s*$' } |
            Select-Object -First 1
        if ($null -ne $lowMemLine) { $lowMemFlag = $true }
    }

    if (Test-YuejuModelReady) {
        Write-Success 'Yueju QA/ASR-correct model is already running at 127.0.0.1:3456'
    } else {
        $yuejuModelStarted = $false

        # 选择解释器：项目内 venv 优先，其次对外部已有 venv，最后才新建
        if (-not (Test-Path -LiteralPath $yuejuModelPythonProject)) {
            if (Test-Path -LiteralPath $yuejuModelPythonFallback) {
                Write-WarningMessage "Using existing venv: $yuejuModelPythonFallback"
            } else {
                $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
                if ($null -eq $pythonCommand) {
                    Write-WarningMessage 'Python was not found: yueju model stays offline. Install Python 3.10+ and rerun.'
                } else {
                    Write-WarningMessage 'First-time setup for yueju model: creating venv and installing torch/transformers/peft (one time, may take several minutes)...'
                    & $pythonCommand.Source -m venv $yuejuModelVenv
                    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $yuejuModelPythonProject)) {
                        & $yuejuModelPythonProject -m pip install -r (Join-Path $yuejuModelDir 'requirements.txt') --no-warn-script-location
                        if ($LASTEXITCODE -ne 0) {
                            Write-WarningMessage 'Failed to install yueju model dependencies: stays offline.'
                        }
                    } else {
                        Write-WarningMessage 'Failed to create project venv: yueju model stays offline.'
                    }
                }
            }
        }

        $yuejuModelPython = if (Test-Path -LiteralPath $yuejuModelPythonProject) { $yuejuModelPythonProject }
                            elseif (Test-Path -LiteralPath $yuejuModelPythonFallback) { $yuejuModelPythonFallback }
                            else { $null }

        if ($null -ne $yuejuModelPython) {
            if ($null -eq $runStamp) {
                $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            }
            $yuejuModelStdout = Join-Path $runtimeDirectory ("yueju-model-{0}.stdout.log" -f $runStamp)
            $yuejuModelStderr = Join-Path $runtimeDirectory ("yueju-model-{0}.stderr.log" -f $runStamp)
            # 基座模型走镜像可加速下载（已缓存则无影响）
            $env:HF_ENDPOINT = 'https://hf-mirror.com'
            $yuejuModelArgs = @('serve.py', '--host', '127.0.0.1', '--port', '3456')
            if ($lowMemFlag) { $yuejuModelArgs += '--low-mem' }
            $yuejuModelProcess = Start-Process -FilePath $yuejuModelPython `
                -ArgumentList $yuejuModelArgs `
                -WorkingDirectory $yuejuModelDir `
                -RedirectStandardOutput $yuejuModelStdout `
                -RedirectStandardError $yuejuModelStderr `
                -WindowStyle Hidden `
                -PassThru
            Set-Content -LiteralPath $yuejuModelPidFile -Value $yuejuModelProcess.Id -Encoding ASCII

            for ($attempt = 0; $attempt -lt 360; $attempt++) {
                if (Test-YuejuModelReady) {
                    $yuejuModelStarted = $true
                    break
                }
                if ($yuejuModelProcess.HasExited) {
                    break
                }
                Start-Sleep -Milliseconds 500
            }

            if ($yuejuModelStarted) {
                Write-Success ("Yueju model service started (PID {0})" -f $yuejuModelProcess.Id)
            } else {
                Show-LogTail $yuejuModelStderr
                Write-WarningMessage 'Yueju model did not become ready in time; QA/ASR-correct feature stays offline.'
            }
        }
    }

    Write-Step 'Starting Cloudflare Tunnel'
    $trackedTunnel = Get-TrackedProcess -PidFile $tunnelPidFile -ExpectedName 'cloudflared'
    if ($null -eq $trackedTunnel) {
        $matchingTunnel = Find-MatchingTunnelProcess -ConfigPath $tunnelConfig
        if ($null -ne $matchingTunnel) {
            Set-Content -LiteralPath $tunnelPidFile -Value $matchingTunnel.ProcessId -Encoding ASCII
            $trackedTunnel = Get-Process -Id $matchingTunnel.ProcessId -ErrorAction SilentlyContinue
        }
    }

    if ($null -ne $trackedTunnel) {
        Write-Success ("Cloudflare Tunnel is already running (PID {0})" -f $trackedTunnel.Id)
    } else {
        if ($null -eq $runStamp) {
            $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        }
        $tunnelStdout = Join-Path $runtimeDirectory ("cloudflared-{0}.stdout.log" -f $runStamp)
        $tunnelStderr = Join-Path $runtimeDirectory ("cloudflared-{0}.stderr.log" -f $runStamp)
        $quotedConfig = '"{0}"' -f $tunnelConfig
        # 默认自动选择 QUIC/HTTP2，避免某一种传输被出口网络临时阻断时形成假在线进程。
        $tunnelProcess = Start-Process -FilePath $cloudflaredPath `
            -ArgumentList @('tunnel', '--protocol', $tunnelProtocol, '--config', $quotedConfig, 'run') `
            -WorkingDirectory $projectRoot `
            -RedirectStandardOutput $tunnelStdout `
            -RedirectStandardError $tunnelStderr `
            -WindowStyle Hidden `
            -PassThru
        Set-Content -LiteralPath $tunnelPidFile -Value $tunnelProcess.Id -Encoding ASCII

        $tunnelConnected = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if ($tunnelProcess.HasExited) {
                break
            }
            if (Test-Path -LiteralPath $tunnelStderr) {
                $tunnelLog = Get-Content -LiteralPath $tunnelStderr -Raw -ErrorAction SilentlyContinue
                if ($tunnelLog -match 'Registered tunnel connection') {
                    $tunnelConnected = $true
                    break
                }
            }
            Start-Sleep -Milliseconds 500
        }

        if ($tunnelProcess.HasExited) {
            Show-LogTail $tunnelStderr
            throw ("Cloudflare Tunnel exited during startup with code {0}" -f $tunnelProcess.ExitCode)
        }
        if ($tunnelConnected) {
            Write-Success ("Cloudflare Tunnel connected (PID {0})" -f $tunnelProcess.Id)
        } else {
            Write-WarningMessage ("Cloudflare Tunnel is running (PID {0}); network handshake is still in progress" -f $tunnelProcess.Id)
        }
    }

    Write-Host ''
    Write-Host 'Local URL:  http://localhost:3000' -ForegroundColor White
    Write-Host 'Public URL: https://yueyun.xiaoqingyalove.online' -ForegroundColor White
    Write-Host ("Runtime logs: {0}" -f $runtimeDirectory) -ForegroundColor DarkGray
    exit 0
} catch {
    Write-Host ''
    Write-Host ("[FAILED] {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host ("Runtime logs: {0}" -f $runtimeDirectory) -ForegroundColor DarkGray
    exit 1
}
