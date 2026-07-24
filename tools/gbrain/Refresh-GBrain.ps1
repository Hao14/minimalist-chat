[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipCode,
    [switch]$SkipEvaluation,
    [switch]$EnableExperimentalReranker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vaultMirror = Join-Path $env:USERPROFILE '.gbrain\sources\minimalist-chat-vault'
$codeMirror = Join-Path $env:USERPROFILE '.gbrain\sources\minimalist-chat-code'
$qrelsPath = Join-Path $repoRoot 'gbrain-evals\qrels\minimalist-chat-v3.qrels.json'
$exportVaultScript = Join-Path $PSScriptRoot 'Export-GBrainVaultSource.ps1'
$exportCodeScript = Join-Path $PSScriptRoot 'Export-GBrainCodeSource.ps1'
$rerankerScript = Join-Path $PSScriptRoot 'Start-GBrainReranker.ps1'
$linkBridge = Join-Path $repoRoot 'tools\import-gbrain-obsidian-links.py'
$productionEval = Join-Path $PSScriptRoot 'gbrain-retrieval-eval.mjs'
$productionEvalOutput = Join-Path $env:USERPROFILE '.gbrain\evals\minimalist-chat-latest.json'
$gbrainConfigPath = Join-Path $env:USERPROFILE '.gbrain\config.json'
$approvedOllamaBaseUrl = 'http://127.0.0.1:11434/v1'
$skillsRoot = Join-Path $repoRoot 'skills'
$bunExecutable = (Get-Command bun -ErrorAction Stop).Source
$gbrainCliSource = Join-Path $env:USERPROFILE '.bun\install\global\node_modules\gbrain\src\cli.ts'
if (-not (Test-Path -LiteralPath $gbrainCliSource -PathType Leaf)) {
    throw "The installed GBrain CLI source was not found: $gbrainCliSource"
}
if (-not (Test-Path -LiteralPath $gbrainConfigPath -PathType Leaf)) {
    throw "GBrain config was not found: $gbrainConfigPath"
}
$gbrainConfig = Get-Content -LiteralPath $gbrainConfigPath -Raw | ConvertFrom-Json
if ([string]$gbrainConfig.provider_base_urls.ollama -ne $approvedOllamaBaseUrl) {
    throw "GBrain Ollama base URL must be pinned to $approvedOllamaBaseUrl."
}
# GBrain also accepts an environment override. Pin it for every child process so
# inherited shell state can never redirect embeddings to protected port 11435
# or a remote host.
$env:OLLAMA_BASE_URL = $approvedOllamaBaseUrl

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)][string]$Program,
        [Parameter(Mandatory)][string[]]$Arguments,
        [int[]]$AllowedExitCodes = @(0)
    )

    & $Program @Arguments
    if ($AllowedExitCodes -notcontains $LASTEXITCODE) {
        throw "$Program failed with exit code $LASTEXITCODE."
    }
}

function Assert-GBrainDatabaseReleased {
    param([Parameter(Mandatory)][string]$Context)

    $lockPath = Join-Path $env:USERPROFILE '.gbrain\brain.pglite\.gbrain-lock\lock'
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ((Test-Path -LiteralPath $lockPath) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $lockPath)) {
        return
    }

    try {
        $record = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
        $owner = @(Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)")
        $ownerDetail = if ($owner.Count -eq 1) {
            "PID $($owner[0].ProcessId): $($owner[0].CommandLine)"
        } else {
            "dead or unavailable PID $($record.pid)"
        }
        throw "GBrain did not release PGLite after $Context ($ownerDetail). Refusing to start another database process."
    } catch {
        if ($_.Exception.Message -like 'GBrain did not release PGLite*') {
            throw
        }
        throw "GBrain left an unreadable ownership lock after $Context`: $lockPath"
    }
}

function Invoke-GBrainChecked {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [int[]]$AllowedExitCodes = @(0)
    )

    # Invoke Bun directly so PowerShell waits for the actual PGLite-owning
    # process rather than only the Windows package-manager launcher.
    & $bunExecutable $gbrainCliSource @Arguments
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "gbrain failed with exit code $exitCode."
    }
    Assert-GBrainDatabaseReleased -Context ("gbrain " + ($Arguments -join ' '))
}

