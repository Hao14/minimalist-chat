[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateRange(1, 60)]
  [int]$IntervalMinutes = 1,
  [switch]$Uninstall,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$CommonScript = Join-Path $PSScriptRoot "CloudflaredService.Common.ps1"
$BridgeControlScript = Join-Path $PSScriptRoot "BridgeControl.ps1"
$ServiceControlScript = Join-Path $PSScriptRoot "CloudflaredServiceControl.ps1"
$HiddenLauncherScript = Join-Path $PSScriptRoot "PublicTunnelRecovery.Hidden.vbs"
. $CommonScript

if (!(Test-IsAdministrator)) {
  throw "Run this installer from an elevated PowerShell window. Administrator rights are required for the highest-privilege reconciler task and Cloudflared service startup policy."
}

$config = Get-NamedTunnelConfig
$taskName = [string]$config.recoveryTaskName
Get-NamedTunnelServiceSnapshot -Config $config | Out-Null

function Invoke-InstalledServiceControl {
  param([ValidateSet("Start", "Stop")][string]$RequestedAction)

  & powershell.exe `
    -NoProfile `
    -NonInteractive `
    -ExecutionPolicy Bypass `
    -File $ServiceControlScript `
    -Action $RequestedAction `
    -Elevated 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The approved Cloudflared service could not be reconciled during task installation."
  }
}

if ($Uninstall) {
  if ($PSCmdlet.ShouldProcess($taskName, "Persist tunnel Off, stop Cloudflared, and unregister reconciler")) {
    Set-PublicTunnelDesiredState -DesiredOn $false | Out-Null
    Invoke-InstalledServiceControl -RequestedAction Stop
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    }
    Write-Output "Removed public gateway reconciler '$taskName' after persisting Off."
  }
  exit 0
}

if (!(Test-Path -LiteralPath $BridgeControlScript -PathType Leaf) -or
    !(Test-Path -LiteralPath $ServiceControlScript -PathType Leaf) -or
    !(Test-Path -LiteralPath $HiddenLauncherScript -PathType Leaf)) {
  throw "The public gateway controller scripts are incomplete; the reconciler was not installed."
}

$hiddenLauncherItem = Get-Item -LiteralPath $HiddenLauncherScript -Force -ErrorAction Stop
if ($hiddenLauncherItem.PSIsContainer -or
    ($hiddenLauncherItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw "The public gateway hidden launcher must be a regular local file."
}

$wscriptExe = Join-Path $env:SystemRoot "System32\wscript.exe"
$cscriptExe = Join-Path $env:SystemRoot "System32\cscript.exe"
if (!(Test-Path -LiteralPath $wscriptExe -PathType Leaf) -or
    !(Test-Path -LiteralPath $cscriptExe -PathType Leaf)) {
  throw "Windows Script Host is unavailable; the windowless reconciler was not installed."
}

# Validate VBScript availability and all fixed launcher paths without reconciling
# the tunnel. //B prevents Windows Script Host from displaying an error dialog.
& $cscriptExe "//B" "//NoLogo" $HiddenLauncherScript "--self-test" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "The public gateway hidden launcher did not pass its non-mutating self-test."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userId = $identity.Name
$arguments = '//B //NoLogo "{0}"' -f $HiddenLauncherScript
$workingDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$taskAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument $arguments -WorkingDirectory $workingDirectory
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew

if ($PSCmdlet.ShouldProcess($taskName, "Install highest-privilege public gateway reconciler")) {
  # Missing or malformed intent fails closed and becomes an explicit Off state.
  $desiredState = Get-PublicTunnelDesiredState
  if (!$desiredState.Valid) {
    Set-PublicTunnelDesiredState -DesiredOn $false | Out-Null
  }

  # The scheduled reconciler, not Windows automatic startup, owns ordering.
  Set-Service -Name ([string]$config.serviceName) -StartupType Manual -ErrorAction Stop
  $manualService = Get-NamedTunnelServiceSnapshot -Config $config
  if ($manualService.StartMode -ne "Manual") {
    throw "The approved Cloudflared service could not be fixed to Manual startup."
  }

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $taskAction `
    -Trigger @($logonTrigger, $repeatTrigger) `
    -Principal $principal `
    -Settings $settings `
    -Description "Reconciles Minimalist Chat public tunnel intent after bridge health succeeds; invalid state fails closed." `
    -Force | Out-Null

  $registeredTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $registeredActions = @($registeredTask.Actions)
  if ($registeredActions.Count -ne 1 -or
      ![string]::Equals([string]$registeredActions[0].Execute, $wscriptExe, [StringComparison]::OrdinalIgnoreCase) -or
      [string]$registeredActions[0].Arguments -cne $arguments -or
      ![string]::Equals([string]$registeredActions[0].WorkingDirectory, $workingDirectory, [StringComparison]::OrdinalIgnoreCase) -or
      [string]$registeredTask.Principal.LogonType -ne "Interactive" -or
      [string]$registeredTask.Principal.RunLevel -ne "Highest" -or
      [string]$registeredTask.Settings.MultipleInstances -ne "IgnoreNew") {
    throw "The public gateway reconciler registration does not match the approved hidden task contract."
  }

  if (!$NoStart) {
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  } elseif (!(Get-PublicTunnelDesiredState).DesiredOn) {
    Invoke-InstalledServiceControl -RequestedAction Stop
  }
  Write-Output "Installed public gateway reconciler '$taskName' at logon and every $IntervalMinutes minute(s)."
}
