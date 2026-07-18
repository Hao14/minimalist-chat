param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Start", "Stop")]
  [string]$Action,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$CommonScript = Join-Path $PSScriptRoot "CloudflaredService.Common.ps1"
. $CommonScript

function Invoke-ElevatedSelf {
  param([Parameter(Mandatory = $true)][string]$RequestedAction)

  $quotedScript = '"' + $PSCommandPath.Replace('"', '""') + '"'
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript -Action $RequestedAction -Elevated"
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "The elevated Cloudflared service action did not complete."
  }
}

try {
  $config = Get-NamedTunnelConfig

  # Validate the service before asking for elevation and again in the elevated process.
  Get-NamedTunnelServiceSnapshot -Config $config | Out-Null
  if (!(Test-IsAdministrator)) {
    if ($Elevated) {
      throw "Administrator rights are required to control the approved Cloudflared service."
    }
    Invoke-ElevatedSelf -RequestedAction $Action
    Write-Output "Approved Cloudflared service action completed."
    exit 0
  }

  Get-NamedTunnelServiceSnapshot -Config $config | Out-Null
  $serviceName = [string]$config.serviceName

  if ($Action -eq "Start") {
    # The reconciler is the source of truth. Automatic startup could publish
    # the origin before the protected bridge passes its health gate.
    Set-Service -Name $serviceName -StartupType Manual -ErrorAction Stop

    $sc = Join-Path $env:SystemRoot "System32\sc.exe"
    & $sc failure $serviceName "reset=" "86400" "actions=" "restart/5000/restart/15000/restart/60000" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Windows rejected the Cloudflared recovery policy." }
    & $sc failureflag $serviceName "1" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Windows rejected the Cloudflared non-crash recovery policy." }

    $serviceController = Get-Service -Name $serviceName -ErrorAction Stop
    if ($serviceController.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
      Start-Service -Name $serviceName -ErrorAction Stop
      $serviceController.WaitForStatus(
        [ServiceProcess.ServiceControllerStatus]::Running,
        [TimeSpan]::FromSeconds(30)
      )
    }

    $verified = Get-NamedTunnelServiceSnapshot -Config $config
    if ($verified.State -ne "Running" -or $verified.StartMode -ne "Manual") {
      throw "The approved Cloudflared service did not reach its reconciled running state."
    }
    Write-Output "Approved Cloudflared tunnel is on under scheduled reconciliation."
    exit 0
  }

  # Manual is retained in both states; desired state is stored separately.
  Set-Service -Name $serviceName -StartupType Manual -ErrorAction Stop
  $serviceController = Get-Service -Name $serviceName -ErrorAction Stop
  if ($serviceController.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    $serviceController.WaitForStatus(
      [ServiceProcess.ServiceControllerStatus]::Stopped,
      [TimeSpan]::FromSeconds(30)
    )
  }

  $verified = Get-NamedTunnelServiceSnapshot -Config $config
  if ($verified.State -ne "Stopped" -or $verified.StartMode -ne "Manual") {
    throw "The approved Cloudflared service did not reach its persistent off state."
  }
  Write-Output "Approved Cloudflared tunnel is off under scheduled reconciliation."
} catch {
  Write-Error "The approved Cloudflared service action failed. No other Windows service was changed."
  exit 1
}
