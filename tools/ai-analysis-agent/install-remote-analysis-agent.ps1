#Requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Uninstall,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "AgentFileSecurity.ps1")

$taskName = "Minimalist Chat Remote Analysis Agent"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$legacyConfigPath = Join-Path $repoRoot ".bridge-control\remote-analysis-agent.json"
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData) -or
    !(Test-Path -LiteralPath $localAppData -PathType Container)) {
  throw "The current user's LocalAppData directory is unavailable."
}
$productDirectory = Join-Path $localAppData "Minimalist.chat"
$agentDirectory = Join-Path $productDirectory "AnalysisAgent"
$configPath = Join-Path $agentDirectory "remote-analysis-agent.json"
$installedExecutablePath = Join-Path $agentDirectory "MinimalistAIAnalysisAgent.exe"
$releaseDirectory = Join-Path $repoRoot "artifacts\windows\ai-analysis-agent\release"
$publishedExecutablePath = Join-Path $releaseDirectory "MinimalistAIAnalysisAgent.exe"
$projectPath = Join-Path $PSScriptRoot "MinimalistAIAnalysis.Agent.csproj"

if (!(Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) -or
    !(Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  throw "Windows Scheduled Tasks cmdlets are required to install the remote Analysis agent."
}

if ($Uninstall) {
  $installedTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $installedTask) {
    Write-Output "Remote Analysis agent task '$taskName' is not installed."
    return
  }

  if ($PSCmdlet.ShouldProcess($taskName, "Stop and unregister the remote Analysis agent task")) {
    if ([string]$installedTask.State -eq "Running") {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Output "Removed remote Analysis agent task '$taskName'. Protected local configuration, installed files, and release files were left in place."
  }
  return
}

if (!(Test-Path -LiteralPath $projectPath -PathType Leaf)) {
  throw "Remote Analysis agent project was not found: $projectPath"
}
if (!(Test-Path -LiteralPath $publishedExecutablePath -PathType Leaf)) {
  throw "Published agent executable was not found. Run .\tools\ai-analysis-agent\publish.ps1 first."
}
if ((Get-Item -LiteralPath $publishedExecutablePath).Length -le 0) {
  throw "Published agent executable is empty: $publishedExecutablePath"
}

[xml]$projectXml = Get-Content -LiteralPath $projectPath -Raw
$outputType = [string]($projectXml.Project.PropertyGroup.OutputType | Select-Object -First 1)
$assemblyName = [string]($projectXml.Project.PropertyGroup.AssemblyName | Select-Object -First 1)
if ($outputType -cne "WinExe" -or $assemblyName -cne "MinimalistAIAnalysisAgent") {
  throw "The agent project must remain the approved windowless MinimalistAIAnalysisAgent WinExe."
}

if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $configurationSourcePath = $configPath
}
elseif (Test-Path -LiteralPath $legacyConfigPath -PathType Leaf) {
  $configurationSourcePath = $legacyConfigPath
}
else {
  throw "Remote Analysis agent configuration was not found. Run configure-remote-analysis-agent.ps1 first."
}

