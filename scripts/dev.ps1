<#
.SYNOPSIS
  백엔드(FastAPI, :8000)와 프론트엔드(Vite, :5173) 개발 서버를 한 번에 켜고 끈다.

.EXAMPLE
  .\dev start     # 둘 다 백그라운드로 실행 (로그: .dev\logs)
  .\dev stop      # 둘 다 종료
  .\dev restart
  .\dev status
  .\dev logs      # 두 서버 로그를 실시간으로 보기 (Ctrl+C로 빠져나옴, 서버는 계속 실행)
#>
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Command = 'start'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DevDir = Join-Path $Root '.dev'
$LogDir = Join-Path $DevDir 'logs'

$Services = @(
    @{ Name = 'backend';  Port = 8000; Dir = Join-Path $Root 'backend';  Url = 'http://127.0.0.1:8000/docs' },
    @{ Name = 'frontend'; Port = 5173; Dir = Join-Path $Root 'frontend'; Url = 'http://localhost:5173' }
)

function Get-PortOwner([int]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return $null
}

function Stop-Tree([int]$ProcessId) {
    # uvicorn --reload, npm 은 자식 프로세스를 띄우므로 트리째 종료한다.
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Find-Stockfish {
    if ($env:STOCKFISH_PATH) { return $env:STOCKFISH_PATH }
    $cmd = Get-Command stockfish -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # winget 설치 직후에는 PATH가 아직 갱신되지 않았을 수 있다.
    $pkgs = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $pkgs) {
        $exe = Get-ChildItem $pkgs -Recurse -Filter 'stockfish*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe) { return $exe.FullName }
    }
    return $null
}

function Wait-Port([int]$Port, [int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Get-PortOwner $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-Dev {
    New-Item -ItemType Directory -Force $LogDir | Out-Null

    foreach ($svc in $Services) {
        $owner = Get-PortOwner $svc.Port
        if ($owner) {
            Write-Host ("[{0}] 포트 {1}을(를) 이미 PID {2}가 쓰고 있습니다. 먼저 '.\dev stop'을 실행하세요." -f $svc.Name, $svc.Port, $owner) -ForegroundColor Yellow
            return
        }
    }

    # 의존성이 없으면 설치한다.
    if (-not (Test-Path (Join-Path $Root 'backend\.venv'))) {
        Write-Host '[backend] uv sync ...'
        Push-Location (Join-Path $Root 'backend'); try { & uv sync } finally { Pop-Location }
    }
    if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) {
        Write-Host '[frontend] npm install ...'
        Push-Location (Join-Path $Root 'frontend'); try { & npm.cmd install } finally { Pop-Location }
    }

    $stockfish = Find-Stockfish
    if ($stockfish) {
        $env:STOCKFISH_PATH = $stockfish
    } else {
        Write-Host '[backend] Stockfish를 찾지 못했습니다. 엔진 분석 없이 실행합니다. (winget install Stockfish.Stockfish)' -ForegroundColor Yellow
    }

    $commands = @{
        backend  = @{ File = 'uv';      Args = 'run uvicorn app.main:app --reload --port 8000' }
        frontend = @{ File = 'npm.cmd'; Args = 'run dev -- --port 5173 --strictPort' }
    }

    foreach ($svc in $Services) {
        $c = $commands[$svc.Name]
        $out = Join-Path $LogDir "$($svc.Name).log"
        $err = Join-Path $LogDir "$($svc.Name).err.log"
        $proc = Start-Process -FilePath $c.File -ArgumentList $c.Args -WorkingDirectory $svc.Dir `
            -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
        Set-Content -Path (Join-Path $DevDir "$($svc.Name).pid") -Value $proc.Id -Encoding ascii
        Write-Host ("[{0}] 시작 (PID {1})" -f $svc.Name, $proc.Id)
    }

    foreach ($svc in $Services) {
        if (Wait-Port $svc.Port 60) {
            Write-Host ("[{0}] 준비됨  {1}" -f $svc.Name, $svc.Url) -ForegroundColor Green
        } else {
            Write-Host ("[{0}] 60초 안에 뜨지 않았습니다. 로그: {1}" -f $svc.Name, (Join-Path $LogDir "$($svc.Name).err.log")) -ForegroundColor Red
        }
    }
    if ($stockfish) { Write-Host "Stockfish: $stockfish" }
}

function Stop-Dev {
    foreach ($svc in $Services) {
        $stopped = $false
        $pidFile = Join-Path $DevDir "$($svc.Name).pid"
        if (Test-Path $pidFile) {
            $procId = [int](Get-Content $pidFile -Raw)
            if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Stop-Tree $procId; $stopped = $true }
            Remove-Item $pidFile -Force
        }
        # 스크립트 밖에서 띄운 서버도 포트로 찾아 끈다.
        $owner = Get-PortOwner $svc.Port
        if ($owner) { Stop-Tree $owner; $stopped = $true }
        if ($stopped) { Write-Host ("[{0}] 종료" -f $svc.Name) } else { Write-Host ("[{0}] 실행 중이 아님" -f $svc.Name) }
    }
}

function Show-Status {
    foreach ($svc in $Services) {
        $owner = Get-PortOwner $svc.Port
        if ($owner) {
            Write-Host ("[{0}] 실행 중  PID {1}  {2}" -f $svc.Name, $owner, $svc.Url) -ForegroundColor Green
        } else {
            Write-Host ("[{0}] 꺼짐" -f $svc.Name)
        }
    }
}

function Show-Logs {
    $files = Get-ChildItem $LogDir -Filter '*.log' -ErrorAction SilentlyContinue
    if (-not $files) { Write-Host '로그가 없습니다. 먼저 .\dev start'; return }
    Get-Content -Path $files.FullName -Wait -Tail 20
}

switch ($Command) {
    'start'   { Start-Dev }
    'stop'    { Stop-Dev }
    'restart' { Stop-Dev; Start-Sleep -Seconds 1; Start-Dev }
    'status'  { Show-Status }
    'logs'    { Show-Logs }
}
