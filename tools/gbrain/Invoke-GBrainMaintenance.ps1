[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipCode,
    [switch]$SkipEvaluation,
    [switch]$SkipRelationships,
    [switch]$SkipRestoreDrill,
    [switch]$SkipVision,
    [ValidateRange(1, 100)]
    [int]$BackupRetentionCount = 7
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vaultRoot = Join-Path $repoRoot 'Minimalist-chat-vault'
$backupScript = Join-Path $PSScriptRoot 'Backup-GBrain.ps1'
$refreshScript = Join-Path $PSScriptRoot 'Refresh-GBrain.ps1'
$relationshipScript = Join-Path $PSScriptRoot 'Enrich-ProjectRelationships.mjs'
$visionScript = Join-Path $PSScriptRoot 'Analyze-ProjectTimelineVision.mjs'
$gbrainExecutable = Join-Path $env:USERPROFILE '.bun\bin\gbrain.exe'
$gbrainCliSource = Join-Path $env:USERPROFILE '.bun\install\global\node_modules\gbrain\src\cli.ts'
$gbrainAuthorityProxy = Join-Path $PSScriptRoot 'gbrain-authority-mcp-proxy.mjs'
$maintenanceRoot = Join-Path $env:USERPROFILE '.gbrain\maintenance'
$latestSummaryPath = Join-Path $maintenanceRoot 'minimalist-chat-latest.json'
$evaluationPath = Join-Path $env:USERPROFILE '.gbrain\evals\minimalist-chat-latest.json'

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)][string]$Program,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$Capture
    )

    if ($Capture) {
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            # Windows PowerShell 5 promotes native stderr redirected through
            # 2>&1 into ErrorRecord objects. Informational stderr (for example
            # GBrain's sync-watchdog notice) must be captured and judged by the
            # native exit code, not promoted into a terminating PowerShell error.
            $ErrorActionPreference = 'Continue'
            $output = & $Program @Arguments 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($exitCode -ne 0) {
            throw "$Program failed with exit code $exitCode.`n$($output -join [Environment]::NewLine)"
        }
        return ($output -join [Environment]::NewLine)
    }

    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE."
    }
}

function Get-GBrainMcpRegistration {
    param([Parameter(Mandatory)][string]$CodexCommand)

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # A missing registration is an expected state while this coordinator
        # owns maintenance. PowerShell 5 can otherwise promote native stderr to
        # a terminating ErrorRecord before we can inspect the process exit code.
        $ErrorActionPreference = 'Continue'
        $output = & $CodexCommand mcp get gbrain 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        return [pscustomobject]@{
            registered = $false
            raw = ($output -join [Environment]::NewLine)
            command = $null
            arguments = $null
        }
    }

    $text = $output -join [Environment]::NewLine
    $commandMatch = [regex]::Match($text, '(?m)^\s*command:\s*(.+?)\s*$')
    $argumentsMatch = [regex]::Match($text, '(?m)^\s*args:\s*(.+?)\s*$')
    $transportMatch = [regex]::Match($text, '(?m)^\s*transport:\s*(.+?)\s*$')
    $enabledMatch = [regex]::Match($text, '(?m)^\s*enabled:\s*(.+?)\s*$')

    return [pscustomobject]@{
        registered = $true
        raw = $text
        command = if ($commandMatch.Success) { $commandMatch.Groups[1].Value.Trim() } else { $null }
        arguments = if ($argumentsMatch.Success) { $argumentsMatch.Groups[1].Value.Trim() } else { $null }
        transport = if ($transportMatch.Success) { $transportMatch.Groups[1].Value.Trim() } else { $null }
        enabled = if ($enabledMatch.Success) { $enabledMatch.Groups[1].Value.Trim() } else { $null }
    }
}

