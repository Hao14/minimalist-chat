[CmdletBinding()]
param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\Minimalist-chat-vault')).Path,
    [string]$Destination = (Join-Path $env:USERPROFILE '.gbrain\sources\minimalist-chat-vault'),
    [switch]$Preview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceRootFull = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$destinationFull = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
$allowedDestinationRoot = [IO.Path]::GetFullPath(
    (Join-Path $env:USERPROFILE '.gbrain\sources')
).TrimEnd('\')
$allowedDirectories = @(
    '00 Home',
    '10 Product',
    '11 Product',
    '20 Research',
    '30 Audits',
    '40 Operations',
    '50 Skills',
    '90 Memory'
)

if (-not (Test-Path -LiteralPath $sourceRootFull -PathType Container)) {
    throw "Vault source is missing: $sourceRootFull"
}

$allowedPrefix = $allowedDestinationRoot + [IO.Path]::DirectorySeparatorChar
if (-not $destinationFull.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must stay under $allowedDestinationRoot. Got: $destinationFull"
}

if (Test-Path -LiteralPath $destinationFull) {
    $destinationItem = Get-Item -LiteralPath $destinationFull -Force
    if (-not $destinationItem.PSIsContainer -or
        ($destinationItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Destination must be a normal directory, not a file, junction, or symlink: $destinationFull"
    }
    $destinationEntries = @(Get-ChildItem -LiteralPath $destinationFull -Force)
    if ($destinationEntries.Count -gt 0) {
        $ownershipMarker = Join-Path $destinationFull '.gbrain-meta\manifest.json'
        if (-not (Test-Path -LiteralPath $ownershipMarker -PathType Leaf)) {
            throw "Refusing to clean a non-empty destination without a GBrain mirror ownership marker: $destinationFull"
        }
        $existingManifest = Get-Content -LiteralPath $ownershipMarker -Raw | ConvertFrom-Json
        if ([int]$existingManifest.schema_version -ne 1 -or
            [string]$existingManifest.mirror_kind -ne 'minimalist-chat-vault' -or
            [string]$existingManifest.source_root -ne $sourceRootFull) {
            throw "GBrain mirror ownership marker does not match this source: $ownershipMarker"
        }
    }
}

$selected = [Collections.Generic.List[object]]::new()
foreach ($directoryName in $allowedDirectories) {
    $directory = Join-Path $sourceRootFull $directoryName
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        continue
    }

    foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -File -Filter '*.md') {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            continue
        }
        $relative = $file.FullName.Substring($sourceRootFull.Length + 1).Replace('\', '/')
        if ($relative -match '(^|/)\.\.(/|$)') {
            throw "Vault candidate escaped SourceRoot: $relative"
        }
        $selected.Add([pscustomobject]@{
            RelativePath = $relative
            SourcePath = $file.FullName
            Length = $file.Length
        })
    }
}

$selected = @($selected | Sort-Object RelativePath -Unique)
$totalBytes = ($selected | Measure-Object -Property Length -Sum).Sum
Write-Output "Curated notes: $($selected.Count)"
Write-Output "Source bytes:  $totalBytes"
Write-Output "Destination:   $destinationFull"

if ($Preview) {
    $selected |
        ForEach-Object { $_.RelativePath.Split('/')[0] } |
        Group-Object |
        Sort-Object Name |
        Select-Object Count, Name |
        Format-Table -AutoSize
    Write-Output 'Preview only; no mirror files or commits were changed.'
    return
}

New-Item -ItemType Directory -Path $destinationFull -Force | Out-Null
$expectedFiles = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
$fileSha256 = [ordered]@{}

foreach ($candidate in $selected) {
    [void]$expectedFiles.Add($candidate.RelativePath)
    $destinationPath = [IO.Path]::GetFullPath(
        (Join-Path $destinationFull $candidate.RelativePath.Replace('/', '\'))
    )
    $destinationPrefix = $destinationFull + [IO.Path]::DirectorySeparatorChar
    if (-not $destinationPath.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination escaped the curated mirror: $($candidate.RelativePath)"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    $sourceHash = (Get-FileHash -LiteralPath $candidate.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Copy-Item -LiteralPath $candidate.SourcePath -Destination $destinationPath -Force
    $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $sourceHash.Equals($destinationHash, [StringComparison]::Ordinal)) {
        throw "Copied mirror hash did not match source: $($candidate.RelativePath)"
    }
    $fileSha256[$candidate.RelativePath] = $sourceHash
}

$removedFiles = 0
$existingFiles = Get-ChildItem -LiteralPath $destinationFull -Recurse -File -Force |
    Where-Object {
        $relative = $_.FullName.Substring($destinationFull.Length + 1).Replace('\', '/')
        -not ($relative.StartsWith('.git/', [StringComparison]::OrdinalIgnoreCase) -or
            $relative.StartsWith('.gbrain-meta/', [StringComparison]::OrdinalIgnoreCase) -or
            $relative -eq '.gitignore')
    }
foreach ($existing in $existingFiles) {
    $relative = $existing.FullName.Substring($destinationFull.Length + 1).Replace('\', '/')
    if (-not $expectedFiles.Contains($relative)) {
        Remove-Item -LiteralPath $existing.FullName -Force
        $removedFiles++
    }
}

Get-ChildItem -LiteralPath $destinationFull -Recurse -Directory -Force |
    Where-Object {
        -not ($_.FullName.StartsWith(
            (Join-Path $destinationFull '.git'),
            [StringComparison]::OrdinalIgnoreCase
        ) -or $_.FullName.StartsWith(
            (Join-Path $destinationFull '.gbrain-meta'),
            [StringComparison]::OrdinalIgnoreCase
        ))
    } |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object {
        if (-not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }

Set-Content -LiteralPath (Join-Path $destinationFull '.gitignore') -Encoding utf8 -Value @(
    '.gbrain-meta/'
)

$metadataDirectory = Join-Path $destinationFull '.gbrain-meta'
New-Item -ItemType Directory -Path $metadataDirectory -Force | Out-Null
$manifest = [ordered]@{
    schema_version = 1
    mirror_kind = 'minimalist-chat-vault'
    source_root = $sourceRootFull
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    file_count = $selected.Count
    total_bytes = $totalBytes
    files = @($selected.RelativePath)
    file_sha256 = $fileSha256
}
$manifest | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $metadataDirectory 'manifest.json') -Encoding utf8

if (-not (Test-Path -LiteralPath (Join-Path $destinationFull '.git'))) {
    & git -C $destinationFull init --initial-branch main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not initialize the curated vault mirror repository.'
    }
}

& git -C $destinationFull config user.name 'GBrain Local Index'
& git -C $destinationFull config user.email 'gbrain@local.invalid'
& git -C $destinationFull config core.autocrlf false
& git -C $destinationFull config core.safecrlf false
& git -C $destinationFull add -A
if ($LASTEXITCODE -ne 0) {
    throw 'Could not stage the curated vault mirror refresh.'
}

& git -C $destinationFull diff --cached --quiet
$diffExit = $LASTEXITCODE
if ($diffExit -eq 1) {
    & git -C $destinationFull -c commit.gpgSign=false commit -m 'Refresh curated Minimalist Chat vault snapshot' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not commit the curated vault mirror refresh.'
    }
} elseif ($diffExit -ne 0) {
    throw 'Could not inspect the curated vault mirror staging state.'
}

$mirrorCommit = (& git -C $destinationFull rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the curated vault mirror commit.'
}

Write-Output "Removed stale mirror files: $removedFiles"
Write-Output "Mirror commit: $mirrorCommit"
