param(
  [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$project = Join-Path $PSScriptRoot "MinimalistAIAnalysis.csproj"
$releaseReadme = Join-Path $PSScriptRoot "release\README.txt"
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$output = [IO.Path]::GetFullPath((Join-Path $artifactsRoot "windows\ai-analysis\release"))
$artifactsPrefix = $artifactsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (!$output.StartsWith($artifactsPrefix, [StringComparison]::OrdinalIgnoreCase) -or $output -eq $artifactsRoot) {
  throw "Refusing to clean a release directory outside the repository artifacts folder: $output"
}

$releasePathSegments = @(
  $artifactsRoot,
  (Join-Path $artifactsRoot "windows"),
  (Join-Path $artifactsRoot "windows\ai-analysis"),
  $output
)
foreach ($pathSegment in $releasePathSegments) {
  if (Test-Path -LiteralPath $pathSegment) {
    $pathItem = Get-Item -LiteralPath $pathSegment -Force
    if (($pathItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to clean a release path that crosses a reparse point: $pathSegment"
    }
  }
}

if (!(Test-Path -LiteralPath $project -PathType Leaf)) {
  throw "Project file was not found: $project"
}

if (!(Test-Path -LiteralPath $releaseReadme -PathType Leaf)) {
  throw "Release README template was not found: $releaseReadme"
}

[xml]$projectXml = Get-Content -LiteralPath $project -Raw
$version = [string]($projectXml.Project.PropertyGroup.Version | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "The project must define a release Version."
}

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output -Force | Out-Null

dotnet publish $project `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:ContinuousIntegrationBuild=true `
  --nologo `
  -o $output

if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$exe = Join-Path $output "MinimalistAIAnalysis.exe"
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw "Publish completed without creating $exe"
}

$exeInfo = Get-Item -LiteralPath $exe
if ($exeInfo.Length -le 0) {
  throw "Published executable is empty: $exe"
}

$readme = Join-Path $output "README.txt"
Copy-Item -LiteralPath $releaseReadme -Destination $readme

$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$checksum = Join-Path $output "MinimalistAIAnalysis.exe.sha256"
Set-Content -LiteralPath $checksum -Value "$hash *MinimalistAIAnalysis.exe" -Encoding Ascii

$zipName = "MinimalistAIAnalysis-$version-win-x64-portable.zip"
$zip = Join-Path $output $zipName
$manifestPath = Join-Path $output "release-manifest.json"
$manifest = [ordered]@{
  schemaVersion = 1
  product = "Minimalist Analysis"
  company = "Minimalist.chat"
  version = $version
  platform = "windows"
  architecture = "x64"
  runtimeIdentifier = "win-x64"
  distribution = "self-contained-single-file"
  executable = $exeInfo.Name
  executableBytes = $exeInfo.Length
  executableSha256 = $hash
  checksum = [IO.Path]::GetFileName($checksum)
  portablePackage = $zipName
  signed = $false
  builtAtUtc = [DateTime]::UtcNow.ToString("o")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Compress-Archive `
  -LiteralPath @($exe, $checksum, $manifestPath, $readme) `
  -DestinationPath $zip `
  -CompressionLevel Optimal

if (!(Test-Path -LiteralPath $zip -PathType Leaf)) {
  throw "Portable package was not created: $zip"
}

if ($CreateDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
  if ([string]::IsNullOrWhiteSpace($desktop)) {
    throw "Windows did not return a Desktop directory for the current user."
  }

  $shortcutPath = Join-Path $desktop "Minimalist Analysis.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $null
  try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $output
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = "Minimalist Analysis"
    $shortcut.Save()
  }
  finally {
    if ($null -ne $shortcut) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
  Write-Host "Desktop shortcut: $shortcutPath"
}

$verifyScript = Join-Path $PSScriptRoot "verify-release.ps1"
$verifyParameters = @{ ReleaseDirectory = $output }
if ($CreateDesktopShortcut) {
  $verifyParameters.VerifyDesktopShortcut = $true
}
& $verifyScript @verifyParameters

Write-Host "Release executable: $exe"
Write-Host "SHA256: $checksum"
Write-Host "Manifest: $manifestPath"
Write-Host "Portable package: $zip"
