[CmdletBinding()]
param(
    [switch]$VerifyHashes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rerankerRoot = Join-Path $env:USERPROFILE '.gbrain\local-reranker'
$runtimeDirectory = Join-Path $rerankerRoot 'runtime-b10076'
$serverExecutable = Join-Path $runtimeDirectory 'llama-server.exe'
$modelPath = Join-Path $rerankerRoot 'models\Jina-Bert-Implementation-38M-F16.gguf'
$logsDirectory = Join-Path $rerankerRoot 'logs'
$alias = 'jina-reranker-v1-turbo-en'
$healthUrl = 'http://127.0.0.1:8081/health'
$modelsUrl = 'http://127.0.0.1:8081/v1/models'
$rerankUrl = 'http://127.0.0.1:8081/v1/rerank'
$requiredUbatchSize = 2048

if (-not (Test-Path -LiteralPath $serverExecutable -PathType Leaf)) {
    throw "llama-server is missing: $serverExecutable"
}
if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
    throw "Reranker model is missing: $modelPath"
}

if ($VerifyHashes) {
    $expectedModelHash = '71abc010bb3dce97812ee971509a5cb6ff6f6b8cfffd8480129242f605521fca'
    $actualModelHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualModelHash -ne $expectedModelHash) {
        throw "Reranker model hash mismatch. Expected $expectedModelHash, got $actualModelHash"
    }
}

$listeners = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)
$nonLoopbackListeners = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
if ($nonLoopbackListeners.Count -gt 0) {
    $bindings = ($nonLoopbackListeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) PID $($_.OwningProcess)" }) -join ', '
    throw "Port 8081 has a non-loopback listener; refusing an unsafe reranker binding: $bindings"
}
$listenerOwners = @($listeners.OwningProcess | Sort-Object -Unique)
if ($listenerOwners.Count -gt 1) {
    throw "Multiple processes own loopback port 8081; refusing ambiguous reranker state: $($listenerOwners -join ', ')"
}
$existingListener = $listeners | Select-Object -First 1
$processId = $null
$alreadyRunning = $false
if ($existingListener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($existingListener.OwningProcess)"
    if (-not $owner -or $owner.ExecutablePath -ne $serverExecutable) {
        throw "Port 8081 is owned by another process (PID $($existingListener.OwningProcess)); refusing to replace it."
    }
    $modelArgumentPattern = "(?i)--model\s+`"?$([Regex]::Escape($modelPath))`"?(?:\s|$)"
    if ($owner.CommandLine -notmatch $modelArgumentPattern) {
        throw "The existing GBrain reranker (PID $($existingListener.OwningProcess)) was launched with a different model."
    }
    if ($owner.CommandLine -notmatch "(?i)--ubatch-size(?:=|\s+)$requiredUbatchSize(?:\s|$)") {
        throw "The existing GBrain reranker (PID $($existingListener.OwningProcess)) uses an outdated batch size. Stop that exact process and rerun this script."
    }
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
        $models = Invoke-RestMethod -Uri $modelsUrl -TimeoutSec 3
        $modelIds = @($models.data | ForEach-Object { $_.id })
        if ($health.status -eq 'ok' -and $modelIds -contains $alias) {
            $processId = [int]$existingListener.OwningProcess
            $alreadyRunning = $true
        }
    } catch {
        # The explicit port ownership error below is clearer than the HTTP exception.
    }
    if (-not $alreadyRunning) {
        throw "Port 8081 is owned by an unhealthy reranker process (PID $($existingListener.OwningProcess)); refusing to replace it."
    }
}

if (-not $alreadyRunning) {
    New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
    $stdoutLog = Join-Path $logsDirectory 'llama-server.out.log'
    $stderrLog = Join-Path $logsDirectory 'llama-server.err.log'

    $quotedModelPath = '"' + $modelPath.Replace('"', '\"') + '"'
    $arguments = @(
        '--model', $quotedModelPath,
        '--reranking',
        '--alias', $alias,
        '--host', '127.0.0.1',
        '--port', '8081',
        '--ctx-size', '4096',
        '--batch-size', '2048',
        '--ubatch-size', "$requiredUbatchSize",
        '--parallel', '1',
        '--no-webui'
    )

    $startParameters = @{
        FilePath = $serverExecutable
        ArgumentList = $arguments
        WorkingDirectory = $runtimeDirectory
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $stdoutLog
        RedirectStandardError = $stderrLog
        PassThru = $true
    }
    $process = Start-Process @startParameters
    $processId = $process.Id

    $ready = $false
    foreach ($attempt in 1..30) {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) {
            break
        }
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($health.status -eq 'ok') {
                $ready = $true
                break
            }
        } catch {
            # Model loading is expected to refuse health requests briefly.
        }
    }

    if (-not $ready) {
        $tail = if (Test-Path -LiteralPath $stderrLog) {
            (Get-Content -LiteralPath $stderrLog -Tail 40) -join [Environment]::NewLine
        } else {
            'No llama-server error log was created.'
        }
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        throw "Reranker did not become healthy. Last log lines:`n$tail"
    }
}

try {
$probeBody = @{
    model = $alias
    query = 'Which planet is known as the Red Planet?'
    documents = @(
        "Venus is often called Earth's twin because of its similar size and proximity.",
        'Mars, known for its reddish appearance, is often referred to as the Red Planet.',
        'Jupiter, the largest planet in our solar system, has a prominent red spot.',
        'Saturn, famous for its rings, is sometimes mistaken for the Red Planet.'
    )
    top_n = 4
} | ConvertTo-Json
$probeParameters = @{
    Method = 'Post'
    Uri = $rerankUrl
    ContentType = 'application/json'
    Body = $probeBody
    TimeoutSec = 15
}
$probe = Invoke-RestMethod @probeParameters

$probeResults = @($probe.results)
if ($probeResults.Count -lt 2 -or [int]$probeResults[0].index -ne 1) {
    $probeSummary = $probeResults | Select-Object index, relevance_score | ConvertTo-Json -Compress
    throw "Reranker functional probe failed: the Mars passage was not ranked first. Results: $probeSummary"
}
$scoreMargin = [double]$probeResults[0].relevance_score - [double]$probeResults[1].relevance_score
if ($scoreMargin -lt 0.005) {
    throw "Reranker functional probe was not decisive enough (score margin $scoreMargin)."
}

$longProbeBody = @{
    model = $alias
    query = 'Which passage discusses alpha?'
    documents = @(
        ('alpha ' * 1200),
        ('beta ' * 1200)
    )
    top_n = 2
} | ConvertTo-Json
$longProbeParameters = @{
    Method = 'Post'
    Uri = $rerankUrl
    ContentType = 'application/json'
    Body = $longProbeBody
    TimeoutSec = 30
}
$longProbe = Invoke-RestMethod @longProbeParameters
if (@($longProbe.results).Count -ne 2 -or [int]$longProbe.results[0].index -ne 0) {
    throw 'Reranker long-input probe failed; GBrain would fall back on larger chunks.'
}

$state = if ($alreadyRunning) { 'already ready' } else { 'ready' }
Write-Output "GBrain reranker is $state on 127.0.0.1:8081 (PID $processId, score margin $([Math]::Round($scoreMargin, 4)), 2,048-token physical batch verified)."
} catch {
    if (-not $alreadyRunning -and $processId) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    throw
}