$configurationSourceItem = Get-Item -LiteralPath $configurationSourcePath -Force
$configurationSourceDirectory = Get-Item -LiteralPath (Split-Path -Parent $configurationSourcePath) -Force
if (($configurationSourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    ($configurationSourceDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "Refusing to use a remote Analysis agent configuration through a reparse point: $configurationSourcePath"
}

try {
  $configText = Get-Content -LiteralPath $configurationSourcePath -Raw
  if ($configText.Length -le 0 -or $configText.Length -gt 16384) {
    throw "Configuration size is invalid."
  }
  $config = $configText | ConvertFrom-Json
}
catch {
  throw "Remote Analysis agent configuration is unreadable or invalid JSON. Run configure-remote-analysis-agent.ps1 again."
}

$configFields = @($config.PSObject.Properties.Name)
$expectedFields = @("schemaVersion", "teamDomain", "applicationAudience", "allowedEmail")
if ($configFields.Count -ne $expectedFields.Count -or
    @(Compare-Object -ReferenceObject $expectedFields -DifferenceObject $configFields).Count -ne 0 -or
    [int]$config.schemaVersion -ne 1 -or
    [string]$config.teamDomain -notmatch '^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$' -or
    [string]$config.applicationAudience -notmatch '^[A-Za-z0-9_-]{16,128}$' -or
    [string]$config.allowedEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or
    [string]$config.allowedEmail -cne ([string]$config.allowedEmail).ToLowerInvariant()) {
  throw "Remote Analysis agent configuration does not match the approved schema. Run configure-remote-analysis-agent.ps1 again."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userId = $identity.Name
$arguments = '--workspace "{0}" --config "{1}"' -f $repoRoot, $configPath
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$restartInterval = New-TimeSpan -Minutes 1
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval $restartInterval `
  -Hidden

if ($PSCmdlet.ShouldProcess($taskName, "Install the non-elevated, hidden remote Analysis agent task for $userId")) {
  Protect-MinimalistAgentPath -LiteralPath $releaseDirectory -Recurse
  $productDirectory = Initialize-MinimalistAgentDirectory -LiteralPath $productDirectory
  $agentDirectory = Initialize-MinimalistAgentDirectory -LiteralPath $agentDirectory

  if (![string]::Equals($configurationSourcePath, $configPath, [StringComparison]::OrdinalIgnoreCase)) {
    $temporaryConfigPath = Join-Path $agentDirectory (".remote-analysis-agent.{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
    try {
      Copy-Item -LiteralPath $configurationSourcePath -Destination $temporaryConfigPath -Force
      Protect-MinimalistAgentPath -LiteralPath $temporaryConfigPath
      Move-Item -LiteralPath $temporaryConfigPath -Destination $configPath -Force
    }
    finally {
      if (Test-Path -LiteralPath $temporaryConfigPath -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryConfigPath -Force
      }
    }
  }
  Protect-MinimalistAgentPath -LiteralPath $configPath

  $publishedHash = (Get-FileHash -LiteralPath $publishedExecutablePath -Algorithm SHA256).Hash
  $temporaryExecutablePath = Join-Path $agentDirectory (".MinimalistAIAnalysisAgent.{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
  try {
    Copy-Item -LiteralPath $publishedExecutablePath -Destination $temporaryExecutablePath -Force
    Protect-MinimalistAgentPath -LiteralPath $temporaryExecutablePath
    Move-Item -LiteralPath $temporaryExecutablePath -Destination $installedExecutablePath -Force
  }
  finally {
    if (Test-Path -LiteralPath $temporaryExecutablePath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryExecutablePath -Force
    }
  }
  if ((Get-FileHash -LiteralPath $installedExecutablePath -Algorithm SHA256).Hash -cne $publishedHash) {
    throw "The protected installed agent executable failed SHA-256 verification."
  }
  Protect-MinimalistAgentPath -LiteralPath $agentDirectory -Recurse

  $taskAction = New-ScheduledTaskAction `
    -Execute $installedExecutablePath `
    -Argument $arguments `
    -WorkingDirectory $repoRoot

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $taskAction `
    -Trigger $logonTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs the read-only Minimalist Analysis agent on 127.0.0.1:8791 after this user signs in; Cloudflare Access protects the separate public hostname." `
    -Force | Out-Null

  $registeredTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $registeredActions = @($registeredTask.Actions)
  $registeredTriggers = @($registeredTask.Triggers)
  if ($registeredActions.Count -ne 1 -or
      ![string]::Equals([string]$registeredActions[0].Execute, $installedExecutablePath, [StringComparison]::OrdinalIgnoreCase) -or
      [string]$registeredActions[0].Arguments -cne $arguments -or
      ![string]::Equals([string]$registeredActions[0].WorkingDirectory, $repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $registeredTriggers.Count -ne 1 -or
      [string]$registeredTriggers[0].CimClass.CimClassName -ne "MSFT_TaskLogonTrigger" -or
      [string]$registeredTask.Principal.LogonType -ne "Interactive" -or
      [string]$registeredTask.Principal.RunLevel -ne "Limited" -or
      !$registeredTask.Settings.Hidden -or
      [int]$registeredTask.Settings.RestartCount -ne 3 -or
      [string]$registeredTask.Settings.RestartInterval -ne "PT1M" -or
      [string]$registeredTask.Settings.ExecutionTimeLimit -ne "PT0S" -or
      [string]$registeredTask.Settings.MultipleInstances -ne "IgnoreNew") {
    throw "The registered remote Analysis agent task does not match the approved direct-WinExe contract."
  }

  if (!$NoStart) {
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  }

  Write-Output "Installed remote Analysis agent task '$taskName' for $userId."
  Write-Output "Action: $installedExecutablePath $arguments"
  Write-Output "The task runs directly as a hidden, non-elevated WinExe; PowerShell is not used at runtime."
  Write-Output "Configuration and task-target ACLs allow only the current user, SYSTEM, and Administrators."
}
