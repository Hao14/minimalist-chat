$ErrorActionPreference = "Stop"
$TestRoot = $PSScriptRoot
. (Join-Path $TestRoot "CloudflaredService.Common.ps1")

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (!$Condition) { throw $Message }
}

function New-SyntheticConnectorToken {
  param([string]$TunnelId, [string]$Secret)
  $payload = @{ a = "test-account"; t = $TunnelId; s = $Secret } | ConvertTo-Json -Compress
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$scripts = @(
  "CloudflaredService.Common.ps1",
  "CloudflaredServiceControl.ps1",
  "BridgeControl.ps1",
  "install-public-tunnel-recovery.ps1",
  "rotate-cloudflared-token.ps1"
)
foreach ($scriptName in $scripts) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $TestRoot $scriptName),
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  Assert-True ($errors.Count -eq 0) "$scriptName has PowerShell parser errors."
}

$hiddenLauncherPath = Join-Path $TestRoot "PublicTunnelRecovery.Hidden.vbs"
Assert-True (Test-Path -LiteralPath $hiddenLauncherPath -PathType Leaf) "The windowless recovery launcher is missing."
$cscriptExe = Join-Path $env:SystemRoot "System32\cscript.exe"
Assert-True (Test-Path -LiteralPath $cscriptExe -PathType Leaf) "Windows Script Host is unavailable."
& $cscriptExe "//B" "//NoLogo" $hiddenLauncherPath "--self-test" 2>&1 | Out-Null
Assert-True ($LASTEXITCODE -eq 0) "The windowless recovery launcher self-test failed."

$config = Get-NamedTunnelConfig
Assert-True ($config.recoveryTaskName -ceq "Minimalist Chat Public Gateway Recovery") "The recovery task name does not match the runbook."
$oldToken = New-SyntheticConnectorToken -TunnelId $config.tunnelId -Secret "old-test-only"
$newToken = New-SyntheticConnectorToken -TunnelId $config.tunnelId -Secret "new-test-only"
$wrongToken = New-SyntheticConnectorToken -TunnelId "11111111-1111-1111-1111-111111111111" -Secret "wrong-test-only"
$commandLine = '"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run --token ' + $oldToken

$identity = Assert-CloudflaredCommandLineIdentity -CommandLine $commandLine -Config $config
Assert-True ($identity.TunnelId -eq $config.tunnelId) "The expected synthetic tunnel identity was not accepted."
$updated = Set-CloudflaredTokenInCommandLine -CommandLine $commandLine -Token $newToken -Config $config
$updatedIdentity = Assert-CloudflaredCommandLineIdentity -CommandLine $updated -Config $config
Assert-True ($updatedIdentity.TunnelId -eq $config.tunnelId) "A safe same-tunnel token replacement was not accepted."
Assert-True ($updated -like "*$newToken") "The synthetic connector token was not replaced."

$wrongTunnelRefused = $false
try {
  Set-CloudflaredTokenInCommandLine -CommandLine $commandLine -Token $wrongToken -Config $config | Out-Null
} catch {
  $wrongTunnelRefused = $true
}
Assert-True $wrongTunnelRefused "A connector token for another tunnel was not refused."

$validOn = ConvertFrom-PublicTunnelStateJson '{"schemaVersion":1,"desiredOn":true}'
$validOff = ConvertFrom-PublicTunnelStateJson '{"desiredOn":false,"schemaVersion":1}'
Assert-True ($validOn.Valid -and $validOn.DesiredOn) "Strict desired-On state was not accepted."
Assert-True ($validOff.Valid -and !$validOff.DesiredOn) "Strict desired-Off state was not accepted."

$invalidStates = @(
  $null,
  "",
  '{}',
  '{"schemaVersion":2,"desiredOn":true}',
  '{"schemaVersion":1.0,"desiredOn":true}',
  '{"schemaVersion":1,"desiredOn":"true"}',
  '{"schemaVersion":1,"desiredOn":true,"extra":1}',
  '{"schemaVersion":1,"desiredOn":true,"desiredOn":false}',
  '{"SchemaVersion":1,"desiredOn":true}'
)
foreach ($invalidJson in $invalidStates) {
  $failedClosed = ConvertFrom-PublicTunnelStateJson $invalidJson
  Assert-True (!$failedClosed.Valid -and !$failedClosed.DesiredOn) "Invalid tunnel state did not fail closed."
}

$testStatePath = Join-Path ([IO.Path]::GetTempPath()) ("minimalist-chat-public-tunnel-{0}.json" -f [guid]::NewGuid().ToString('N'))
try {
  Set-PublicTunnelDesiredState -DesiredOn $true -StatePath $testStatePath | Out-Null
  $writtenOn = Get-PublicTunnelDesiredState -StatePath $testStatePath
  Assert-True ($writtenOn.Valid -and $writtenOn.DesiredOn) "Atomic desired-On write failed verification."

  Set-PublicTunnelDesiredState -DesiredOn $false -StatePath $testStatePath | Out-Null
  $writtenOff = Get-PublicTunnelDesiredState -StatePath $testStatePath
  Assert-True ($writtenOff.Valid -and !$writtenOff.DesiredOn) "Atomic desired-Off replacement failed verification."
} finally {
  if ([IO.File]::Exists($testStatePath)) { [IO.File]::Delete($testStatePath) }
  $temporaryPattern = ".{0}.*.tmp" -f [IO.Path]::GetFileName($testStatePath)
  foreach ($temporaryFile in [IO.Directory]::GetFiles([IO.Path]::GetDirectoryName($testStatePath), $temporaryPattern)) {
    [IO.File]::Delete($temporaryFile)
  }
}

