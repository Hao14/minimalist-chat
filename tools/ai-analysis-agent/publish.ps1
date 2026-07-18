#Requires -Version 5.1

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "AgentFileSecurity.ps1")

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$projectPath = Join-Path $PSScriptRoot "MinimalistAIAnalysis.Agent.csproj"
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $artifactsRoot "windows\ai-analysis-agent\release"))
$artifactsPrefix = $artifactsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (!$outputDirectory.StartsWith($artifactsPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $outputDirectory -eq $artifactsRoot) {
  throw "Refusing to clean a release directory outside the repository artifacts folder: $outputDirectory"
}

foreach ($pathSegment in @(
    $artifactsRoot,
    (Join-Path $artifactsRoot "windows"),
    (Join-Path $artifactsRoot "windows\ai-analysis-agent"),
    $outputDirectory)) {
  if (Test-Path -LiteralPath $pathSegment) {
    $pathItem = Get-Item -LiteralPath $pathSegment -Force
    if (($pathItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to clean a release path that crosses a reparse point: $pathSegment"
    }
  }
}

if (!(Test-Path -LiteralPath $projectPath -PathType Leaf)) {
  throw "Remote Analysis agent project was not found: $projectPath"
}

[xml]$projectXml = Get-Content -LiteralPath $projectPath -Raw
$version = [string]($projectXml.Project.PropertyGroup.Version | Select-Object -First 1)
$outputType = [string]($projectXml.Project.PropertyGroup.OutputType | Select-Object -First 1)
$assemblyName = [string]($projectXml.Project.PropertyGroup.AssemblyName | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "The agent project must define a release Version."
}
if ($outputType -cne "WinExe" -or $assemblyName -cne "MinimalistAIAnalysisAgent") {
  throw "The agent project must remain the approved windowless MinimalistAIAnalysisAgent WinExe."
}

if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
  $installedTask = Get-ScheduledTask -TaskName "Minimalist Chat Remote Analysis Agent" -ErrorAction SilentlyContinue
  if ($null -ne $installedTask -and [string]$installedTask.State -eq "Running") {
    throw "Stop or uninstall the running 'Minimalist Chat Remote Analysis Agent' task before replacing its executable."
  }
}

if (Test-Path -LiteralPath $outputDirectory) {
  Remove-Item -LiteralPath $outputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Protect-MinimalistAgentPath -LiteralPath $outputDirectory

dotnet publish $projectPath `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:ContinuousIntegrationBuild=true `
  -p:DebugType=None `
  -p:DebugSymbols=false `
  --nologo `
  -o $outputDirectory

if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$executablePath = Join-Path $outputDirectory "MinimalistAIAnalysisAgent.exe"
if (!(Test-Path -LiteralPath $executablePath -PathType Leaf)) {
  throw "Publish completed without creating $executablePath"
}

$executableInfo = Get-Item -LiteralPath $executablePath
if ($executableInfo.Length -le 0) {
  throw "Published executable is empty: $executablePath"
}

$hash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = Join-Path $outputDirectory "MinimalistAIAnalysisAgent.exe.sha256"
Set-Content -LiteralPath $checksumPath -Value "$hash *MinimalistAIAnalysisAgent.exe" -Encoding Ascii

$zipName = "MinimalistAIAnalysisAgent-$version-win-x64.zip"
$zipPath = Join-Path $outputDirectory $zipName
$manifestPath = Join-Path $outputDirectory "release-manifest.json"
$manifest = [ordered]@{
  schemaVersion = 1
  product = "Minimalist Analysis Agent"
  company = "Minimalist.chat"
  version = $version
  platform = "windows"
  architecture = "x64"
  runtimeIdentifier = "win-x64"
  distribution = "self-contained-single-file"
  executable = $executableInfo.Name
  executableBytes = $executableInfo.Length
  executableSha256 = $hash
  checksum = [IO.Path]::GetFileName($checksumPath)
  portablePackage = $zipName
  listenAddress = "127.0.0.1"
  listenPort = 8791
  scheduledTaskName = "Minimalist Chat Remote Analysis Agent"
  signed = $false
  builtAtUtc = [DateTime]::UtcNow.ToString("o")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Compress-Archive `
  -LiteralPath @($executablePath, $checksumPath, $manifestPath) `
  -DestinationPath $zipPath `
  -CompressionLevel Optimal

if (!(Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "Portable package was not created: $zipPath"
}

Protect-MinimalistAgentPath -LiteralPath $outputDirectory -Recurse

Write-Output "Release executable: $executablePath"
Write-Output "SHA256: $hash"
Write-Output "Manifest: $manifestPath"
Write-Output "Portable package: $zipPath"
Write-Output "No local configuration or credentials were included in the release."
Write-Output "Release ACL: current user, SYSTEM, and Administrators only."
