param(
  [int] $RetryDelayMinutes = 10,
  [int] $MaxBusyRetries = 5,
  [string] $Only = 'functions,hosting,database',
  [switch] $Force,
  [switch] $SkipBuild,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployStateDir = Join-Path $repoRoot '.deploy-tools'
$logFile = Join-Path $deployStateDir 'firebase-hourly-deploy.log'
$lockFile = Join-Path $deployStateDir 'firebase-hourly-deploy.lock'
$pauseFile = Join-Path $deployStateDir 'firebase-hourly-deploy.pause'
$firebase = Join-Path $PSScriptRoot 'firebase-node22.ps1'

New-Item -ItemType Directory -Path $deployStateDir -Force | Out-Null

function Write-DeployLog {
  param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Message)

  $line = '{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $logFile -Value $line
}

function Get-Node22Tool {
  $roots = @(
    (Join-Path $repoRoot '.deploy-tools'),
    (Join-Path $repoRoot '.tools')
  )

  $candidates = @()
  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) {
      continue
    }

    Get-ChildItem -LiteralPath $root -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue | ForEach-Object {
      $nodeExe = Join-Path $_.FullName 'node.exe'
      $npmCmd = Join-Path $_.FullName 'npm.cmd'
      if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $npmCmd)) {
        $versionText = $_.Name -replace '^node-v', '' -replace '-win-x64$', ''
        try {
          $version = [version] $versionText
        } catch {
          $version = [version] '22.0.0'
        }

        $candidates += [pscustomobject]@{
          Root = $_.FullName
          Node = $nodeExe
          Npm = $npmCmd
          Version = $version
        }
      }
    }
  }

  if ($candidates.Count -eq 0) {
    throw "No complete Node 22 toolchain was found. Expected node.exe and npm.cmd under .deploy-tools or .tools."
  }

  return $candidates | Sort-Object Version -Descending | Select-Object -First 1
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)] [string] $FilePath,
    [Parameter(Mandatory = $true)] [string[]] $Arguments
  )

  Write-DeployLog ('> {0} {1}' -f $FilePath, ($Arguments -join ' '))
  & $FilePath @Arguments *>&1 | ForEach-Object {
    Write-DeployLog ([string] $_)
  }

  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$FilePath exited with code $exitCode."
  }
}

