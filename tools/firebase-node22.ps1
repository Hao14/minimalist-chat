$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeRoot = Join-Path $repoRoot '.tools\node-v22.13.1-win-x64'
$nodeExe = Join-Path $nodeRoot 'node.exe'
$firebaseCli = Join-Path $env:APPDATA 'npm\node_modules\firebase-tools\lib\bin\firebase.js'

if (!(Test-Path $nodeExe)) {
  throw "Node 22 helper is missing at $nodeExe"
}

if (!(Test-Path $firebaseCli)) {
  throw "Firebase CLI is missing at $firebaseCli"
}

$env:FIREBASE_SKIP_UPDATE_CHECK = 'true'

& $nodeExe $firebaseCli @args
exit $LASTEXITCODE
