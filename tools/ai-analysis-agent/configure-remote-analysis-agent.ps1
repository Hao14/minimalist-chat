#Requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$TeamDomain,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ApplicationAudience,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$AllowedEmail
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "AgentFileSecurity.ps1")

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData) -or
    !(Test-Path -LiteralPath $localAppData -PathType Container)) {
  throw "The current user's LocalAppData directory is unavailable."
}
$productDirectory = Join-Path $localAppData "Minimalist.chat"
$agentDirectory = Join-Path $productDirectory "AnalysisAgent"
$configPath = Join-Path $agentDirectory "remote-analysis-agent.json"

function Get-CanonicalTeamDomain {
  param([Parameter(Mandatory = $true)][string]$Value)

  $candidate = $Value.Trim()
  $uri = $null
  if (![Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$uri) -or
      ![string]::Equals($uri.Scheme, [Uri]::UriSchemeHttps, [StringComparison]::OrdinalIgnoreCase) -or
      ![string]::IsNullOrEmpty($uri.UserInfo) -or
      !$uri.IsDefaultPort -or
      $uri.AbsolutePath -ne "/" -or
      ![string]::IsNullOrEmpty($uri.Query) -or
      ![string]::IsNullOrEmpty($uri.Fragment)) {
    throw "TeamDomain must be an HTTPS Cloudflare Access team URL with no port, path, query, or fragment (for example, https://team.cloudflareaccess.com)."
  }

  $suffix = ".cloudflareaccess.com"
  $domainHost = $uri.IdnHost.ToLowerInvariant()
  if (!$domainHost.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "TeamDomain must end with $suffix."
  }

  $team = $domainHost.Substring(0, $domainHost.Length - $suffix.Length)
  if ($team.Length -lt 1 -or $team.Length -gt 63 -or
      $team[0] -eq '-' -or $team[$team.Length - 1] -eq '-' -or
      $team -notmatch '^[a-z0-9-]+$') {
    throw "TeamDomain contains an invalid Cloudflare Access team name."
  }

  return "https://$domainHost"
}

function Get-CanonicalAudience {
  param([Parameter(Mandatory = $true)][string]$Value)

  $candidate = $Value.Trim()
  if ($candidate -notmatch '^[A-Za-z0-9_-]{16,128}$') {
    throw "ApplicationAudience must be the 16-128 character Access application AUD tag from Cloudflare."
  }
  return $candidate
}

function Get-CanonicalEmail {
  param([Parameter(Mandatory = $true)][string]$Value)

  $candidate = $Value.Trim().ToLowerInvariant()
  if ($candidate.Length -gt 254 -or $candidate -match '\s') {
    throw "AllowedEmail must be one email address with no whitespace."
  }

  $firstAt = $candidate.IndexOf('@')
  $lastAt = $candidate.LastIndexOf('@')
  if ($firstAt -lt 1 -or $firstAt -ne $lastAt -or $firstAt -ge ($candidate.Length - 3)) {
    throw "AllowedEmail must be one complete email address."
  }

  $domain = $candidate.Substring($firstAt + 1)
  if (!$domain.Contains('.') -or $domain.StartsWith('.') -or $domain.EndsWith('.')) {
    throw "AllowedEmail must include a complete email domain."
  }
  return $candidate
}

$canonicalTeamDomain = Get-CanonicalTeamDomain -Value $TeamDomain
$canonicalAudience = Get-CanonicalAudience -Value $ApplicationAudience
$canonicalEmail = Get-CanonicalEmail -Value $AllowedEmail

$configuration = [ordered]@{
  schemaVersion = 1
  teamDomain = $canonicalTeamDomain
  applicationAudience = $canonicalAudience
  allowedEmail = $canonicalEmail
}

if ($PSCmdlet.ShouldProcess($configPath, "Write the local remote Analysis agent configuration")) {
  $productDirectory = Initialize-MinimalistAgentDirectory -LiteralPath $productDirectory
  $agentDirectory = Initialize-MinimalistAgentDirectory -LiteralPath $agentDirectory

  $temporaryPath = Join-Path $agentDirectory (".remote-analysis-agent.{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
  try {
    $json = $configuration | ConvertTo-Json -Depth 2
    $utf8WithoutBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryPath, $json + [Environment]::NewLine, $utf8WithoutBom)
    Protect-MinimalistAgentPath -LiteralPath $temporaryPath
    Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force
    Protect-MinimalistAgentPath -LiteralPath $configPath
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }

  $saved = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $savedFields = @($saved.PSObject.Properties.Name)
  $expectedFields = @("schemaVersion", "teamDomain", "applicationAudience", "allowedEmail")
  if ($savedFields.Count -ne $expectedFields.Count -or
      @(Compare-Object -ReferenceObject $expectedFields -DifferenceObject $savedFields).Count -ne 0 -or
      [int]$saved.schemaVersion -ne 1 -or
      [string]$saved.teamDomain -cne $canonicalTeamDomain -or
      [string]$saved.applicationAudience -cne $canonicalAudience -or
      [string]$saved.allowedEmail -cne $canonicalEmail) {
    throw "The saved remote Analysis agent configuration failed verification."
  }

  Write-Output "Configured the remote Analysis agent at $configPath."
  Write-Output "The configuration is local-only and stored outside the repository."
  Write-Output "Configuration ACL: current user, SYSTEM, and Administrators only."
}