$installerText = Get-Content -LiteralPath (Join-Path $TestRoot "install-public-tunnel-recovery.ps1") -Raw
$controllerText = Get-Content -LiteralPath (Join-Path $TestRoot "BridgeControl.ps1") -Raw
$hiddenLauncherText = Get-Content -LiteralPath $hiddenLauncherPath -Raw
Assert-True ($installerText -match '\[int\]\$IntervalMinutes\s*=\s*1') "The reconciler interval default is not one minute."
Assert-True ($installerText -match 'RunLevel\s+Highest') "The reconciler is not registered at Highest run level."
Assert-True ($installerText -match 'StartupType\s+Manual') "The installer does not enforce Manual service startup."
Assert-True ($installerText -match 'System32\\wscript\.exe') "The scheduled reconciler does not use the windowless Windows Script Host."
Assert-True ($installerText -match 'PublicTunnelRecovery\.Hidden\.vbs') "The scheduled reconciler does not use the fixed hidden launcher."
Assert-True ($installerText -match '//B //NoLogo') "The scheduled reconciler does not suppress Windows Script Host UI."
Assert-True ($hiddenLauncherText -match '-Action reconcile-tunnel') "The hidden launcher does not invoke reconcile-tunnel."
Assert-True ($hiddenLauncherText -match 'shell\.Run\(command,\s*0,\s*True\)') "The hidden launcher does not hide and await PowerShell."
Assert-True ($hiddenLauncherText -match 'WScript\.Quit exitCode') "The hidden launcher does not forward the reconciliation result."
Assert-True ($controllerText -match '"reconcile-tunnel"') "BridgeControl does not expose reconcile-tunnel."
Assert-True ($controllerText -notmatch '"recover"') "The retired recover action is still exposed."

$liveRecoveryTask = "skipped"
$installedTask = Get-ScheduledTask -TaskName ([string]$config.recoveryTaskName) -ErrorAction SilentlyContinue
if ($installedTask) {
  $installedActions = @($installedTask.Actions)
  $expectedWscript = Join-Path $env:SystemRoot "System32\wscript.exe"
  $expectedController = Join-Path $TestRoot "BridgeControl.ps1"
  $expectedLauncher = Join-Path $TestRoot "PublicTunnelRecovery.Hidden.vbs"
  $expectedArguments = '//B //NoLogo "{0}"' -f $expectedLauncher
  $legacyPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $legacyArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Action reconcile-tunnel' -f $expectedController
  $expectedWorkingDirectory = (Resolve-Path (Join-Path $TestRoot "..\..")).Path
  $installedTriggerTypes = @($installedTask.Triggers | ForEach-Object { $_.CimClass.CimClassName })
  $installedIntervals = @($installedTask.Triggers | ForEach-Object { [string]$_.Repetition.Interval })

  Assert-True ($installedActions.Count -eq 1) "The installed recovery task has an unexpected action count."
  $usesWindowlessAction = [string]::Equals(
    [string]$installedActions[0].Execute,
    $expectedWscript,
    [StringComparison]::OrdinalIgnoreCase
  ) -and [string]$installedActions[0].Arguments -ceq $expectedArguments
  $usesKnownLegacyAction = [string]::Equals(
    [string]$installedActions[0].Execute,
    $legacyPowerShell,
    [StringComparison]::OrdinalIgnoreCase
  ) -and [string]$installedActions[0].Arguments -ceq $legacyArguments
  Assert-True ($usesWindowlessAction -or $usesKnownLegacyAction) "The installed recovery task action has unexpected drift."
  Assert-True ([string]::Equals([string]$installedActions[0].WorkingDirectory, $expectedWorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) "The installed recovery task uses an unexpected working directory."
  Assert-True ([string]$installedTask.Principal.LogonType -eq "Interactive") "The installed recovery task is not tied to the interactive user."
  Assert-True ([string]$installedTask.Principal.RunLevel -eq "Highest") "The installed recovery task is not registered at Highest run level."
  Assert-True ([string]$installedTask.Settings.MultipleInstances -eq "IgnoreNew") "The installed recovery task does not ignore overlapping runs."
  Assert-True ($installedTriggerTypes -contains "MSFT_TaskLogonTrigger") "The installed recovery task is missing its logon trigger."
  Assert-True ($installedTriggerTypes -contains "MSFT_TaskTimeTrigger") "The installed recovery task is missing its repeating trigger."
  Assert-True ($installedIntervals -contains "PT1M") "The installed recovery task is not repeating every minute."
  $liveRecoveryTask = if ($usesWindowlessAction) { "passed" } else { "needs-reinstall" }
}

$liveIdentity = "skipped"
try {
  $snapshot = Get-NamedTunnelServiceSnapshot -Config $config
  Assert-True ($snapshot.TunnelId -eq $config.tunnelId) "The installed service has an unexpected tunnel identity."
  $liveIdentity = "passed"
} catch {
  if (Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue) { throw }
}

$oldToken = $null
$newToken = $null
$wrongToken = $null
$commandLine = $null
$updated = $null

[pscustomobject]@{
  ParserTests = "passed"
  SyntheticRotation = "passed"
  WrongTunnelRefusal = "passed"
  StrictFailClosedState = "passed"
  AtomicStatePersistence = "passed"
  HiddenLauncher = "passed"
  ReconcilerContract = "passed"
  LiveRecoveryTask = $liveRecoveryTask
  LiveServiceIdentity = $liveIdentity
} | ConvertTo-Json -Compress
