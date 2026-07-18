$script:AllowedCloudflaredServiceName = "Cloudflared"
$script:AllowedCloudflaredTunnelId = "ed357000-fc0e-430d-8c76-e66c48f75cdf"
$script:AllowedCloudflaredPublicUrl = "https://ai.minimalist.chat"
$script:AllowedCloudflaredOriginUrl = "http://127.0.0.1:8790"
$script:AllowedCloudflaredExecutablePath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$script:NamedTunnelConfigPath = Join-Path $PSScriptRoot "named-tunnel.json"
$script:PublicTunnelStatePath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")) ".bridge-control\public-tunnel.json"

function Get-NamedTunnelConfig {
  if (!(Test-Path -LiteralPath $script:NamedTunnelConfigPath -PathType Leaf)) {
    throw "The named Cloudflare tunnel configuration is missing."
  }

  try {
    $config = Get-Content -LiteralPath $script:NamedTunnelConfigPath -Raw | ConvertFrom-Json
  } catch {
    throw "The named Cloudflare tunnel configuration is invalid."
  }

  $expected = @{
    serviceName = $script:AllowedCloudflaredServiceName
    tunnelId = $script:AllowedCloudflaredTunnelId
    publicUrl = $script:AllowedCloudflaredPublicUrl
    originUrl = $script:AllowedCloudflaredOriginUrl
    executablePath = $script:AllowedCloudflaredExecutablePath
    recoveryTaskName = "Minimalist Chat Public Gateway Recovery"
  }
  if ([int]$config.schemaVersion -ne 1) {
    throw "The named Cloudflare tunnel configuration schema is unsupported."
  }
  foreach ($key in $expected.Keys) {
    if (![string]::Equals([string]$config.$key, [string]$expected[$key], [StringComparison]::OrdinalIgnoreCase)) {
      throw "The named Cloudflare tunnel configuration does not match the approved Minimalist Chat tunnel."
    }
  }

  return $config
}

function ConvertFrom-CloudflaredBase64Text {
  param([Parameter(Mandatory = $true)][string]$Text)

  $base64 = $Text.Replace('-', '+').Replace('_', '/')
  switch ($base64.Length % 4) {
    0 { }
    2 { $base64 += "==" }
    3 { $base64 += "=" }
    default { throw "The connector token could not be decoded." }
  }
  try {
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))
  } catch {
    throw "The connector token could not be decoded."
  }
}

