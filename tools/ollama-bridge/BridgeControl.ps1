param(
  [switch]$SelfTest,
  [ValidateSet("", "status", "start-bridge", "stop-bridge", "restart-bridge", "start-ollama", "start-tunnel", "stop-tunnel", "reconcile-tunnel", "open-logs")]
  [string]$Action = "",
  [int]$Port = 8790,
  [string]$FirebaseProject = "chat-app-356c1",
  [int]$MaxBodyMB = 32
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$BridgeScript = Join-Path $PSScriptRoot "start-ollama-bridge.ps1"
$CloudflaredCommonScript = Join-Path $PSScriptRoot "CloudflaredService.Common.ps1"
$CloudflaredServiceControlScript = Join-Path $PSScriptRoot "CloudflaredServiceControl.ps1"
$ControlDir = Join-Path $RepoRoot ".bridge-control"
$BridgeOutLog = Join-Path $ControlDir "ollama-bridge.out.log"
$BridgeErrLog = Join-Path $ControlDir "ollama-bridge.err.log"
$ProjectEnvFile = Join-Path $RepoRoot "functions\.env.chat-app-356c1"
$FirebaseHelper = Join-Path $RepoRoot "tools\firebase-node22.ps1"
$DedicatedOllamaBaseUrl = "http://127.0.0.1:11435"
$DedicatedOllamaModelStore = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) ".ollama\models"
$script:BridgeToken = ""

. $CloudflaredCommonScript
$NamedTunnelConfig = Get-NamedTunnelConfig

New-Item -ItemType Directory -Path $ControlDir -Force | Out-Null

function Get-CommandProcesses {
  param(
    [string]$ProcessName,
    [string]$CommandPattern
  )

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -ieq $ProcessName -and
      [string]$_.CommandLine -match $CommandPattern
    }
}

function Get-BridgeProcesses {
  Get-CommandProcesses -ProcessName "node.exe" -CommandPattern "ollama-bridge\.cjs"
}

function Get-ConfiguredTunnelUrl {
  if (!(Test-Path -LiteralPath $ProjectEnvFile)) { return "" }
  $line = Get-Content -LiteralPath $ProjectEnvFile |
    Where-Object { $_ -match "^\s*OLLAMA_SERVER_URL\s*=" } |
    Select-Object -First 1
  if (!$line) { return "" }
  return ($line -replace "^\s*OLLAMA_SERVER_URL\s*=", "").Trim()
}

function Test-JsonEndpoint {
  param(
    [string]$Url,
    [hashtable]$Headers = $null,
    [int]$TimeoutSec = 6
  )

  try {
    $params = @{
      Uri = $Url
      TimeoutSec = $TimeoutSec
      ErrorAction = "Stop"
    }
    if ($Headers) { $params.Headers = $Headers }
    $data = Invoke-RestMethod @params
    return [pscustomobject]@{ Ok = $true; Data = $data; Error = "" }
  } catch {
    return [pscustomobject]@{ Ok = $false; Data = $null; Error = $_.Exception.Message }
  }
}

function Test-ProtectedBridgeHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSec = 6
  )

  try {
    $response = Invoke-WebRequest `
      -Uri $Url `
      -UseBasicParsing `
      -TimeoutSec $TimeoutSec `
      -ErrorAction Stop
    try {
      $data = $response.Content | ConvertFrom-Json
    } catch {
      return [pscustomobject]@{
        Ok = $false; Data = $null; Upstream = ""; MarkerOk = $false; UpstreamOk = $false
        Error = "Protected health response was not valid JSON."
      }
    }

    $markerOk = [string]::Equals(
      [string]$response.Headers["X-Minimalist-Ollama-Bridge"],
      "1",
      [StringComparison]::Ordinal
    )
    $upstream = if ($data.upstream) { [string]$data.upstream } else { "" }
    $upstreamOk = [string]::Equals(
      $upstream.TrimEnd('/'),
      $DedicatedOllamaBaseUrl,
      [StringComparison]::OrdinalIgnoreCase
    )
    $ready = $data.ok -is [bool] -and [bool]$data.ok
    $errorMessage = if (!$markerOk) {
      "Protected bridge marker header is missing."
    } elseif (!$upstreamOk) {
      "Bridge upstream is '$upstream'; expected '$DedicatedOllamaBaseUrl'."
    } elseif (!$ready) {
      "Protected bridge health did not report ready."
    } else {
      ""
    }
    return [pscustomobject]@{
      Ok = $markerOk -and $upstreamOk -and $ready
      Data = $data
      Upstream = $upstream
      MarkerOk = $markerOk
      UpstreamOk = $upstreamOk
      Error = $errorMessage
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false; Data = $null; Upstream = ""; MarkerOk = $false; UpstreamOk = $false
      Error = $_.Exception.Message
    }
  }
}

