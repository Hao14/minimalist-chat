param(
  [switch] $ConfigureStripe
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$firebase = Join-Path $PSScriptRoot 'firebase-node22.ps1'
$webhookUrl = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeWebhook'
$stripeEvents = @(
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
)

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

  Write-Host 'Building app...' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Build failed.'
  }

  Write-Host 'Deploying Firebase functions and hosting...' -ForegroundColor Cyan
  & $firebase deploy --force --only 'functions,hosting'
  if ($LASTEXITCODE -ne 0) {
    throw 'Firebase deploy failed.'
  }

  Write-Host ''
  Write-Host 'Deploy complete.' -ForegroundColor Green
} finally {
  Pop-Location
}