function Assert-ExpectedMcpRegistration {
    param([Parameter(Mandatory)]$Registration)

    if (-not $Registration.registered) {
        return
    }
    $commandLeaf = [IO.Path]::GetFileName([string]$Registration.command)
    $proxyArgument = ([string]$Registration.arguments).Trim().Trim('"')
    $legacyRegistration = $Registration.command -eq $gbrainExecutable -and $Registration.arguments -eq 'serve'
    $authorityRegistration = $commandLeaf -in @('node', 'node.exe') -and $proxyArgument -eq $gbrainAuthorityProxy
    if ((-not $legacyRegistration -and -not $authorityRegistration) -or
        $Registration.transport -ne 'stdio' -or
        $Registration.enabled -ne 'true') {
        throw "The registered GBrain MCP configuration is not the expected local stdio command. Refusing to rewrite it.`n$($Registration.raw)"
    }
}

function Get-GBrainMcpAddArguments {
    param([Parameter(Mandatory)]$Registration)

    $commandLeaf = [IO.Path]::GetFileName([string]$Registration.command)
    $proxyArgument = ([string]$Registration.arguments).Trim().Trim('"')
    if ($commandLeaf -in @('node', 'node.exe') -and $proxyArgument -eq $gbrainAuthorityProxy) {
        return @('mcp', 'add', 'gbrain', '--', (Get-Command node -ErrorAction Stop).Source, $gbrainAuthorityProxy)
    }
    return @('mcp', 'add', 'gbrain', '--', $gbrainExecutable, 'serve')
}

function Get-GBrainRuntimeProcesses {
    return @(
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.Name -eq 'gbrain.exe' -or
                ($_.Name -eq 'bun.exe' -and $_.CommandLine -and $_.CommandLine.Contains($gbrainCliSource)) -or
                ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($gbrainAuthorityProxy))
            }
    )
}

function Test-ExpectedServeProcess {
    param([Parameter(Mandatory)]$Process)

    $commandLine = [string]$Process.CommandLine
    if ($Process.Name -eq 'gbrain.exe') {
        $expectedQuoted = '"' + $gbrainExecutable + '" serve'
        $expectedBare = $gbrainExecutable + ' serve'
        # Older authority-proxy processes used PATH lookup, so Windows recorded
        # the exact child command as `gbrain serve`. Accept only that exact
        # transitional spelling (and its .exe equivalent) for safe shutdown;
        # new proxy processes launch the pinned absolute executable above.
        return $commandLine.Trim() -in @(
            $expectedQuoted,
            $expectedBare,
            'gbrain serve',
            'gbrain.exe serve',
            '"gbrain.exe" serve'
        )
    }
    if ($Process.Name -eq 'bun.exe') {
        return $commandLine.Contains($gbrainCliSource) -and
            $commandLine.Trim() -match '(?i)\sserve\s*$'
    }
    if ($Process.Name -eq 'node.exe') {
        $nodePrefix = '(?:"[^"]*\\node\.exe"|(?:\S*\\)?node(?:\.exe)?)'
        $proxyArgument = '"?' + [regex]::Escape($gbrainAuthorityProxy) + '"?'
        return $commandLine.Trim() -match ('^' + $nodePrefix + '\s+' + $proxyArgument + '\s*$')
    }
    return $false
}

function Stop-ExpectedServeProcesses {
    $processes = @(Get-GBrainRuntimeProcesses)
    $unexpected = @($processes | Where-Object { -not (Test-ExpectedServeProcess $_) })
    if ($unexpected.Count -gt 0) {
        $details = ($unexpected | ForEach-Object { "$($_.Name) PID $($_.ProcessId): $($_.CommandLine)" }) -join [Environment]::NewLine
        throw "An unexpected GBrain process is active. Refusing to stop it.`n$details"
    }

    foreach ($process in ($processes | Sort-Object @{ Expression = { if ($_.Name -eq 'bun.exe') { 0 } elseif ($_.Name -eq 'gbrain.exe') { 1 } else { 2 } } })) {
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
    }
    if ($processes.Count -gt 0) {
        Start-Sleep -Milliseconds 750
    }

    $remaining = @(Get-GBrainRuntimeProcesses)
    $unexpectedRemaining = @($remaining | Where-Object { -not (Test-ExpectedServeProcess $_) })
    if ($unexpectedRemaining.Count -gt 0) {
        throw 'An unexpected GBrain process appeared while stopping the MCP owner.'
    }
    foreach ($process in $remaining) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    }
    if ($remaining.Count -gt 0) {
        Start-Sleep -Milliseconds 500
    }
    $stillRunning = @(Get-GBrainRuntimeProcesses)
    if ($stillRunning.Count -gt 0) {
        $owners = ($stillRunning | ForEach-Object { "$($_.Name) PID $($_.ProcessId)" }) -join ', '
        throw "GBrain processes did not stop: $owners"
    }
    return $processes.Count
}

