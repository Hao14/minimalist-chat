param(
  [string]$ReleaseDirectory,
  [switch]$VerifyDesktopShortcut
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  $ReleaseDirectory = Join-Path $repoRoot "artifacts\windows\ai-analysis\release"
}

$release = [IO.Path]::GetFullPath($ReleaseDirectory)
if (!(Test-Path -LiteralPath $release -PathType Container)) {
  throw "Release directory was not found: $release"
}

$project = Join-Path $PSScriptRoot "MinimalistAIAnalysis.csproj"
[xml]$projectXml = Get-Content -LiteralPath $project -Raw
$expectedVersion = [string]($projectXml.Project.PropertyGroup.Version | Select-Object -First 1)
$exe = Join-Path $release "MinimalistAIAnalysis.exe"
$checksum = Join-Path $release "MinimalistAIAnalysis.exe.sha256"
$manifestPath = Join-Path $release "release-manifest.json"
$readme = Join-Path $release "README.txt"
$zip = Join-Path $release "MinimalistAIAnalysis-$expectedVersion-win-x64-portable.zip"

foreach ($required in @($exe, $checksum, $manifestPath, $readme, $zip)) {
  if (!(Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required release artifact is missing: $required"
  }
  if ((Get-Item -LiteralPath $required).Length -le 0) {
    throw "Release artifact is empty: $required"
  }
}

$exeInfo = Get-Item -LiteralPath $exe
$actualHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumText = (Get-Content -LiteralPath $checksum -Raw).Trim()
if ($checksumText -notmatch '^([0-9a-fA-F]{64})\s+\*?MinimalistAIAnalysis\.exe$') {
  throw "Checksum file has an invalid format: $checksum"
}
if ($Matches[1].ToLowerInvariant() -ne $actualHash) {
  throw "Checksum file does not match the published executable."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedManifest = [ordered]@{
  schemaVersion = 1
  product = "Minimalist Analysis"
  company = "Minimalist.chat"
  version = $expectedVersion
  platform = "windows"
  architecture = "x64"
  runtimeIdentifier = "win-x64"
  distribution = "self-contained-single-file"
  executable = "MinimalistAIAnalysis.exe"
  executableBytes = $exeInfo.Length
  executableSha256 = $actualHash
  checksum = "MinimalistAIAnalysis.exe.sha256"
  portablePackage = [IO.Path]::GetFileName($zip)
  signed = $false
}
foreach ($entry in $expectedManifest.GetEnumerator()) {
  $actual = $manifest.($entry.Key)
  if ($actual -ne $entry.Value) {
    throw "Manifest field '$($entry.Key)' is '$actual'; expected '$($entry.Value)'."
  }
}
$builtAtUtc = [DateTimeOffset]::MinValue
if ([string]::IsNullOrWhiteSpace([string]$manifest.builtAtUtc) -or
    ![DateTimeOffset]::TryParse([string]$manifest.builtAtUtc, [ref]$builtAtUtc)) {
  throw "Manifest builtAtUtc is missing or invalid."
}

$signature = Get-AuthenticodeSignature -LiteralPath $exe
if ($signature.Status -ne [Management.Automation.SignatureStatus]::NotSigned) {
  throw "Expected an unsigned executable, but Authenticode status is '$($signature.Status)'."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $actualEntries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
  $expectedEntries = @(
    "MinimalistAIAnalysis.exe",
    "MinimalistAIAnalysis.exe.sha256",
    "README.txt",
    "release-manifest.json"
  ) | Sort-Object
  if ($actualEntries.Count -ne $expectedEntries.Count -or
      (Compare-Object -ReferenceObject $expectedEntries -DifferenceObject $actualEntries)) {
    throw "Portable ZIP contents are invalid. Found: $($actualEntries -join ', ')"
  }
  foreach ($entry in $archive.Entries) {
    if ($entry.Length -le 0) {
      throw "Portable ZIP contains an empty entry: $($entry.FullName)"
    }
  }
}
finally {
  $archive.Dispose()
}

if ($VerifyDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
  $shortcutPath = Join-Path $desktop "Minimalist Analysis.lnk"
  if (!(Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "Desktop shortcut was not found: $shortcutPath"
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $null
  try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if (![string]::Equals([IO.Path]::GetFullPath($shortcut.TargetPath), $exe, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Desktop shortcut target is incorrect: $($shortcut.TargetPath)"
    }
    if (![string]::Equals([IO.Path]::GetFullPath($shortcut.WorkingDirectory), $release, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Desktop shortcut working directory is incorrect: $($shortcut.WorkingDirectory)"
    }
  }
  finally {
    if ($null -ne $shortcut) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
}

Write-Host "Release verification passed: $release"
Write-Host "Executable bytes: $($exeInfo.Length)"
Write-Host "Executable SHA256: $actualHash"