function Get-CloudflaredTunnelIdFromToken {
  param([Parameter(Mandatory = $true)][string]$Token)

  if ([string]::IsNullOrWhiteSpace($Token) -or $Token -match '\s') {
    throw "The connector token could not be decoded."
  }

  $segments = @($Token)
  $parts = $Token.Split('.')
  if ($parts.Count -ge 2) {
    $segments = @($parts[1], $parts[0], $Token)
  }

  foreach ($segment in $segments) {
    try {
      $payloadText = ConvertFrom-CloudflaredBase64Text -Text $segment
      $payload = $payloadText | ConvertFrom-Json
      $candidate = @(
        $payload.t,
        $payload.tunnelId,
        $payload.tunnel_id,
        $payload.TunnelID
      ) | Where-Object { ![string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1
      if (!$candidate) { continue }
      [guid]$parsed = [guid]::Empty
      if ([guid]::TryParse([string]$candidate, [ref]$parsed)) {
        return $parsed.ToString('D')
      }
    } catch {
      # Try the next supported token envelope without surfacing token contents.
    }
  }

  throw "The connector token could not be decoded."
}

function Get-CloudflaredTokenMatch {
  param([Parameter(Mandatory = $true)][string]$CommandLine)

  $pattern = '(?i)(?<!\S)--token(?:=|\s+)(?:"(?<quoted>[^"]+)"|(?<plain>[^\s"]+))'
  $matches = [regex]::Matches($CommandLine, $pattern)
  if ($matches.Count -ne 1) {
    throw "The Cloudflared service command must contain exactly one connector token."
  }
  return $matches[0]
}

function Assert-CloudflaredCommandLineIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)]$Config
  )

  $executableMatch = [regex]::Match($CommandLine, '^\s*(?:"(?<quoted>[^"]+)"|(?<plain>\S+))')
  if (!$executableMatch.Success) {
    throw "The Cloudflared service executable could not be identified."
  }
  $executablePath = if ($executableMatch.Groups['quoted'].Success) {
    $executableMatch.Groups['quoted'].Value
  } else {
    $executableMatch.Groups['plain'].Value
  }
  if (![string]::Equals($executablePath, [string]$Config.executablePath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Cloudflared service executable is not the approved Minimalist Chat binary."
  }

  $tokenMatch = Get-CloudflaredTokenMatch -CommandLine $CommandLine
  $token = if ($tokenMatch.Groups['quoted'].Success) {
    $tokenMatch.Groups['quoted'].Value
  } else {
    $tokenMatch.Groups['plain'].Value
  }
  try {
    $actualTunnelId = Get-CloudflaredTunnelIdFromToken -Token $token
  } finally {
    $token = $null
  }
  if (![string]::Equals($actualTunnelId, [string]$Config.tunnelId, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Cloudflared service belongs to a different tunnel; no service change was made."
  }

  return [pscustomobject]@{
    TunnelId = $actualTunnelId
    ExecutablePath = $executablePath
  }
}

function Get-NamedTunnelServiceSnapshot {
  param([Parameter(Mandatory = $true)]$Config)

  $escapedName = ([string]$Config.serviceName).Replace("'", "''")
  $service = Get-CimInstance Win32_Service -Filter "Name='$escapedName'" -ErrorAction SilentlyContinue
  if (!$service) {
    throw "The approved Cloudflared Windows service is not installed."
  }
  if (![string]::Equals([string]$service.StartName, "LocalSystem", [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Cloudflared Windows service does not use the approved LocalSystem identity."
  }
  $identity = Assert-CloudflaredCommandLineIdentity -CommandLine ([string]$service.PathName) -Config $Config

  return [pscustomobject]@{
    ServiceName = [string]$service.Name
    State = [string]$service.State
    StartMode = [string]$service.StartMode
    ProcessId = [int]$service.ProcessId
    TunnelId = [string]$identity.TunnelId
    ExecutablePath = [string]$identity.ExecutablePath
    StartName = [string]$service.StartName
  }
}

function Set-CloudflaredTokenInCommandLine {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)]$Config
  )

  if ($Token -notmatch '^[A-Za-z0-9._~+/=-]+$') {
    throw "The connector token contains unsupported characters."
  }
  $actualTunnelId = Get-CloudflaredTunnelIdFromToken -Token $Token
  if (![string]::Equals($actualTunnelId, [string]$Config.tunnelId, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The new connector token belongs to a different tunnel; no service change was made."
  }

  $tokenMatch = Get-CloudflaredTokenMatch -CommandLine $CommandLine
  $separator = if ($tokenMatch.Value -match '(?i)^--token=') { "=" } else { " " }
  $replacement = "--token$separator$Token"
  return $CommandLine.Substring(0, $tokenMatch.Index) + $replacement + $CommandLine.Substring($tokenMatch.Index + $tokenMatch.Length)
}

function Read-CloudflaredTokenFile {
  param([Parameter(Mandatory = $true)][string]$TokenFile)

  $item = Get-Item -LiteralPath $TokenFile -Force -ErrorAction Stop
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "The connector token path must be a regular file."
  }
  if ($item.Length -lt 20 -or $item.Length -gt 16384) {
    throw "The connector token file has an unexpected size."
  }
  $token = (Get-Content -LiteralPath $item.FullName -Raw -ErrorAction Stop).Trim()
  if ([string]::IsNullOrWhiteSpace($token) -or $token -match '\s') {
    throw "The connector token file is invalid."
  }
  return $token
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertFrom-PublicTunnelStateJson {
  param([AllowNull()][string]$Json)

  $failedClosed = [pscustomobject]@{
    Valid = $false
    DesiredOn = $false
  }
  if ([string]::IsNullOrWhiteSpace($Json)) { return $failedClosed }

  try {
    $state = $Json | ConvertFrom-Json
  } catch {
    return $failedClosed
  }
  if ($null -eq $state -or $state -isnot [pscustomobject]) { return $failedClosed }

  $properties = @($state.PSObject.Properties)
  $schemaProperties = @($properties | Where-Object { $_.Name -ceq "schemaVersion" })
  $desiredProperties = @($properties | Where-Object { $_.Name -ceq "desiredOn" })
  if ($properties.Count -ne 2 -or $schemaProperties.Count -ne 1 -or $desiredProperties.Count -ne 1) {
    return $failedClosed
  }
  if (@([regex]::Matches($Json, '"schemaVersion"\s*:')).Count -ne 1 -or
      @([regex]::Matches($Json, '"desiredOn"\s*:')).Count -ne 1) {
    return $failedClosed
  }

  $schemaVersion = $schemaProperties[0].Value
  $desiredOn = $desiredProperties[0].Value
  $isInteger = $schemaVersion -is [byte] -or
    $schemaVersion -is [int16] -or
    $schemaVersion -is [int32] -or
    $schemaVersion -is [int64]
  if (!$isInteger -or [int64]$schemaVersion -ne 1 -or $desiredOn -isnot [bool]) {
    return $failedClosed
  }

  return [pscustomobject]@{
    Valid = $true
    DesiredOn = [bool]$desiredOn
  }
}

function Get-PublicTunnelDesiredState {
  param([string]$StatePath = $script:PublicTunnelStatePath)

  try {
    if (!(Test-Path -LiteralPath $StatePath -PathType Leaf)) {
      return [pscustomobject]@{ Valid = $false; DesiredOn = $false }
    }
    $json = Get-Content -LiteralPath $StatePath -Raw -ErrorAction Stop
    return ConvertFrom-PublicTunnelStateJson -Json $json
  } catch {
    return [pscustomobject]@{ Valid = $false; DesiredOn = $false }
  }
}

function Set-PublicTunnelDesiredState {
  param(
    [Parameter(Mandatory = $true)][bool]$DesiredOn,
    [string]$StatePath = $script:PublicTunnelStatePath
  )

  $fullStatePath = [IO.Path]::GetFullPath($StatePath)
  $stateDirectory = [IO.Path]::GetDirectoryName($fullStatePath)
  if ([string]::IsNullOrWhiteSpace($stateDirectory)) {
    throw "The public tunnel state path is invalid."
  }
  [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null

  $desiredJson = if ($DesiredOn) { "true" } else { "false" }
  $json = "{`"schemaVersion`":1,`"desiredOn`":$desiredJson}`r`n"
  $temporaryPath = Join-Path $stateDirectory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($fullStatePath), [guid]::NewGuid().ToString('N'))
  $backupPath = "$temporaryPath.bak"
  $utf8NoBom = New-Object Text.UTF8Encoding($false)

  try {
    [IO.File]::WriteAllText($temporaryPath, $json, $utf8NoBom)
    if ([IO.File]::Exists($fullStatePath)) {
      [IO.File]::Replace($temporaryPath, $fullStatePath, $backupPath, $true)
    } else {
      try {
        [IO.File]::Move($temporaryPath, $fullStatePath)
      } catch [IO.IOException] {
        if (![IO.File]::Exists($fullStatePath)) { throw }
        [IO.File]::Replace($temporaryPath, $fullStatePath, $backupPath, $true)
      }
    }
  } finally {
    if ([IO.File]::Exists($temporaryPath)) {
      [IO.File]::Delete($temporaryPath)
    }
    if ([IO.File]::Exists($backupPath)) {
      [IO.File]::Delete($backupPath)
    }
  }

  $verified = Get-PublicTunnelDesiredState -StatePath $fullStatePath
  if (!$verified.Valid -or $verified.DesiredOn -ne $DesiredOn) {
    throw "The public tunnel desired state could not be persisted safely."
  }
  return $verified
}
