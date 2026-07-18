param(
  [int]$Port = 8790,
  [string]$Token = "",
  [switch]$UseFirebaseSecret,
  [string]$FirebaseProject = "chat-app-356c1",
  [string]$OllamaUpstream = "http://127.0.0.1:11435",
  [string]$OllamaModelStore = (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) ".ollama\models"),
  [string]$ModelAllowlist = "qwen3:4b-instruct,qwen3:14b,qwen2.5vl:7b",
  [int]$MaxBodyMB = 16,
  [int]$IdleShutdownMinutes = 120,
  [switch]$DisableManagedOllama
)

$ErrorActionPreference = "Stop"

if ($UseFirebaseSecret -and -not $Token) {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  $firebaseNode22 = Join-Path $repoRoot "tools\firebase-node22.ps1"
  if (!(Test-Path -LiteralPath $firebaseNode22)) {
    throw "Cannot find tools\firebase-node22.ps1. Pass -Token manually or run from the repo checkout."
  }

  $Token = (& $firebaseNode22 functions:secrets:access OLLAMA_SERVER_TOKEN --project $FirebaseProject).Trim()
  if (-not $Token) {
    throw "Firebase secret OLLAMA_SERVER_TOKEN was empty or unavailable."
  }
}

$generatedToken = $false
if (-not $Token) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $Token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $generatedToken = $true
}

$env:BRIDGE_PORT = [string]$Port
$env:OLLAMA_UPSTREAM = $OllamaUpstream
$env:OLLAMA_BRIDGE_OLLAMA_HOST = "127.0.0.1:11435"
$env:OLLAMA_BRIDGE_MODEL_STORE = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($OllamaModelStore))
$env:OLLAMA_BRIDGE_TOKEN = $Token
$env:OLLAMA_BRIDGE_MODEL_ALLOWLIST = $ModelAllowlist
$env:OLLAMA_BRIDGE_MAX_BODY_BYTES = [string]($MaxBodyMB * 1024 * 1024)
$env:OLLAMA_BRIDGE_MANAGE_UPSTREAM = if ($DisableManagedOllama) { "false" } else { "true" }
$env:OLLAMA_BRIDGE_IDLE_SHUTDOWN_MS = [string]($IdleShutdownMinutes * 60 * 1000)
$env:OLLAMA_BRIDGE_KEEP_ALIVE = "${IdleShutdownMinutes}m"
$env:OLLAMA_BRIDGE_CONTROL_FILE = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")) ".bridge-control\ai-control.json"
$env:OLLAMA_BRIDGE_ACTIVITY_FILE = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")) ".bridge-control\ai-activity.json"

function Get-BridgeNodeCommand {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  $roots = @(
    (Join-Path $repoRoot ".deploy-tools"),
    (Join-Path $repoRoot ".tools")
  )

  $candidates = @()
  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Directory -Filter "node-v22.*-win-x64" -ErrorAction SilentlyContinue | ForEach-Object {
      $nodeExe = Join-Path $_.FullName "node.exe"
      if (!(Test-Path -LiteralPath $nodeExe)) { return }
      $versionText = $_.Name -replace "^node-v", "" -replace "-win-x64$", ""
      try {
        $version = [version]$versionText
      } catch {
        $version = [version]"22.0.0"
      }
      $candidates += [pscustomobject]@{ Node = $nodeExe; Version = $version }
    }
  }

  if ($candidates.Count -gt 0) {
    return ($candidates | Sort-Object Version -Descending | Select-Object -First 1).Node
  }

  return "node"
}

if ($generatedToken) {
  Write-Host "Protected Ollama bridge token:"
  Write-Host $Token
  Write-Host ""
  Write-Host "Use this Firebase Functions env value:"
  Write-Host "OLLAMA_SERVER_TOKEN=$Token"
  Write-Host ""
} elseif ($UseFirebaseSecret) {
  Write-Host "Using Firebase Secret Manager value for OLLAMA_SERVER_TOKEN."
} else {
  Write-Host "Using provided OLLAMA_SERVER_TOKEN."
}

Write-Host "Starting bridge on http://127.0.0.1:$Port ..."
Write-Host "Protected Ollama upstream: $OllamaUpstream"
Write-Host "Protected model store: $env:OLLAMA_BRIDGE_MODEL_STORE"
Write-Host "Max bridge body: $MaxBodyMB MB"
if ($DisableManagedOllama) {
  Write-Host "On-demand Ollama management disabled."
} else {
  Write-Host "Ollama will start on demand and stop after $IdleShutdownMinutes idle minute(s) when owned by this bridge."
}

$nodeCommand = Get-BridgeNodeCommand
& $nodeCommand "$PSScriptRoot\ollama-bridge.cjs"
