param(
  [switch] $ConfigureStripe
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$firebase = Join-Path $PSScriptRoot 'firebase-node22.ps1'
$hostingPublishGuard = Join-Path $PSScriptRoot 'prepare-hosting-publish.mjs'
$webhookUrl = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeWebhook'
$stripeEvents = @(
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
)

function Get-Node22Executable {
  $roots = @(
    (Join-Path $repoRoot '.deploy-tools'),
    (Join-Path $repoRoot '.tools')
  )
  $candidates = @()

  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) {
      continue
    }
    Get-ChildItem -LiteralPath $root -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue |
      ForEach-Object {
        $nodeExe = Join-Path $_.FullName 'node.exe'
        if (Test-Path -LiteralPath $nodeExe) {
          $versionText = $_.Name -replace '^node-v', '' -replace '-win-x64$', ''
          try {
            $version = [version] $versionText
          } catch {
            $version = [version] '22.0.0'
          }
          $candidates += [pscustomobject]@{
            Node = $nodeExe
            Version = $version
          }
        }
      }
  }

  if ($candidates.Count -eq 0) {
    throw 'Node 22 helper is missing under .deploy-tools or .tools.'
  }
  return ($candidates | Sort-Object Version -Descending | Select-Object -First 1).Node
}

function ConvertFrom-SecretString {
  param([Parameter(Mandatory = $true)] [Security.SecureString] $SecureValue)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-FirebaseSecret {
  param(
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [string] $Value
  )

  $tempFile = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  try {
    Set-Content -LiteralPath $tempFile -Value $Value -NoNewline
    & $firebase functions:secrets:set $Name --data-file $tempFile --force
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to set Firebase secret $Name"
    }
  } finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

function New-StripeWebhookEndpoint {
  param([Parameter(Mandatory = $true)] [string] $StripeSecret)

  $headers = @{ Authorization = "Bearer $StripeSecret" }
  $bodyParts = @(
    "url=$([Uri]::EscapeDataString($webhookUrl))",
    "description=$([Uri]::EscapeDataString('Minimalist Firebase billing webhook'))"
  )
  foreach ($eventName in $stripeEvents) {
    $bodyParts += "enabled_events%5B%5D=$([Uri]::EscapeDataString($eventName))"
  }

  $response = Invoke-RestMethod `
    -Method Post `
    -Uri 'https://api.stripe.com/v1/webhook_endpoints' `
    -Headers $headers `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body ($bodyParts -join '&')

  if (!$response.secret -or !$response.secret.StartsWith('whsec_')) {
    throw 'Stripe did not return a webhook signing secret.'
  }

  return $response.secret
}

$originalHostingPublishOwner = $env:MINIMALIST_HOSTING_PUBLISH_OWNER
$originalRequireRumGate = $env:REQUIRE_RUM_PERFORMANCE_GATE
$nodeExe = Get-Node22Executable
$env:MINIMALIST_HOSTING_PUBLISH_OWNER = [guid]::NewGuid().ToString('N')
$env:REQUIRE_RUM_PERFORMANCE_GATE = 'true'

Push-Location $repoRoot
try {
  Write-Host ''
  Write-Host 'Minimalist Stripe deploy' -ForegroundColor Yellow
  Write-Host 'This will build and deploy Firebase functions + hosting.' -ForegroundColor Gray
  Write-Host ''

  if ($ConfigureStripe) {
    Write-Host 'Stripe secret setup/rotation is enabled.' -ForegroundColor Cyan
    $stripeSecretSecure = Read-Host 'Paste your Stripe secret key (input is hidden)' -AsSecureString
    $stripeSecret = ConvertFrom-SecretString $stripeSecretSecure
    if (!$stripeSecret.StartsWith('sk_')) {
      throw 'That does not look like a Stripe secret key.'
    }

    Write-Host ''
    Write-Host 'Creating Stripe webhook endpoint...' -ForegroundColor Cyan
    $webhookSecret = New-StripeWebhookEndpoint -StripeSecret $stripeSecret

    Write-Host 'Saving Firebase secrets...' -ForegroundColor Cyan
    Set-FirebaseSecret -Name 'STRIPE_SECRET_KEY' -Value $stripeSecret
    Set-FirebaseSecret -Name 'STRIPE_WEBHOOK_SECRET' -Value $webhookSecret

    Remove-Variable stripeSecret -ErrorAction SilentlyContinue
    Remove-Variable webhookSecret -ErrorAction SilentlyContinue
  } else {
    Write-Host 'Skipping Stripe secret setup. Use -ConfigureStripe only when rotating Stripe secrets.' -ForegroundColor Gray
  }

  Write-Host 'Deploying Firebase functions and hosting...' -ForegroundColor Cyan
  Write-Host 'Hosting predeploy will run the RUM gate, allocate a fresh build number, and build.' -ForegroundColor Gray
  & $firebase deploy --force --only 'functions,hosting'
  if ($LASTEXITCODE -ne 0) {
    throw 'Firebase deploy failed.'
  }

  Write-Host ''
  Write-Host 'Deploy complete.' -ForegroundColor Green
} finally {
  try {
    & $nodeExe $hostingPublishGuard --cleanup
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Hosting publish lock cleanup exited with code $LASTEXITCODE."
    }
  } catch {
    Write-Warning "Hosting publish lock cleanup failed: $($_.Exception.Message)"
  }
  $env:MINIMALIST_HOSTING_PUBLISH_OWNER = $originalHostingPublishOwner
  $env:REQUIRE_RUM_PERFORMANCE_GATE = $originalRequireRumGate
  Pop-Location
}