function Remove-StaleExpectedOwnershipLock {
    param([Parameter(Mandatory)][AllowEmptyCollection()][int[]]$ExpectedOwnerPids)

    $databasePath = Join-Path $env:USERPROFILE '.gbrain\brain.pglite'
    $lockDirectory = Join-Path $databasePath '.gbrain-lock'
    $lockPath = Join-Path $lockDirectory 'lock'
    if (-not (Test-Path -LiteralPath $lockDirectory)) {
        return $false
    }

    $lockDirectoryItem = Get-Item -LiteralPath $lockDirectory -Force
    if (-not $lockDirectoryItem.PSIsContainer -or
        ($lockDirectoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing an unexpected GBrain ownership-lock object: $lockDirectory"
    }
    $children = @(Get-ChildItem -LiteralPath $lockDirectory -Force)
    if ($children.Count -ne 1 -or
        $children[0].Name -ne 'lock' -or
        $children[0].PSIsContainer -or
        ($children[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to clean a GBrain ownership lock with unexpected contents: $lockDirectory"
    }

    try {
        $lockRecord = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
        $lockPid = [int]$lockRecord.pid
    } catch {
        throw "The stopped GBrain ownership lock is not valid JSON: $lockPath"
    }
    if ($lockPid -le 0 -or $ExpectedOwnerPids -notcontains $lockPid) {
        throw "The GBrain ownership lock PID $lockPid was not one of the exact serve processes stopped by this run."
    }
    if (@(Get-CimInstance Win32_Process -Filter "ProcessId = $lockPid").Count -gt 0) {
        throw "The GBrain ownership-lock PID $lockPid is still active."
    }
    if ([string]$lockRecord.command -notmatch '(?i)(?:gbrain(?:\.exe)?|gbrain[\\/]src[\\/]cli\.ts)\s+serve\s*$') {
        throw "The stale ownership lock does not identify a GBrain serve command: $($lockRecord.command)"
    }

    Remove-Item -LiteralPath $lockPath -Force
    Remove-Item -LiteralPath $lockDirectory -Force
    return $true
}

function Remove-StalePglitePostmasterPid {
    $databasePath = Join-Path $env:USERPROFILE '.gbrain\brain.pglite'
    $ownershipLock = Join-Path $databasePath '.gbrain-lock'
    $postmasterPidPath = Join-Path $databasePath 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $postmasterPidPath)) {
        return $false
    }

    if (Test-Path -LiteralPath $ownershipLock) {
        throw "Refusing to clean postmaster.pid while the GBrain ownership lock exists: $ownershipLock"
    }
    if (@(Get-GBrainRuntimeProcesses).Count -gt 0) {
        throw 'Refusing to clean postmaster.pid while a GBrain runtime process is active.'
    }

    $item = Get-Item -LiteralPath $postmasterPidPath -Force
    if ($item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing an unexpected PGLite postmaster object: $postmasterPidPath"
    }

    $raw = [IO.File]::ReadAllText($postmasterPidPath)
    $sentinelPattern = '\A-42\r?\n/pglite/data\r?\n(?<started>\d{9,})\r?\n5432\r?\n\r?\n\r?\n\s+\d+\s+\d+\r?\n?\z'
    $sentinelMatch = [regex]::Match($raw, $sentinelPattern)
    if (-not $sentinelMatch.Success) {
        throw "The PGLite postmaster marker is not the expected clean-close sentinel: $postmasterPidPath"
    }

    $startedEpoch = [long]$sentinelMatch.Groups['started'].Value
    $latestPlausibleEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 300
    if ($startedEpoch -le 0 -or $startedEpoch -gt $latestPlausibleEpoch) {
        throw "The PGLite postmaster sentinel has an implausible timestamp: $startedEpoch"
    }

    # PGLite persists this exact negative-PID marker after a clean shutdown.
    # It is not a live PostgreSQL owner, but the backup tool intentionally stays
    # strict and refuses any postmaster.pid. The coordinator may remove only this
    # validated sentinel after proving both GBrain's ownership lock and runtime
    # processes are absent.
    Remove-Item -LiteralPath $postmasterPidPath -Force
    return $true
}

function Write-MaintenanceSummary {
    param([Parameter(Mandatory)]$Summary)

    New-Item -ItemType Directory -Path $maintenanceRoot -Force | Out-Null
    $temporaryPath = "$latestSummaryPath.tmp-$PID"
    $Summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $latestSummaryPath -Force
}

foreach ($requiredPath in @($backupScript, $refreshScript, $relationshipScript, $visionScript, $gbrainExecutable, $gbrainCliSource, $gbrainAuthorityProxy)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required maintenance component is missing: $requiredPath"
    }
}
if (-not (Test-Path -LiteralPath $vaultRoot -PathType Container)) {
    throw "Vault directory is missing: $vaultRoot"
}

