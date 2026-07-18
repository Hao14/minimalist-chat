param(
  [string]$TokenFile,
  [switch]$FromClipboard,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$CommonScript = Join-Path $PSScriptRoot "CloudflaredService.Common.ps1"
. $CommonScript

$resolvedTokenFile = $null
$newToken = $null
$newCommandLine = $null
$oldCommandLine = $null
$serviceWasUpdated = $false

try {
  $hasTokenFile = ![string]::IsNullOrWhiteSpace($TokenFile)
  if ([bool]$FromClipboard -eq $hasTokenFile) {
    throw "Specify exactly one connector credential source."
  }

  $config = Get-NamedTunnelConfig
  if ($FromClipboard) {
    $clipboardText = Get-Clipboard -Raw
    $credentialMatch = [regex]::Match(
      [string]$clipboardText,
      '(?i)(?:^|\s)cloudflared(?:\.exe)?\s+service\s+install\s+(?<token>[A-Za-z0-9._~+/=-]{20,})(?:\s|$)'
    )
    if (!$credentialMatch.Success) {
      throw "The clipboard does not contain a Cloudflared service-install command."
    }
    $newToken = $credentialMatch.Groups['token'].Value
  } else {
    $resolvedTokenFile = (Resolve-Path -LiteralPath $TokenFile -ErrorAction Stop).Path
    $newToken = Read-CloudflaredTokenFile -TokenFile $resolvedTokenFile
  }
  $newTunnelId = Get-CloudflaredTunnelIdFromToken -Token $newToken
  if (![string]::Equals($newTunnelId, [string]$config.tunnelId, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The new connector token belongs to a different tunnel; no service change was made."
  }

  # Validate the currently installed service before requesting elevation.
  Get-NamedTunnelServiceSnapshot -Config $config | Out-Null

  if (!(Test-IsAdministrator)) {
    if ($Elevated) {
      throw "Administrator rights are required to rotate the Cloudflared service credential."
    }
    $quotedScript = '"' + $PSCommandPath.Replace('"', '""') + '"'
    $credentialArguments = if ($FromClipboard) {
      "-FromClipboard"
    } else {
      $quotedTokenFile = '"' + $resolvedTokenFile.Replace('"', '""') + '"'
      "-TokenFile $quotedTokenFile"
    }
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript $credentialArguments -Elevated"
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "The elevated connector credential rotation did not complete."
    }
    Write-Output "Cloudflared connector credential rotated and the approved tunnel service restarted."
    exit 0
  }

  $escapedName = ([string]$config.serviceName).Replace("'", "''")
  $service = Get-CimInstance Win32_Service -Filter "Name='$escapedName'" -ErrorAction Stop
  Assert-CloudflaredCommandLineIdentity -CommandLine ([string]$service.PathName) -Config $config | Out-Null
  if (![string]::Equals([string]$service.State, "Running", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Start the approved Cloudflared tunnel service before rotating its connector credential."
  }

  $oldCommandLine = [string]$service.PathName
  $newCommandLine = Set-CloudflaredTokenInCommandLine -CommandLine $oldCommandLine -Token $newToken -Config $config

  Stop-Service -Name ([string]$config.serviceName) -Force -ErrorAction Stop
  (Get-Service -Name ([string]$config.serviceName) -ErrorAction Stop).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Stopped,
    [TimeSpan]::FromSeconds(30)
  )

  $changeResult = Invoke-CimMethod -InputObject $service -MethodName Change -Arguments @{ PathName = $newCommandLine } -ErrorAction Stop
  if ([int]$changeResult.ReturnValue -ne 0) {
    throw "Windows rejected the approved Cloudflared service ImagePath update."
  }
  $serviceWasUpdated = $true

  Get-NamedTunnelServiceSnapshot -Config $config | Out-Null
  Start-Service -Name ([string]$config.serviceName) -ErrorAction Stop
  (Get-Service -Name ([string]$config.serviceName) -ErrorAction Stop).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
  $verified = Get-NamedTunnelServiceSnapshot -Config $config
  if (![string]::Equals($verified.State, "Running", [StringComparison]::OrdinalIgnoreCase)) {
    throw "The approved Cloudflared service did not return to the running state."
  }

  Write-Output "Cloudflared connector credential rotated and the approved tunnel service restarted."
} catch {
  if ($serviceWasUpdated -and $oldCommandLine -and (Test-IsAdministrator)) {
    try {
      $rollbackService = Get-CimInstance Win32_Service -Filter "Name='$escapedName'" -ErrorAction Stop
      $rollbackResult = Invoke-CimMethod -InputObject $rollbackService -MethodName Change -Arguments @{ PathName = $oldCommandLine } -ErrorAction Stop
      if ([int]$rollbackResult.ReturnValue -eq 0) {
        Start-Service -Name ([string]$config.serviceName) -ErrorAction SilentlyContinue
      }
    } catch {
      # Keep the original fixed error below; never emit a command line containing a token.
    }
  }
  Write-Error "Cloudflared connector credential rotation failed safely. The temporary credential source has been cleared."
  exit 1
} finally {
  $newToken = $null
  $newCommandLine = $null
  $oldCommandLine = $null
  if ($resolvedTokenFile -and (Test-Path -LiteralPath $resolvedTokenFile -PathType Leaf)) {
    Remove-Item -LiteralPath $resolvedTokenFile -Force -ErrorAction SilentlyContinue
  }
  if ($FromClipboard) {
    Set-Clipboard -Value $null
  }
}