function Get-OllamaStatus {
  $tags = Test-JsonEndpoint -Url "$DedicatedOllamaBaseUrl/api/tags" -TimeoutSec 5
  $models = @()
  if ($tags.Ok -and $tags.Data.models) {
    $models = @($tags.Data.models | ForEach-Object { $_.name })
  }

  [pscustomobject]@{
    Running = $tags.Ok
    ApiOk = $tags.Ok
    Models = $models
    Error = $tags.Error
    Endpoint = $DedicatedOllamaBaseUrl
    ModelStore = $DedicatedOllamaModelStore
  }
}

function Get-BridgeStatus {
  $processes = @(Get-BridgeProcesses)
  $health = Test-ProtectedBridgeHealth -Url "http://127.0.0.1:$Port/health" -TimeoutSec 5
  [pscustomobject]@{
    Running = $processes.Count -gt 0
    ProcessIds = @($processes | ForEach-Object { $_.ProcessId })
    HealthOk = $health.Ok
    Upstream = $health.Upstream
    MarkerOk = $health.MarkerOk
    Error = $health.Error
  }
}

function Get-TunnelStatus {
  $functionUrl = Get-ConfiguredTunnelUrl
  $publicUrl = [string]$NamedTunnelConfig.publicUrl
  $desiredState = Get-PublicTunnelDesiredState
  try {
    $service = Get-NamedTunnelServiceSnapshot -Config $NamedTunnelConfig
  } catch {
    return [pscustomobject]@{
      ConfiguredUrl = $publicUrl
      FunctionConfiguredUrl = $functionUrl
      ConfigurationMatches = $false
      Running = $false
      DesiredOn = $desiredState.DesiredOn
      DesiredStateValid = $desiredState.Valid
      StartMode = "Unknown"
      ProcessIds = @()
      HealthOk = $false
      IdentityOk = $false
      Error = $_.Exception.Message
    }
  }

  $running = [string]::Equals($service.State, "Running", [StringComparison]::OrdinalIgnoreCase)
  $desiredOn = $desiredState.Valid -and $desiredState.DesiredOn
  $configurationMatches = [string]::Equals(
    $functionUrl.TrimEnd('/'),
    $publicUrl.TrimEnd('/'),
    [StringComparison]::OrdinalIgnoreCase
  )
  $health = if ($running) {
    Test-ProtectedBridgeHealth -Url "$($publicUrl.TrimEnd('/'))/health" -TimeoutSec 10
  } else {
    $null
  }
  $healthOk = $null -ne $health -and $health.Ok
  $errorMessage = if (!$desiredState.Valid) {
    "Tunnel desired state is missing or invalid and therefore fails closed to Off."
  } elseif (!$desiredOn) {
    "Tunnel is intentionally off and reconciliation will keep it off."
  } elseif ($service.StartMode -ne "Manual") {
    "The Cloudflared service startup mode must be Manual; rerun the recovery installer."
  } elseif (!$running) {
    "The approved Cloudflared service is not running."
  } elseif (!$health.Ok) {
    $health.Error
  } elseif (!$configurationMatches) {
    "Firebase Functions is not configured for the fixed public tunnel URL."
  } else {
    ""
  }

  [pscustomobject]@{
    ConfiguredUrl = $publicUrl
    FunctionConfiguredUrl = $functionUrl
    ConfigurationMatches = $configurationMatches
    Running = $running
    DesiredOn = $desiredOn
    DesiredStateValid = $desiredState.Valid
    StartMode = $service.StartMode
    ProcessIds = if ($service.ProcessId -gt 0) { @($service.ProcessId) } else { @() }
    HealthOk = $healthOk
    IdentityOk = $true
    Error = $errorMessage
  }
}

