param(
  [Parameter(Mandatory = $true)][string]$Uid,
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$ConfirmUid
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.deploy-tools') -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'node.exe' } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (!$node) {
  $node = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tools') -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'node.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if (!$node) { throw 'Bundled Node 22 runtime was not found.' }

& $node (Join-Path $PSScriptRoot 'delete-firebase-user.cjs') --uid $Uid --project $Project --confirm-uid $ConfirmUid
exit $LASTEXITCODE