$codexCommand = (Get-Command codex -ErrorAction Stop).Source
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$registration = Get-GBrainMcpRegistration -CodexCommand $codexCommand
Assert-ExpectedMcpRegistration -Registration $registration
$initialProcesses = @(Get-GBrainRuntimeProcesses)
$unexpectedInitial = @($initialProcesses | Where-Object { -not (Test-ExpectedServeProcess $_) })
if ($unexpectedInitial.Count -gt 0) {
    $details = ($unexpectedInitial | ForEach-Object { "$($_.Name) PID $($_.ProcessId): $($_.CommandLine)" }) -join [Environment]::NewLine
    throw "Unexpected GBrain maintenance owner detected.`n$details"
}
if (-not $registration.registered -and $initialProcesses.Count -gt 0) {
    throw 'A GBrain serve process is active even though the Codex MCP entry is absent. Refusing to claim ownership.'
}

if ($DryRun) {
    $visionPreview = $null
    if (-not $SkipVision) {
        $visionText = Invoke-NativeChecked -Program $nodeCommand -Arguments @(
            $visionScript, '--dry-run', '--json'
        ) -Capture
        $visionPreview = $visionText | ConvertFrom-Json
    }
    $relationshipPreview = $null
    if (-not $SkipRelationships) {
        $relationshipText = Invoke-NativeChecked -Program $nodeCommand -Arguments @(
            $relationshipScript, '--dry-run', '--json'
        ) -Capture
        $relationshipPreview = $relationshipText | ConvertFrom-Json
    }
    [pscustomobject]@{
        schema_version = 1
        action = 'gbrain_maintenance_preview'
        mcp_registered = [bool]$registration.registered
        serve_processes = @($initialProcesses | ForEach-Object { [pscustomobject]@{ name = $_.Name; pid = $_.ProcessId } })
        backup = [pscustomobject]@{
            would_run = $true
            retention_count = $BackupRetentionCount
            restore_drill = -not $SkipRestoreDrill
        }
        refresh = [pscustomobject]@{
            would_run = $true
            skip_code = [bool]$SkipCode
            skip_evaluation = [bool]$SkipEvaluation
        }
        vision = $visionPreview
        relationships = $relationshipPreview
        note = 'Preview makes no MCP, database, backup, graph, or registration changes.'
    } | ConvertTo-Json -Depth 12
    return
}

New-Item -ItemType Directory -Path $maintenanceRoot -Force | Out-Null
$lockPath = Join-Path $maintenanceRoot 'minimalist-chat.lock'
$lockStream = $null
try {
    $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    throw "Another GBrain maintenance coordinator owns $lockPath."
}

$startedAt = [DateTime]::UtcNow
$mcpRemoved = $false
$mcpRestored = -not $registration.registered
$maintenanceFailure = $null
$restoreFailure = $null
$backupReport = $null
$relationshipReport = $null
$stoppedProcessCount = 0
$staleOwnershipLockRemoved = $false
$stalePostmasterPidRemoved = $false
$evaluationReport = $null
$refreshMetrics = $null
$visionReport = $null