function Get-BridgeToken {
  if ($script:BridgeToken) { return $script:BridgeToken }
  if (!(Test-Path -LiteralPath $FirebaseHelper -PathType Leaf)) {
    throw "Cannot find tools\firebase-node22.ps1 in the configured repository."
  }
  $token = (& $FirebaseHelper functions:secrets:access OLLAMA_SERVER_TOKEN --project $FirebaseProject).Trim()
  if (!$token) { throw "Firebase secret OLLAMA_SERVER_TOKEN was empty or unavailable." }
  $script:BridgeToken = $token
  return $script:BridgeToken
}

function Wait-ForProtectedBridge {
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $bridge = Get-BridgeStatus
    if ($bridge.HealthOk) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The protected bridge did not become ready on port $Port with upstream $DedicatedOllamaBaseUrl."
}

function Invoke-AuthorizedBridgeJson {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )
  $token = Get-BridgeToken
  $params = @{
    Uri = "http://127.0.0.1:$Port$Path"
    Method = $Method
    Headers = @{ Authorization = "Bearer $token" }
    TimeoutSec = 40
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = $Body | ConvertTo-Json -Compress
  }
  return Invoke-RestMethod @params
}

function Start-DedicatedOllama {
  Start-BridgeProcess | Out-Null
  Wait-ForProtectedBridge
  $status = Invoke-AuthorizedBridgeJson -Method GET -Path "/control/status"
  $idleMinutes = if ($status.idleMinutes) { [int]$status.idleMinutes } else { 120 }
  Invoke-AuthorizedBridgeJson -Method POST -Path "/control/mode" -Body @{ mode = "auto"; idleMinutes = $idleMinutes } | Out-Null
  Invoke-AuthorizedBridgeJson -Method GET -Path "/api/tags" | Out-Null
  return "Protected Ollama wake requested in Auto mode on 127.0.0.1:11435."
}

function Start-BridgeProcess {
  if (@(Get-BridgeProcesses).Count -gt 0) { return "Bridge is already running." }

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $BridgeScript,
    "-Port", [string]$Port,
    "-UseFirebaseSecret",
    "-FirebaseProject", $FirebaseProject,
    "-MaxBodyMB", [string]$MaxBodyMB,
    "-OllamaUpstream", $DedicatedOllamaBaseUrl,
    "-OllamaModelStore", $DedicatedOllamaModelStore
  )

  Start-Process -FilePath "powershell.exe" `
    -ArgumentList $args `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $BridgeOutLog `
    -RedirectStandardError $BridgeErrLog

  return "Bridge start requested."
}

function Stop-BridgeProcess {
  $processes = @(Get-BridgeProcesses)
  if ($processes.Count -eq 0) { return "Bridge is already stopped." }
  $processes | ForEach-Object {
    & taskkill.exe /PID ([string]$_.ProcessId) /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  return "Stopped bridge process(es): $($processes.ProcessId -join ', ')."
}

function Invoke-CloudflaredServiceAction {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Start", "Stop")]
    [string]$ServiceAction
  )

  if (!(Test-Path -LiteralPath $CloudflaredServiceControlScript -PathType Leaf)) {
    throw "The approved Cloudflared service control helper is missing."
  }
  Get-NamedTunnelServiceSnapshot -Config $NamedTunnelConfig | Out-Null
  & powershell.exe `
    -NoProfile `
    -NonInteractive `
    -ExecutionPolicy Bypass `
    -File $CloudflaredServiceControlScript `
    -Action $ServiceAction 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The approved Cloudflared service action did not complete."
  }
}

