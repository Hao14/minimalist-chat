[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$maintenanceRoot = Join-Path $env:USERPROFILE '.gbrain\maintenance'
$coordinator = Join-Path $PSScriptRoot 'Invoke-GBrainMaintenance.ps1'
$runSummaryPath = Join-Path $maintenanceRoot 'minimalist-chat-scheduled-latest.json'
$startedAt = [DateTime]::UtcNow
$failure = $null
$powershellExecutable = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExecutable -PathType Leaf)) {
    throw "The current Windows PowerShell host is missing: $powershellExecutable"
}

New-Item -ItemType Directory -Path $maintenanceRoot -Force | Out-Null
try {
    & $powershellExecutable -NoProfile -ExecutionPolicy Bypass -File $coordinator
    if ($LASTEXITCODE -ne 0) {
        throw "Maintenance coordinator exited with code $LASTEXITCODE."
    }
} catch {
    $failure = $_
} finally {
    $summary = [ordered]@{
        schema_version = 1
        action = 'scheduled_gbrain_maintenance'
        started_at = $startedAt.ToString('o')
        finished_at = [DateTime]::UtcNow.ToString('o')
        success = ($null -eq $failure)
        error = if ($failure) { $failure.Exception.Message } else { $null }
    }
    $temporaryPath = "$runSummaryPath.tmp-$PID"
    $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $runSummaryPath -Force
}

if ($failure) {
    throw $failure
}
