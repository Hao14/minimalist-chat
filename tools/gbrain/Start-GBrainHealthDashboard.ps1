[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4317,
    [switch]$NoBrowser,
    [switch]$BuildOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dashboardRoot = Join-Path $PSScriptRoot 'dashboard'
$viteConfig = Join-Path $dashboardRoot 'vite.config.mjs'
$viteCommand = Join-Path $repoRoot 'node_modules\.bin\vite.cmd'
$serverScript = Join-Path $PSScriptRoot 'gbrain-health-server.mjs'

foreach ($requiredPath in @($viteConfig, $viteCommand, $serverScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required dashboard component is missing: $requiredPath"
    }
}

& $viteCommand build --config $viteConfig
if ($LASTEXITCODE -ne 0) {
    throw "Dashboard build failed with exit code $LASTEXITCODE."
}
if ($BuildOnly) {
    Write-Output "GBrain health dashboard build complete: $(Join-Path $dashboardRoot 'dist')"
    return
}

$url = "http://127.0.0.1:$Port"
$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $listenerCommand = [string]$listenerProcess.CommandLine
    $expectedArguments = "--host 127.0.0.1 --port $Port"
    if (-not $listenerProcess -or
        $listenerProcess.Name -ne 'node.exe' -or
        -not $listenerCommand.Contains($serverScript) -or
        -not $listenerCommand.Contains($expectedArguments)) {
        throw "Port $Port is already owned by an unrelated process."
    }
    Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ((Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue) {
        throw "Owned dashboard process did not stop cleanly: PID $($listener.OwningProcess)"
    }
}

$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$serverProcess = Start-Process -FilePath $nodeCommand -ArgumentList @(
    $serverScript, '--host', '127.0.0.1', '--port', [string]$Port
) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
$ready = $false
try {
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        throw "Dashboard server did not become ready at $url."
    }
} catch {
    if (Get-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
    throw
}

if (-not $NoBrowser) {
    Start-Process $url
}
Write-Output "GBrain health dashboard: $url (PID $($serverProcess.Id))"