function Assert-FixedTunnelConfiguration {
  $configuredUrl = Get-ConfiguredTunnelUrl
  if (![string]::Equals(
      $configuredUrl.TrimEnd('/'),
      ([string]$NamedTunnelConfig.publicUrl).TrimEnd('/'),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Firebase Functions must use the approved fixed URL $($NamedTunnelConfig.publicUrl) before the tunnel can turn on."
  }
}

function Invoke-WithTunnelReconcileLock {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [int]$TimeoutSec = 55
  )

  $mutex = New-Object Threading.Mutex($false, "Local\MinimalistChat.PublicTunnel.Reconcile.v1")
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSec))
    } catch [Threading.AbandonedMutexException] {
      $acquired = $true
    }
    if (!$acquired) {
      throw "Another public tunnel reconciliation is still running."
    }
    return & $Operation
  } finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Start-PublicTunnelReconcilerTask {
  $taskName = [string]$NamedTunnelConfig.recoveryTaskName
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (!$task) {
    throw "The public gateway reconciler is not installed. Run install-public-tunnel-recovery.ps1 from elevated PowerShell."
  }
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
}

function Invoke-PublicTunnelReconciliation {
  Invoke-WithTunnelReconcileLock -Operation {
    $desiredState = Get-PublicTunnelDesiredState
    if (!$desiredState.Valid -or !$desiredState.DesiredOn) {
      Invoke-CloudflaredServiceAction -ServiceAction Stop
      if ($desiredState.Valid) { return "Public tunnel reconciled Off." }
      return "Invalid or missing tunnel state failed closed; public tunnel reconciled Off."
    }

    try {
      Assert-FixedTunnelConfiguration
    } catch {
      Invoke-CloudflaredServiceAction -ServiceAction Stop
      throw
    }

    $bridge = Get-BridgeStatus
    $service = Get-NamedTunnelServiceSnapshot -Config $NamedTunnelConfig
    $serviceRunning = $service.State -eq "Running"
    $publicHealth = if ($serviceRunning -and $bridge.HealthOk) {
      Test-ProtectedBridgeHealth -Url "$(([string]$NamedTunnelConfig.publicUrl).TrimEnd('/'))/health" -TimeoutSec 10
    } else {
      $null
    }
    $publicHealthy = $null -ne $publicHealth -and $publicHealth.Ok

    if ($serviceRunning -and $service.StartMode -eq "Manual" -and $bridge.HealthOk -and $publicHealthy) {
      return "Public tunnel is already reconciled On and healthy."
    }

    if (!$bridge.HealthOk) {
      if ($serviceRunning) {
        Invoke-CloudflaredServiceAction -ServiceAction Stop
      }
      if ($bridge.Running) {
        Stop-BridgeProcess | Out-Null
      }
      Start-BridgeProcess | Out-Null
      Wait-ForProtectedBridge
    } elseif ($serviceRunning -and !$publicHealthy) {
      Invoke-CloudflaredServiceAction -ServiceAction Stop
    }

    Invoke-CloudflaredServiceAction -ServiceAction Start
    return "Public tunnel reconciled On after protected bridge health succeeded."
  }
}

function Request-PublicTunnelReconciliation {
  try {
    Start-PublicTunnelReconcilerTask
    return "Public tunnel reconciliation requested."
  } catch {
    # Manual fallback keeps Start/Stop safe before the task is repaired. It may
    # show one UAC prompt because service control is privileged.
    return Invoke-PublicTunnelReconciliation
  }
}

function Start-BridgeTunnel {
  Assert-FixedTunnelConfiguration
  $bridge = Get-BridgeStatus
  if (!$bridge.HealthOk) {
    throw "The protected bridge must be healthy on 127.0.0.1:$Port before the public tunnel can turn on."
  }
  Set-PublicTunnelDesiredState -DesiredOn $true | Out-Null
  Request-PublicTunnelReconciliation | Out-Null
  return "Named Cloudflare tunnel desired state is On at $($NamedTunnelConfig.publicUrl); reconciliation was triggered."
}