try {
    if ($registration.registered) {
        Invoke-NativeChecked -Program $codexCommand -Arguments @('mcp', 'remove', 'gbrain')
        $mcpRemoved = $true
    }

    $stoppedProcessCount = Stop-ExpectedServeProcesses
    $staleOwnershipLockRemoved = Remove-StaleExpectedOwnershipLock -ExpectedOwnerPids @(
        $initialProcesses | ForEach-Object { [int]$_.ProcessId }
    )
    $stalePostmasterPidRemoved = Remove-StalePglitePostmasterPid

    $backupArguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $backupScript,
        '-RetentionCount', [string]$BackupRetentionCount, '-Json'
    )
    if ($SkipRestoreDrill) {
        $backupArguments += '-SkipRestoreDrill'
    }
    $backupText = Invoke-NativeChecked -Program 'powershell.exe' -Arguments $backupArguments -Capture
    $backupReport = $backupText | ConvertFrom-Json
    if (-not $backupReport.success -or -not $backupReport.verified) {
        throw 'The GBrain backup did not report successful verification.'
    }
    if (-not $SkipRestoreDrill -and -not $backupReport.restore_drill_passed) {
        throw 'The isolated GBrain restore drill did not pass.'
    }
    Write-Output "Verified GBrain backup: $($backupReport.backup_path)"

    if (-not $SkipVision) {
        $visionText = Invoke-NativeChecked -Program $nodeCommand -Arguments @(
            $visionScript, '--json'
        ) -Capture
        $visionReport = $visionText | ConvertFrom-Json
        if (-not $visionReport.ok -or $visionReport.mode -ne 'apply') {
            throw 'Timeline Vision maintenance did not report a successful local-only apply.'
        }
        Write-Output (
            'Timeline Vision: {0} cached; {1} analyzed; {2} stale sidecar(s) removed.' -f
            [int]$visionReport.cached_images,
            [int]$visionReport.analyzed_images,
            [int]$visionReport.stale_sidecars
        )
    }

    $refreshArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $refreshScript)
    if ($SkipCode) {
        $refreshArguments += '-SkipCode'
    }
    if ($SkipEvaluation) {
        $refreshArguments += '-SkipEvaluation'
    }
    $refreshText = Invoke-NativeChecked -Program 'powershell.exe' -Arguments $refreshArguments -Capture
    Write-Output $refreshText

    $metricPatterns = [ordered]@{
        pages = '(?m)^Pages:\s+(\d+)\s*$'
        chunks = '(?m)^Chunks:\s+(\d+)\s*$'
        embedded = '(?m)^Embedded:\s+(\d+)\s*$'
        links = '(?m)^Links:\s+(\d+)\s*$'
        tags = '(?m)^Tags:\s+(\d+)\s*$'
        timeline = '(?m)^Timeline:\s+(\d+)\s*$'
    }
    $parsedRefreshMetrics = [ordered]@{}
    foreach ($metric in $metricPatterns.GetEnumerator()) {
        $matches = [regex]::Matches($refreshText, $metric.Value)
        if ($matches.Count -ne 1) {
            throw "Could not parse exactly one $($metric.Key) metric from the guarded refresh output."
        }
        $parsedRefreshMetrics[$metric.Key] = [int]$matches[0].Groups[1].Value
    }
    $refreshMetrics = [pscustomobject]$parsedRefreshMetrics

    if (-not $SkipEvaluation -and (Test-Path -LiteralPath $evaluationPath -PathType Leaf)) {
        $evaluationReport = Get-Content -LiteralPath $evaluationPath -Raw | ConvertFrom-Json
    }

    if (-not $SkipRelationships) {
        $relationshipText = Invoke-NativeChecked -Program $nodeCommand -Arguments @(
            $relationshipScript, '--apply', '--json'
        ) -Capture
        $relationshipReport = $relationshipText | ConvertFrom-Json
        if (-not $relationshipReport.ok -or -not $relationshipReport.outputs_regenerated) {
            throw 'Project relationship enrichment did not report a validated Graphify regeneration.'
        }
        if ([int]$relationshipReport.low_degree_reduction -lt 0 -or
            [int]$relationshipReport.after.zero_degree_nodes -gt [int]$relationshipReport.before.zero_degree_nodes) {
            throw 'Project relationship enrichment failed its non-regression quality gate.'
        }
        Write-Output (
            'Project relationship enrichment: {0} edge(s) added; low-degree nodes {1} -> {2}.' -f
            [int]$relationshipReport.edges_added,
            [int]$relationshipReport.before.low_degree_nodes,
            [int]$relationshipReport.after.low_degree_nodes
        )
    }
} catch {
    $maintenanceFailure = $_
} finally {
    if ($mcpRemoved) {
        try {
            $currentRegistration = Get-GBrainMcpRegistration -CodexCommand $codexCommand
            if ($currentRegistration.registered) {
                Assert-ExpectedMcpRegistration -Registration $currentRegistration
            } else {
                try {
                    Invoke-NativeChecked -Program $codexCommand -Arguments (Get-GBrainMcpAddArguments -Registration $registration)
                } catch {
                    # Codex can persist the MCP entry before a concurrently
                    # reloading desktop process makes the CLI exit nonzero.
                    # Treat that as restored only when a fresh read proves the
                    # exact expected local stdio registration is present.
                    $registrationAfterFailedAdd = Get-GBrainMcpRegistration -CodexCommand $codexCommand
                    Assert-ExpectedMcpRegistration -Registration $registrationAfterFailedAdd
                    if (-not $registrationAfterFailedAdd.registered) {
                        throw
                    }
                }
            }
            $restoredRegistration = Get-GBrainMcpRegistration -CodexCommand $codexCommand
            Assert-ExpectedMcpRegistration -Registration $restoredRegistration
            if (-not $restoredRegistration.registered) {
                throw 'Codex did not report the restored GBrain MCP registration.'
            }
            $mcpRestored = $true
        } catch {
            $restoreFailure = $_
            $mcpRestored = $false
        }
    }

    $summary = [ordered]@{
        schema_version = 1
        action = 'gbrain_maintenance'
        started_at = $startedAt.ToString('o')
        finished_at = [DateTime]::UtcNow.ToString('o')
        success = ($null -eq $maintenanceFailure -and $null -eq $restoreFailure)
        mcp_was_registered = [bool]$registration.registered
        mcp_restored = [bool]$mcpRestored
        stopped_serve_processes = $stoppedProcessCount
        stale_ownership_lock_removed = [bool]$staleOwnershipLockRemoved
        stale_postmaster_pid_removed = [bool]$stalePostmasterPidRemoved
        options = [ordered]@{
            skip_code = [bool]$SkipCode
            skip_evaluation = [bool]$SkipEvaluation
            skip_restore_drill = [bool]$SkipRestoreDrill
            skip_relationships = [bool]$SkipRelationships
            skip_vision = [bool]$SkipVision
        }
        steps_performed = [ordered]@{
            backup = $true
            restore_drill = -not [bool]$SkipRestoreDrill
            note_refresh = $true
            code_refresh = -not [bool]$SkipCode
            evaluation = -not [bool]$SkipEvaluation
            relationships = -not [bool]$SkipRelationships
            vision = -not [bool]$SkipVision
        }
        backup = $backupReport
        refresh_metrics = $refreshMetrics
        evaluation = if ($evaluationReport) { $evaluationReport.summary } else { $null }
        relationships = $relationshipReport
        vision = $visionReport
        error = if ($maintenanceFailure) { $maintenanceFailure.Exception.Message } else { $null }
        restore_error = if ($restoreFailure) { $restoreFailure.Exception.Message } else { $null }
    }
    Write-MaintenanceSummary -Summary $summary

    if ($lockStream) {
        $lockStream.Dispose()
        $lockStream = $null
    }
}

if ($restoreFailure) {
    if ($maintenanceFailure) {
        throw "Maintenance failed: $($maintenanceFailure.Exception.Message) MCP restoration also failed: $($restoreFailure.Exception.Message)"
    }
    throw "GBrain maintenance completed, but MCP restoration failed: $($restoreFailure.Exception.Message)"
}
if ($maintenanceFailure) {
    throw $maintenanceFailure
}

Get-Content -LiteralPath $latestSummaryPath -Raw
