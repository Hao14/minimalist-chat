param(
  [int]$Port = 8787,
  [string]$Token = "",
  [string]$OllamaUpstream = "http://127.0.0.1:11434",
  [string]$ModelAllowlist = "llama3.1:latest,qwen2.5vl:7b,llama3.2-vision:latest,llava:latest",
  [int]$MaxBodyMB = 16
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $Token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$env:BRIDGE_PORT = [string]$Port
$env:OLLAMA_UPSTREAM = $OllamaUpstream
$env:OLLAMA_BRIDGE_TOKEN = $Token
$env:OLLAMA_BRIDGE_MODEL_ALLOWLIST = $ModelAllowlist
$env:OLLAMA_BRIDGE_MAX_BODY_BYTES = [string]($MaxBodyMB * 1024 * 1024)

Write-Host "Protected Ollama bridge token:"
Write-Host $Token
Write-Host ""
Write-Host "Use this Firebase Functions env value:"
Write-Host "OLLAMA_SERVER_TOKEN=$Token"
Write-Host ""
Write-Host "Starting bridge on http://127.0.0.1:$Port ..."
Write-Host "Max bridge body: $MaxBodyMB MB"

node "$PSScriptRoot\ollama-bridge.cjs"