function Stop-BridgeTunnel {
  # Persist Off before any privileged call so failures always fail closed.
  Set-PublicTunnelDesiredState -DesiredOn $false | Out-Null
  Request-PublicTunnelReconciliation | Out-Null
  return "Named Cloudflare tunnel desired state is Off; reconciliation was triggered."
}

function Stop-BridgeProcessSafely {
  Set-PublicTunnelDesiredState -DesiredOn $false | Out-Null
  Request-PublicTunnelReconciliation | Out-Null

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $service = Get-NamedTunnelServiceSnapshot -Config $NamedTunnelConfig
    if ($service.State -eq "Stopped") {
      return Stop-BridgeProcess
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The tunnel did not reconcile Off, so the protected bridge was left running."
}

function Restart-BridgeProcessSafely {
  Invoke-WithTunnelReconcileLock -Operation {
    $service = Get-NamedTunnelServiceSnapshot -Config $NamedTunnelConfig
    if ($service.State -eq "Running") {
      Invoke-CloudflaredServiceAction -ServiceAction Stop
    }

    Stop-BridgeProcess | Out-Null
    Start-Sleep -Seconds 1
    Start-BridgeProcess | Out-Null
    Wait-ForProtectedBridge

    $desiredState = Get-PublicTunnelDesiredState
    if ($desiredState.Valid -and $desiredState.DesiredOn) {
      Assert-FixedTunnelConfiguration
      Invoke-CloudflaredServiceAction -ServiceAction Start
      return "Protected bridge restarted; public tunnel desired state remained On and was republished after health succeeded."
    }

    Invoke-CloudflaredServiceAction -ServiceAction Stop
    return "Protected bridge restarted; public tunnel remains Off."
  }
}

function Open-LogFolder {
  Start-Process -FilePath "explorer.exe" -ArgumentList @($ControlDir)
}

if ($SelfTest) {
  [pscustomobject]@{
    Ollama = Get-OllamaStatus
    Bridge = Get-BridgeStatus
    Tunnel = Get-TunnelStatus
    Logs = $ControlDir
  } | ConvertTo-Json -Depth 6
  exit 0
}

if ($Action) {
  $message = switch ($Action) {
    "status" { "Status refreshed." }
    "start-bridge" { Start-BridgeProcess }
    "stop-bridge" { Stop-BridgeProcessSafely }
    "restart-bridge" {
      Restart-BridgeProcessSafely
    }
    "start-ollama" {
      Start-DedicatedOllama
    }
    "start-tunnel" {
      Start-BridgeTunnel
    }
    "stop-tunnel" {
      Stop-BridgeTunnel
    }
    "reconcile-tunnel" {
      Invoke-PublicTunnelReconciliation
    }
    "open-logs" {
      Open-LogFolder
      "Opened bridge logs."
    }
  }
  [pscustomobject]@{
    Ok = $true
    Action = $Action
    Message = $message
    Status = if ($Action -in @("stop-bridge", "reconcile-tunnel")) { $null } else {
      [pscustomobject]@{
        Ollama = Get-OllamaStatus
        Bridge = Get-BridgeStatus
        Tunnel = Get-TunnelStatus
      }
    }
  } | ConvertTo-Json -Depth 7
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$font = New-Object System.Drawing.Font("Segoe UI", 10)
$titleFont = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$monoFont = New-Object System.Drawing.Font("Consolas", 9)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Minimalist Ollama Bridge Control"
$form.Size = New-Object System.Drawing.Size(760, 570)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(700, 520)
$form.Font = $font

$root = New-Object System.Windows.Forms.TableLayoutPanel
$root.Dock = "Fill"
$root.Padding = New-Object System.Windows.Forms.Padding(14)
$root.ColumnCount = 1
$root.RowCount = 5
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 42))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 154))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 100))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 34))) | Out-Null
$form.Controls.Add($root)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Minimalist Ollama Bridge"
$title.Font = $titleFont
$title.Dock = "Fill"
$title.TextAlign = "MiddleLeft"
$root.Controls.Add($title, 0, 0)

