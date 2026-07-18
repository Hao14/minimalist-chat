param(
  [string] $TaskName = 'Minimalist Chat Firebase Hourly Deploy'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $PSScriptRoot 'deploy-firebase-hourly.ps1'

if (!(Test-Path -LiteralPath $deployScript)) {
  throw "Deploy script not found at $deployScript"
}

Push-Location $repoRoot
try {
  $taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $deployScript

  if (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue) {
    $action = New-ScheduledTaskAction `
      -Execute 'powershell.exe' `
      -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $deployScript) `
      -WorkingDirectory $repoRoot

    $trigger = New-ScheduledTaskTrigger `
      -Once `
      -At (Get-Date).AddHours(1) `
      -RepetitionInterval (New-TimeSpan -Hours 1) `
      -RepetitionDuration (New-TimeSpan -Days 3650)

    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
      -MultipleInstances IgnoreNew `
      -StartWhenAvailable

    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Description 'Builds and deploys Minimalist Chat to Firebase every hour with Node 22.' `
      -Force | Out-Null
  } else {
    $arguments = @(
      '/Create',
      '/TN', $TaskName,
      '/SC', 'HOURLY',
      '/MO', '1',
      '/TR', $taskCommand,
      '/F'
    )

    & schtasks.exe @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "schtasks.exe failed with code $LASTEXITCODE"
    }
  }

  Write-Host "Installed hourly Firebase deploy task: $TaskName"
  Write-Host "Task command: $taskCommand"
} finally {
  Pop-Location
}