function Invoke-GBrainCaptured {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [int[]]$AllowedExitCodes = @(0)
    )

    $output = & $bunExecutable $gbrainCliSource @Arguments
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "gbrain failed with exit code $exitCode."
    }
    Assert-GBrainDatabaseReleased -Context ("gbrain " + ($Arguments -join ' '))
    return ($output -join [Environment]::NewLine)
}

$serveProcesses = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -eq 'gbrain.exe' -or $_.Name -eq 'bun.exe') -and
            $_.CommandLine -match '(?i)\bgbrain(?:\.exe)?\b.*\bserve\b'
        }
)
if ($serveProcesses.Count -gt 0) {
    $owners = ($serveProcesses | ForEach-Object { "$($_.Name) PID $($_.ProcessId)" }) -join ', '
    throw "GBrain MCP is using the PGLite database ($owners). Close/disconnect it, then rerun this refresh. The script never kills the live owner."
}

try {
    $ollamaTags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
} catch {
    throw 'Tray Ollama is not reachable at 127.0.0.1:11434.'
}
$ollamaModelNames = @($ollamaTags.models | ForEach-Object { $_.name })
if (-not ($ollamaModelNames | Where-Object { $_ -eq 'mxbai-embed-large:latest' -or $_ -eq 'mxbai-embed-large' })) {
    throw 'Ollama model mxbai-embed-large is not installed.'
}

if ($EnableExperimentalReranker -and -not $DryRun) {
    & $rerankerScript -VerifyHashes
}

if ($DryRun) {
    & $exportVaultScript -Preview
    if (-not $SkipCode) {
        & $exportCodeScript -Preview
    }
    Invoke-NativeChecked -Program 'python' -Arguments @($linkBridge, '--strict')

    $sourceText = Invoke-GBrainCaptured -Arguments @('sources', 'list', '--json')
    $sources = $sourceText | ConvertFrom-Json
    if (@($sources.sources.id) -contains 'default') {
        Invoke-GBrainChecked -Arguments @(
            'sync', '--source', 'default', '--repo', $vaultMirror,
            '--strategy', 'markdown', '--full', '--dry-run', '--no-pull', '--workers', '1'
        )
    }
    if (-not $SkipCode -and @($sources.sources.id) -contains 'minimalist-chat-code') {
        Invoke-GBrainChecked -Arguments @(
            'sync', '--source', 'minimalist-chat-code', '--repo', $codeMirror,
            '--strategy', 'code', '--full', '--dry-run', '--no-pull', '--workers', '1'
        )
    }
    Write-Output 'Dry run complete; no GBrain pages, links, timeline entries, or mirror files were changed.'
    return
}

& $exportVaultScript
$sourceText = Invoke-GBrainCaptured -Arguments @('sources', 'list', '--json')
$sources = $sourceText | ConvertFrom-Json
if (-not (@($sources.sources.id) -contains 'default')) {
    Invoke-GBrainChecked -Arguments @(
        'sources', 'add', 'default', '--path', $vaultMirror,
        '--name', 'Minimalist Chat Vault', '--federated'
    )
}
Invoke-GBrainChecked -Arguments @('sources', 'federate', 'default')
Invoke-GBrainChecked -Arguments @(
    'sync', '--source', 'default', '--repo', $vaultMirror,
    '--strategy', 'markdown', '--full', '--no-pull', '--workers', '1', '--yes'
)
Invoke-GBrainChecked -Arguments @(
    'extract', '--stale', '--source-id', 'default', '--catch-up', '--json'
)
Invoke-NativeChecked -Program 'python' -Arguments @($linkBridge, '--apply', '--strict', '--quiet')