$statusGrid = New-Object System.Windows.Forms.TableLayoutPanel
$statusGrid.Dock = "Fill"
$statusGrid.ColumnCount = 2
$statusGrid.RowCount = 4
$statusGrid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 140))) | Out-Null
$statusGrid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
for ($i = 0; $i -lt 4; $i++) {
  $statusGrid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 25))) | Out-Null
}
$root.Controls.Add($statusGrid, 0, 1)

function Add-StatusRow {
  param(
    [int]$Row,
    [string]$Name
  )
  $nameLabel = New-Object System.Windows.Forms.Label
  $nameLabel.Text = $Name
  $nameLabel.Dock = "Fill"
  $nameLabel.TextAlign = "MiddleLeft"
  $nameLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
  $valueLabel = New-Object System.Windows.Forms.Label
  $valueLabel.Text = "Checking..."
  $valueLabel.Dock = "Fill"
  $valueLabel.TextAlign = "MiddleLeft"
  $statusGrid.Controls.Add($nameLabel, 0, $Row)
  $statusGrid.Controls.Add($valueLabel, 1, $Row)
  return $valueLabel
}

$ollamaStatusLabel = Add-StatusRow -Row 0 -Name "Protected Ollama"
$bridgeStatusLabel = Add-StatusRow -Row 1 -Name "Bridge"
$tunnelStatusLabel = Add-StatusRow -Row 2 -Name "Tunnel"
$urlStatusLabel = Add-StatusRow -Row 3 -Name "Public URL"

$buttonGrid = New-Object System.Windows.Forms.TableLayoutPanel
$buttonGrid.Dock = "Fill"
$buttonGrid.ColumnCount = 4
$buttonGrid.RowCount = 2
for ($i = 0; $i -lt 4; $i++) {
  $buttonGrid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 25))) | Out-Null
}
for ($i = 0; $i -lt 2; $i++) {
  $buttonGrid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 50))) | Out-Null
}
$root.Controls.Add($buttonGrid, 0, 2)

function New-ControlButton {
  param([string]$Text)
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Dock = "Fill"
  $button.Margin = New-Object System.Windows.Forms.Padding(4)
  $button.FlatStyle = "System"
  return $button
}

$startBridgeButton = New-ControlButton "Start bridge"
$stopBridgeButton = New-ControlButton "Stop bridge"
$restartBridgeButton = New-ControlButton "Restart bridge"
$startOllamaButton = New-ControlButton "Wake protected AI"
$startTunnelButton = New-ControlButton "Start tunnel"
$stopTunnelButton = New-ControlButton "Stop tunnel"
$openLogsButton = New-ControlButton "Open logs"
$refreshButton = New-ControlButton "Refresh"

$buttonGrid.Controls.Add($startBridgeButton, 0, 0)
$buttonGrid.Controls.Add($stopBridgeButton, 1, 0)
$buttonGrid.Controls.Add($restartBridgeButton, 2, 0)
$buttonGrid.Controls.Add($startOllamaButton, 3, 0)
$buttonGrid.Controls.Add($startTunnelButton, 0, 1)
$buttonGrid.Controls.Add($stopTunnelButton, 1, 1)
$buttonGrid.Controls.Add($openLogsButton, 2, 1)
$buttonGrid.Controls.Add($refreshButton, 3, 1)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Dock = "Fill"
$logBox.Multiline = $true
$logBox.ScrollBars = "Vertical"
$logBox.ReadOnly = $true
$logBox.Font = $monoFont
$root.Controls.Add($logBox, 0, 3)

$footer = New-Object System.Windows.Forms.Label
$footer.Dock = "Fill"
$footer.TextAlign = "MiddleLeft"
$footer.Text = "Protected Ollama is isolated on 127.0.0.1:11435 and wakes automatically without changing the tray app."
$root.Controls.Add($footer, 0, 4)

function Add-AppLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  $logBox.AppendText($line + [Environment]::NewLine)
}

