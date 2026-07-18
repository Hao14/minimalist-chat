[CmdletBinding()]
param(
    [string]$Stages = '100,200,400,1000',
    [int]$SubmitConcurrency = 120,
    [int]$QueueWorkerConcurrency = 1,
    [switch]$ConfirmProviderUsage
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$firebaseNode22 = Join-Path $repoRoot 'tools\firebase-node22.ps1'
$emulatorConfig = Join-Path $repoRoot 'firebase.live-ai-load.json'

if (-not $ConfirmProviderUsage) {
    throw 'This test invokes real AI providers. Re-run with -ConfirmProviderUsage.'
}
if (-not (Test-Path -LiteralPath $firebaseNode22)) {
    throw "The Node 22 Firebase launcher was not found at $firebaseNode22"
}
if (-not (Test-Path -LiteralPath $emulatorConfig)) {
    throw "The isolated emulator config was not found at $emulatorConfig"
}
function Read-FirebaseSecret {
    param([Parameter(Mandatory = $true)][string]$Name)

    $value = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $firebaseNode22 functions:secrets:access $Name --project chat-app-356c1 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Firebase secret $Name is unavailable."
    }
    $text = ($value | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "Firebase secret $Name is empty."
    }
    return $text
}

Push-Location -LiteralPath $repoRoot
try {
    $env:GROQ_API_KEY = Read-FirebaseSecret 'GROQ_API_KEY'
    $env:OLLAMA_SERVER_TOKEN = Read-FirebaseSecret 'OLLAMA_SERVER_TOKEN'
    $env:CLOUDFLARE_AI_API_TOKEN = Read-FirebaseSecret 'CLOUDFLARE_AI_API_TOKEN'
    $env:AI_LIVE_LOAD_CONFIRM = 'I_ACCEPT_PROVIDER_USAGE'
    $env:AI_LIVE_LOAD_STAGES = $Stages
    $env:AI_LIVE_LOAD_SUBMIT_CONCURRENCY = [string]([Math]::Max(1, [Math]::Min(200, $SubmitConcurrency)))
    $env:AI_LIVE_LOAD_QUEUE_WORKER_CONCURRENCY = [string]([Math]::Max(1, [Math]::Min(8, $QueueWorkerConcurrency)))

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $firebaseNode22 --config $emulatorConfig emulators:exec --only auth,database --project chat-app-356c1 'node tools/ai-live-load-orchestrator.mjs'
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:OLLAMA_SERVER_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:CLOUDFLARE_AI_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:AI_LIVE_LOAD_CONFIRM -ErrorAction SilentlyContinue
    Remove-Item Env:AI_LIVE_LOAD_STAGES -ErrorAction SilentlyContinue
    Remove-Item Env:AI_LIVE_LOAD_SUBMIT_CONCURRENCY -ErrorAction SilentlyContinue
    Remove-Item Env:AI_LIVE_LOAD_QUEUE_WORKER_CONCURRENCY -ErrorAction SilentlyContinue
    Pop-Location
}

exit $exitCode