if (-not $SkipCode) {
    & $exportCodeScript

    $sourceText = Invoke-GBrainCaptured -Arguments @('sources', 'list', '--json')
    $sources = $sourceText | ConvertFrom-Json
    if (-not (@($sources.sources.id) -contains 'minimalist-chat-code')) {
        Invoke-GBrainChecked -Arguments @(
            'sources', 'add', 'minimalist-chat-code', '--path', $codeMirror,
            '--name', 'Minimalist Chat Code', '--no-federated'
        )
    }
    Invoke-GBrainChecked -Arguments @(
        'sources', 'unfederate', 'minimalist-chat-code'
    )

    Invoke-GBrainChecked -Arguments @(
        'sync', '--source', 'minimalist-chat-code', '--repo', $codeMirror,
        '--strategy', 'code', '--full', '--no-pull', '--workers', '1', '--yes'
    )
    Invoke-GBrainChecked -Arguments @(
        'edges-backfill', '--source', 'minimalist-chat-code', '--max-chunks', '50000',
        '--workers', '1', '--json'
    )
}

if (-not $SkipEvaluation) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $productionEvalOutput) -Force | Out-Null
    Invoke-NativeChecked -Program 'node' -Arguments @(
        $productionEval, '--qrels', $qrelsPath, '--output', $productionEvalOutput,
        '--authority-ranking', '--gate', '--quiet'
    )
    $evalReport = Get-Content -LiteralPath $productionEvalOutput -Raw | ConvertFrom-Json
    $categoryCount = @($evalReport.per_category.PSObject.Properties).Count
    Write-Output (
        'Retrieval V3 gate passed ({0} cases, {1} categories): hit@3 {2:P1}, recall@{3} {4:P1}, MRR {5:N3}, nDCG@10 {6:N3}, expected top-1 {7:P1}, source scope {8:P1}, negative checks {9:P1}, p95 {10} ms.' -f
        [int]$evalReport.summary.cases,
        [int]$categoryCount,
        [double]$evalReport.summary.hit_at_3_rate,
        [int]$evalReport.k,
        [double]$evalReport.summary.mean_recall_at_k,
        [double]$evalReport.summary.mean_reciprocal_rank,
        [double]$evalReport.summary.mean_ndcg_at_10,
        [double]$evalReport.summary.expected_top1_hit_rate,
        [double]$evalReport.summary.source_scope_pass_rate,
        [double]$evalReport.summary.negative_check_pass_rate,
        [int]$evalReport.summary.p95_latency_ms
    )
}

Invoke-GBrainChecked -Arguments @(
    'models', '_', 'doctor', '--skip=anthropic', '--json'
)
$previousSkillsDirectory = $env:GBRAIN_SKILLS_DIR
try {
    $env:GBRAIN_SKILLS_DIR = $skillsRoot
    $doctorJson = Invoke-GBrainCaptured -Arguments @('doctor', '--json') -AllowedExitCodes @(0, 1)
    $doctorExitCode = 0
} finally {
    if ($null -eq $previousSkillsDirectory) {
        Remove-Item Env:GBRAIN_SKILLS_DIR -ErrorAction SilentlyContinue
    } else {
        $env:GBRAIN_SKILLS_DIR = $previousSkillsDirectory
    }
}
if ($doctorExitCode -notin @(0, 1)) {
    throw "gbrain doctor failed with exit code $doctorExitCode."
}
$doctorReport = $doctorJson | ConvertFrom-Json
$failedChecks = @($doctorReport.checks | Where-Object { $_.status -eq 'fail' })
$unexpectedFailures = @($failedChecks | Where-Object { $_.name -ne 'cycle_freshness' })
if ($unexpectedFailures.Count -gt 0) {
    $failureNames = ($unexpectedFailures.name -join ', ')
    throw "GBrain doctor reported unexpected failed checks: $failureNames"
}
if ($failedChecks.Count -gt 0) {
    Write-Warning 'GBrain full-cycle freshness remains intentionally deferred; dream/autopilot is not safe for the active Windows PGLite workflow.'
}
$doctorJson
Invoke-GBrainChecked -Arguments @('stats')

Write-Output 'GBrain refresh complete.'