function Set-StatusColor {
  param($Label, [bool]$Ok)
  if ($Ok) {
    $Label.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
  } else {
    $Label.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
  }
}

function Update-Status {
  try {
    $ollama = Get-OllamaStatus
    $bridge = Get-BridgeStatus
    $tunnel = Get-TunnelStatus

    $ollamaOk = $ollama.ApiOk
    $bridgeOk = $bridge.Running -and $bridge.HealthOk
    $tunnelOk = $tunnel.Running -and $tunnel.HealthOk

    $ollamaStatusLabel.Text = if ($ollamaOk) {
      "ON - 11435 · $(@($ollama.Models).Count) model(s): $(@($ollama.Models) -join ', ')"
    } else {
      "SLEEPING/OFF - dedicated runtime is not listening on 11435."
    }
    Set-StatusColor $ollamaStatusLabel $ollamaOk

    $bridgeStatusLabel.Text = if ($bridgeOk) {
      "ON - port $Port, pid(s) $($bridge.ProcessIds -join ', ')"
    } elseif ($bridge.Running) {
      "Process running, health failed: $($bridge.Error)"
    } else {
      "OFF - bridge not listening on port $Port."
    }
    Set-StatusColor $bridgeStatusLabel $bridgeOk

    $tunnelStatusLabel.Text = if (!$tunnel.DesiredStateValid) {
      "OFF - desired state is invalid or missing (fail-closed)."
    } elseif (!$tunnel.DesiredOn) {
      "OFF - intentionally disabled; stays off after restart."
    } elseif ($tunnelOk) {
      "ON - named tunnel and fixed URL are healthy."
    } elseif ($tunnel.Running) {
      "Windows service running, fixed URL failed: $($tunnel.Error)"
    } else {
      "Unavailable - approved Cloudflared service is not running."
    }
    Set-StatusColor $tunnelStatusLabel $tunnelOk

    $urlStatusLabel.Text = $tunnel.ConfiguredUrl
    Set-StatusColor $urlStatusLabel ($tunnel.ConfigurationMatches)
  } catch {
    Add-AppLog "Status check failed: $($_.Exception.Message)"
  }
}

function Run-UiAction {
  param(
    [string]$Description,
    [scriptblock]$Action
  )
  try {
    $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    Add-AppLog $Description
    $message = & $Action
    if ($message) { Add-AppLog $message }
    Start-Sleep -Milliseconds 800
    Update-Status
  } catch {
    Add-AppLog "Error: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Minimalist Ollama Bridge", "OK", "Error") | Out-Null
  } finally {
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
}

$startBridgeButton.Add_Click({
  Run-UiAction "Starting protected bridge..." { Start-BridgeProcess }
})

$stopBridgeButton.Add_Click({
  Run-UiAction "Stopping protected bridge..." { Stop-BridgeProcessSafely }
})

$restartBridgeButton.Add_Click({
  Run-UiAction "Restarting protected bridge..." {
    Restart-BridgeProcessSafely
  }
})

$startOllamaButton.Add_Click({
  Run-UiAction "Waking protected Ollama in Auto mode..." {
    Start-DedicatedOllama
  }
})

$startTunnelButton.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Start the named Cloudflare tunnel at https://ai.minimalist.chat and enable automatic recovery?",
    "Start Cloudflare Tunnel",
    "YesNo",
    "Warning"
  )
  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
    Run-UiAction "Starting Cloudflare tunnel..." { Start-BridgeTunnel }
  }
})

$stopTunnelButton.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Stopping the tunnel will make public Ollama AI unavailable. Continue?",
    "Stop Cloudflare Tunnel",
    "YesNo",
    "Warning"
  )
  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
    Run-UiAction "Stopping Cloudflare tunnel..." { Stop-BridgeTunnel }
  }
})

$openLogsButton.Add_Click({ Open-LogFolder })
$refreshButton.Add_Click({ Update-Status })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-Status })
$timer.Start()

$form.Add_Shown({
  Add-AppLog "Control app ready."
  Update-Status
})

[System.Windows.Forms.Application]::Run($form)