function Test-LiveProcessId {
  param([Parameter(Mandatory = $true)] [int] $ProcessId)

  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-LockReason {
  if (!(Test-Path -LiteralPath $lockFile)) {
    return $null
  }

  try {
    $lockInfo = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
    $lockPid = [int] $lockInfo.pid
  } catch {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  if ($lockPid -gt 0 -and (Test-LiveProcessId -ProcessId $lockPid)) {
    return "another deploy is already running (PID $lockPid)"
  }

  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  return $null
}

function Enter-DeployLock {
  $reason = Get-LockReason
  if ($reason) {
    return $false
  }

  $lock = @{
    pid = $PID
    startedAt = (Get-Date).ToString('o')
    repo = $repoRoot
  } | ConvertTo-Json -Compress

  try {
    Set-Content -LiteralPath $lockFile -Value $lock -NoNewline -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Exit-DeployLock {
  try {
    if (Test-Path -LiteralPath $lockFile) {
      $lockInfo = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
      if ([int] $lockInfo.pid -eq $PID) {
        Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
}

function Get-RecentProjectChangeReason {
  param([Parameter(Mandatory = $true)] [int] $QuietMinutes)

  $threshold = (Get-Date).AddMinutes(-1 * $QuietMinutes)
  $paths = @(
    'src',
    'public',
    'functions',
    'legacy',
    'tools',
    'package.json',
    'package-lock.json',
    'firebase.json',
    'database.rules.json',
    'vite.config.js',
    'index.html',
    'server.js'
  )

  foreach ($relativePath in $paths) {
    $fullPath = Join-Path $repoRoot $relativePath
    if (!(Test-Path -LiteralPath $fullPath)) {
      continue
    }

    $item = Get-Item -LiteralPath $fullPath
    if ($item.PSIsContainer) {
      $recent = Get-ChildItem -LiteralPath $fullPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.LastWriteTime -gt $threshold -and
          $_.FullName -notmatch '\\node_modules\\' -and
          $_.FullName -notmatch '\\dist\\'
        } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

      if ($recent) {
        return ('recent change at {0}' -f $recent.FullName)
      }
    } elseif ($item.LastWriteTime -gt $threshold) {
      return ('recent change at {0}' -f $item.FullName)
    }
  }

  return $null
}

function Get-ActiveProjectProcessReason {
  $repoNeedle = $repoRoot.ToLowerInvariant()
  $managedNames = @('node.exe', 'npm.exe', 'npx.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe')
  $workPattern = '(vite|server\.js|firebase emulators|npm-cli\.js.*run (dev|start|preview)|npm\.cmd.*run (dev|start|preview))'

  $process = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $processId = [int] $_.ProcessId
    $commandLine = ''
    if ($_.CommandLine) {
      $commandLine = $_.CommandLine.ToLowerInvariant()
    }

    $processId -ne $PID -and
      $managedNames -contains $_.Name.ToLowerInvariant() -and
      $commandLine.Contains($repoNeedle) -and
      $commandLine -notmatch 'deploy-firebase-hourly\.ps1' -and
      $commandLine -match $workPattern
  } | Select-Object -First 1

  if ($process) {
    return ('active project process {0} (PID {1})' -f $process.Name, $process.ProcessId)
  }

  return $null
}

function Get-BusyReason {
  if ($Force) {
    return $null
  }

  if (Test-Path -LiteralPath $pauseFile) {
    return "pause file exists at $pauseFile"
  }

  $lockReason = Get-LockReason
  if ($lockReason) {
    return $lockReason
  }

  $gitIndexLock = Join-Path $repoRoot '.git\index.lock'
  if (Test-Path -LiteralPath $gitIndexLock) {
    return "git index lock exists"
  }

  $activeProcessReason = Get-ActiveProjectProcessReason
  if ($activeProcessReason) {
    return $activeProcessReason
  }

  return Get-RecentProjectChangeReason -QuietMinutes $RetryDelayMinutes
}

function Get-DescendantProcessIds {
  param([Parameter(Mandatory = $true)] [int] $RootProcessId)

  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $frontier = @($RootProcessId)
  $found = @()

  while ($frontier.Count -gt 0) {
    $next = @()
    foreach ($parentId in $frontier) {
      $children = $allProcesses | Where-Object { [int] $_.ParentProcessId -eq [int] $parentId }
      foreach ($child in $children) {
        $childId = [int] $child.ProcessId
        if ($found -notcontains $childId) {
          $found += $childId
          $next += $childId
        }
      }
    }
    $frontier = $next
  }

  return $found
}

function Stop-DeployInstances {
  $descendantIds = @{}
  foreach ($processId in (Get-DescendantProcessIds -RootProcessId $PID)) {
    $descendantIds[$processId] = $true
  }

  $repoNeedle = $repoRoot.ToLowerInvariant()
  $managedNames = @('node.exe', 'npm.exe', 'npx.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe')

  $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $processId = [int] $_.ProcessId
    $commandLine = ''
    if ($_.CommandLine) {
      $commandLine = $_.CommandLine.ToLowerInvariant()
    }

    $processId -ne $PID -and
      $managedNames -contains $_.Name.ToLowerInvariant() -and
      ($descendantIds.ContainsKey($processId) -or $commandLine.Contains($repoNeedle))
  }

  foreach ($process in $candidates) {
    try {
      Write-DeployLog ('Closing deploy instance PID {0}: {1}' -f $process.ProcessId, $process.Name)
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-DeployLog ('Could not close PID {0}: {1}' -f $process.ProcessId, $_.Exception.Message)
    }
  }
}

$locked = $false
$originalPath = $env:PATH
$originalSkipUpdateCheck = $env:FIREBASE_SKIP_UPDATE_CHECK
$originalCi = $env:CI

try {
  Write-DeployLog 'Starting guarded Firebase deploy.'

  $busyAttempts = 0
  while ($true) {
    $busyReason = Get-BusyReason
    if (!$busyReason -and (Enter-DeployLock)) {
      $locked = $true
      break
    }

    if (!$busyReason) {
      $busyReason = 'deploy lock was acquired by another process'
    }

    if ($busyAttempts -ge $MaxBusyRetries) {
      Write-DeployLog "Project stayed busy after $busyAttempts retries; skipping this hourly deploy."
      exit 0
    }

    Write-DeployLog "Project appears busy: $busyReason. Waiting $RetryDelayMinutes minutes before retry."
    Start-Sleep -Seconds ($RetryDelayMinutes * 60)
    $busyAttempts++
  }

  $nodeTool = Get-Node22Tool
  $env:PATH = "$($nodeTool.Root);$(Join-Path $repoRoot 'node_modules\.bin');$originalPath"
  $env:FIREBASE_SKIP_UPDATE_CHECK = 'true'
  $env:CI = 'true'

  Push-Location $repoRoot
  try {
    Write-DeployLog ('Using Node toolchain at {0}' -f $nodeTool.Root)
    Invoke-LoggedCommand -FilePath $nodeTool.Node -Arguments @('--version')
    Invoke-LoggedCommand -FilePath $nodeTool.Npm -Arguments @('--version')
    Invoke-LoggedCommand -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $firebase, '--version')

    if ($DryRun) {
      Write-DeployLog 'Dry run complete; no build or deploy was started.'
      exit 0
    }

    if (!$SkipBuild) {
      Invoke-LoggedCommand -FilePath $nodeTool.Npm -Arguments @('run', 'build')
    }

    Invoke-LoggedCommand -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $firebase, 'deploy', '--force', '--only', $Only)
    Write-DeployLog 'Firebase deploy completed successfully.'
  } finally {
    Pop-Location
  }
} catch {
  Write-DeployLog ('Firebase deploy failed: {0}' -f $_.Exception.Message)
  exit 1
} finally {
  if ($locked) {
    Exit-DeployLock
  }

  $env:PATH = $originalPath
  $env:FIREBASE_SKIP_UPDATE_CHECK = $originalSkipUpdateCheck
  $env:CI = $originalCi

  if (!$DryRun) {
    Stop-DeployInstances
  }

  Write-DeployLog 'Deploy runner finished.'
}
