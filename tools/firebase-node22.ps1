$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-Node22Runtime {
  $roots = @(
    (Join-Path $repoRoot '.deploy-tools'),
    (Join-Path $repoRoot '.tools')
  )

  $candidates = @()
  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) {
      continue
    }

    Get-ChildItem -LiteralPath $root -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue | ForEach-Object {
      $nodeExe = Join-Path $_.FullName 'node.exe'
      if (Test-Path -LiteralPath $nodeExe) {
        $versionText = $_.Name -replace '^node-v', '' -replace '-win-x64$', ''
        try {
          $version = [version] $versionText
        } catch {
          $version = [version] '22.0.0'
        }

        $candidates += [pscustomobject]@{
          Root = $_.FullName
          Node = $nodeExe
          Version = $version
        }
      }
    }
  }

  if ($candidates.Count -eq 0) {
    throw "Node 22 helper is missing. Expected a node-v22.*-win-x64 folder under .deploy-tools or .tools."
  }

  return $candidates | Sort-Object Version -Descending | Select-Object -First 1
}

function Get-FirebaseCli {
  $candidates = @(
    (Join-Path $repoRoot 'node_modules\firebase-tools\lib\bin\firebase.js')
  )

  if ($env:APPDATA) {
    $candidates += Join-Path $env:APPDATA 'npm\node_modules\firebase-tools\lib\bin\firebase.js'
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Firebase CLI is missing. Run 'npm install' from $repoRoot or install firebase-tools globally."
}

$nodeRuntime = Get-Node22Runtime
$nodeExe = $nodeRuntime.Node
$firebaseCli = Get-FirebaseCli

$env:FIREBASE_SKIP_UPDATE_CHECK = 'true'
$env:PATH = "$($nodeRuntime.Root);$env:PATH"

& $nodeExe $firebaseCli @args
exit $LASTEXITCODE
