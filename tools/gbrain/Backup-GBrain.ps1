[CmdletBinding()]
param(
    [ValidateRange(1, 100)]
    [int]$RetentionCount = 7,

    [ValidateRange(10, 600)]
    [int]$DrillTimeoutSeconds = 90,

    [switch]$DryRun,
    [switch]$SkipRestoreDrill,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupRootSchemaVersion = 1
$snapshotSchemaVersion = 1
$backupRootKind = 'gbrain-pglite-backup-root'
$snapshotKind = 'gbrain-pglite-snapshot'
$gbrainHome = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.gbrain')).TrimEnd('\')
$activeConfigPath = Join-Path $gbrainHome 'config.json'
$backupRoot = [IO.Path]::GetFullPath((Join-Path $gbrainHome 'backups')).TrimEnd('\')
$rootMarkerPath = Join-Path $backupRoot '.gbrain-backup-root.json'
$operationLockPath = Join-Path $backupRoot '.backup-operation.lock'
$gbrainExecutable = (Get-Command 'gbrain' -ErrorAction Stop).Source

function ConvertTo-NormalizedFullPath {
    param([Parameter(Mandatory)][string]$Path)

    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Test-DirectChildPath {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Child
    )

    $parentFull = ConvertTo-NormalizedFullPath -Path $Parent
    $childFull = ConvertTo-NormalizedFullPath -Path $Child
    return [string]::Equals(
        [IO.Path]::GetDirectoryName($childFull),
        $parentFull,
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Test-PathWithinRoot {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Candidate
    )

    $rootFull = ConvertTo-NormalizedFullPath -Path $Root
    $candidateFull = ConvertTo-NormalizedFullPath -Path $Candidate
    $prefix = $rootFull + [IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NormalDirectory {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label must be a normal directory, not a file, junction, or symlink: $Path"
    }
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value,
        [int]$Depth = 12
    )

    $parent = Split-Path -Parent $Path
    Assert-NormalDirectory -Path $parent -Label 'JSON destination directory'
    $temporaryPath = Join-Path $parent ('.tmp-json-' + [guid]::NewGuid().ToString('N'))
    $encoding = New-Object Text.UTF8Encoding($false)
    try {
        $payload = $Value | ConvertTo-Json -Depth $Depth
        [IO.File]::WriteAllText($temporaryPath, $payload + [Environment]::NewLine, $encoding)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-GBrainDatabaseOwners {
    $owners = [Collections.Generic.List[object]]::new()
    $processes = @(Get-CimInstance Win32_Process)
    foreach ($process in $processes) {
        $name = [string]$process.Name
        $commandLine = [string]$process.CommandLine
        $executablePath = [string]$process.ExecutablePath
        $isGBrainWrapper = $name -ieq 'gbrain.exe' -and (
            [string]::Equals($executablePath, $gbrainExecutable, [StringComparison]::OrdinalIgnoreCase) -or
            $commandLine -match '(?i)(?:^|[\\/\s"])(?:gbrain|gbrain\.exe)(?:"|\s|$)'
        )
        $isGBrainBunChild = $name -ieq 'bun.exe' -and
            $commandLine -match '(?i)[\\/]node_modules[\\/]gbrain[\\/]src[\\/]cli\.ts(?:"|\s|$)'
        $isKnownMaintenanceHost = (
            $name -ieq 'powershell.exe' -and
            $commandLine -match '(?i)(?:^|[\\/\s"])(?:Refresh-GBrain\.ps1)(?:"|\s|$)'
        ) -or (
            $name -ieq 'python.exe' -and
            $commandLine -match '(?i)(?:^|[\\/\s"])(?:import-gbrain-obsidian-links\.py)(?:"|\s|$)'
        ) -or (
            $name -ieq 'node.exe' -and
            $commandLine -match '(?i)(?:^|[\\/\s"])(?:gbrain-retrieval-eval\.mjs)(?:"|\s|$)'
        )

        if ($isGBrainWrapper -or $isGBrainBunChild -or $isKnownMaintenanceHost) {
            $mode = 'maintenance'
            if ($commandLine -match '(?i)(?:^|\s)serve(?:\s|$)') {
                $mode = 'serve'
            } elseif ($commandLine -match '(?i)(?:^|\s)watch(?:\s|$)') {
                $mode = 'watch'
            } elseif ($isKnownMaintenanceHost) {
                $mode = 'project-maintenance'
            }
            $owners.Add([pscustomobject]@{
                name = $name
                pid = [int]$process.ProcessId
                mode = $mode
            })
        }
    }
    return @($owners | Sort-Object pid -Unique)
}

function Assert-ActiveDatabaseQuiescent {
    param([Parameter(Mandatory)][string]$DatabasePath)

    $owners = @(Get-GBrainDatabaseOwners)
    if ($owners.Count -gt 0) {
        $summary = ($owners | ForEach-Object { "$($_.name) PID $($_.pid) [$($_.mode)]" }) -join ', '
        throw "GBrain has an active serve or maintenance owner ($summary). Disconnect/close it before backup. This command never stops a live owner."
    }

    $lockDirectory = Join-Path $DatabasePath '.gbrain-lock'
    if (Test-Path -LiteralPath $lockDirectory) {
        throw "The active PGLite database still has a GBrain ownership lock: $lockDirectory. Refusing to copy or remove it."
    }

    $postmasterPid = Join-Path $DatabasePath 'postmaster.pid'
    if (Test-Path -LiteralPath $postmasterPid) {
        throw "The active PGLite database still has postmaster.pid: $postmasterPid. Refusing to copy or remove it."
    }

}

function Read-ActiveGBrainConfig {
    if (-not (Test-Path -LiteralPath $activeConfigPath -PathType Leaf)) {
        throw "GBrain config is missing: $activeConfigPath"
    }
    $configItem = Get-Item -LiteralPath $activeConfigPath -Force
    if (($configItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "GBrain config must not be a symlink: $activeConfigPath"
    }
    try {
        $config = Get-Content -LiteralPath $activeConfigPath -Raw | ConvertFrom-Json
    } catch {
        throw "GBrain config is not valid JSON: $activeConfigPath"
    }
    if ([string]$config.engine -ne 'pglite') {
        throw "Backup-GBrain supports the active PGLite engine only. Configured engine: $($config.engine)"
    }
    if (-not $config.database_path) {
        throw 'The active PGLite config does not define database_path.'
    }

    $databasePath = ConvertTo-NormalizedFullPath -Path ([string]$config.database_path)
    $expectedDatabasePath = ConvertTo-NormalizedFullPath -Path (Join-Path $gbrainHome 'brain.pglite')
    if (-not [string]::Equals($databasePath, $expectedDatabasePath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing an unexpected active database path. Expected $expectedDatabasePath, got $databasePath"
    }
    Assert-NormalDirectory -Path $databasePath -Label 'Active PGLite database'
    return [pscustomobject]@{
        config = $config
        database_path = $databasePath
    }
}

function Initialize-OrReadBackupRoot {
    param(
        [Parameter(Mandatory)][string]$ActiveDatabase,
        [switch]$Preview
    )

    $gbrainPrefix = $gbrainHome + [IO.Path]::DirectorySeparatorChar
    if (-not $backupRoot.StartsWith($gbrainPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals(
            [IO.Path]::GetDirectoryName($backupRoot),
            $gbrainHome,
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Backup root must be the direct ~/.gbrain/backups directory. Got: $backupRoot"
    }

    if (Test-Path -LiteralPath $backupRoot) {
        Assert-NormalDirectory -Path $backupRoot -Label 'GBrain backup root'
    } elseif (-not $Preview) {
        New-Item -ItemType Directory -Path $backupRoot | Out-Null
        Assert-NormalDirectory -Path $backupRoot -Label 'GBrain backup root'
    }

    if (Test-Path -LiteralPath $rootMarkerPath -PathType Leaf) {
        $markerItem = Get-Item -LiteralPath $rootMarkerPath -Force
        if (($markerItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Backup root marker must not be a symlink: $rootMarkerPath"
        }
        try {
            $marker = Get-Content -LiteralPath $rootMarkerPath -Raw | ConvertFrom-Json
        } catch {
            throw "Backup root marker is invalid JSON: $rootMarkerPath"
        }
        if ([int]$marker.schema_version -ne $backupRootSchemaVersion -or
            [string]$marker.kind -ne $backupRootKind -or
            -not $marker.root_id -or
            -not [string]::Equals(
                (ConvertTo-NormalizedFullPath -Path ([string]$marker.gbrain_home)),
                $gbrainHome,
                [StringComparison]::OrdinalIgnoreCase
            ) -or
            -not [string]::Equals(
                (ConvertTo-NormalizedFullPath -Path ([string]$marker.active_database)),
                $ActiveDatabase,
                [StringComparison]::OrdinalIgnoreCase
            )) {
            throw "Backup root ownership marker does not match this GBrain profile: $rootMarkerPath"
        }
        return $marker
    }

    if (Test-Path -LiteralPath $backupRoot) {
        $entries = @(Get-ChildItem -LiteralPath $backupRoot -Force)
        if ($entries.Count -gt 0) {
            throw "Refusing to claim a non-empty backup root without its ownership marker: $backupRoot"
        }
    }

    $newMarker = [ordered]@{
        schema_version = $backupRootSchemaVersion
        kind = $backupRootKind
        root_id = [guid]::NewGuid().ToString('D')
        gbrain_home = $gbrainHome
        active_database = $ActiveDatabase
        created_at = (Get-Date).ToUniversalTime().ToString('o')
    }
    if (-not $Preview) {
        Write-JsonAtomic -Path $rootMarkerPath -Value $newMarker
    }
    return [pscustomobject]$newMarker
}

function Enter-BackupOperationLock {
    $encoding = New-Object Text.UTF8Encoding($false)
    try {
        $stream = New-Object IO.FileStream(
            $operationLockPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
    } catch [IO.IOException] {
        throw "Another backup operation may be active, or a stale operation lock needs review: $operationLockPath"
    }
    try {
        $payload = [ordered]@{
            schema_version = 1
            kind = 'gbrain-pglite-backup-operation'
            pid = $PID
            started_at = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Compress
        $bytes = $encoding.GetBytes($payload + [Environment]::NewLine)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        return $stream
    } catch {
        $stream.Dispose()
        Remove-Item -LiteralPath $operationLockPath -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Get-SafeTreeFiles {
    param([Parameter(Mandatory)][string]$Root)

    Assert-NormalDirectory -Path $Root -Label 'Tree root'
    $rootFull = ConvertTo-NormalizedFullPath -Path $Root
    $stack = New-Object 'Collections.Generic.Stack[string]'
    $files = [Collections.Generic.List[IO.FileInfo]]::new()
    $stack.Push($rootFull)

    while ($stack.Count -gt 0) {
        $directory = $stack.Pop()
        foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
            # The MCP retrieval-reflex endpoint is an ephemeral Windows local
            # socket stored at the database root. It can survive an abrupt
            # serve shutdown as an inaccessible reparse point, but it is not
            # database state and must never be copied into a snapshot.
            if ([string]::Equals($directory, $rootFull, [StringComparison]::OrdinalIgnoreCase) -and
                $entry.Name -eq '.gbrain-resolve.sock') {
                continue
            }
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing a reparse point inside the PGLite tree: $($entry.FullName)"
            }
            if ($entry.PSIsContainer) {
                $stack.Push($entry.FullName)
            } else {
                $files.Add($entry)
            }
        }
    }
    return @($files | Sort-Object FullName)
}

function Get-TreeInventory {
    param([Parameter(Mandatory)][string]$Root)

    $rootFull = ConvertTo-NormalizedFullPath -Path $Root
    $files = @(Get-SafeTreeFiles -Root $rootFull)
    $inventory = [Collections.Generic.List[object]]::new()
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($rootFull.Length + 1).Replace('\', '/')
        if ($relativePath -match '[\x00-\x1f]' -or $relativePath -match '(^|/)\.\.(/|$)') {
            throw "Unsafe relative path in PGLite tree: $relativePath"
        }
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $inventory.Add([pscustomobject]@{
            relative_path = $relativePath
            length_bytes = [long]$file.Length
            sha256 = $hash
        })
    }
    return @($inventory | Sort-Object relative_path)
}

function Get-InventorySummary {
    param([Parameter(Mandatory)][object[]]$Inventory)

    $builder = New-Object Text.StringBuilder
    [long]$totalBytes = 0
    foreach ($entry in $Inventory) {
        $totalBytes += [long]$entry.length_bytes
        [void]$builder.Append([string]$entry.sha256)
        [void]$builder.Append("`t")
        [void]$builder.Append([string]$entry.length_bytes)
        [void]$builder.Append("`t")
        [void]$builder.Append([string]$entry.relative_path)
        [void]$builder.Append("`n")
    }
    $encoding = New-Object Text.UTF8Encoding($false)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $digestBytes = $sha256.ComputeHash($encoding.GetBytes($builder.ToString()))
    } finally {
        $sha256.Dispose()
    }
    $digest = ([BitConverter]::ToString($digestBytes)).Replace('-', '').ToLowerInvariant()
    return [pscustomobject]@{
        file_count = $Inventory.Count
        total_bytes = $totalBytes
        inventory_sha256 = $digest
    }
}

function Copy-SafeDirectoryTree {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    $sourceFull = ConvertTo-NormalizedFullPath -Path $Source
    $destinationFull = ConvertTo-NormalizedFullPath -Path $Destination
    if (Test-Path -LiteralPath $destinationFull) {
        throw "Copy destination already exists: $destinationFull"
    }
    if (-not (Test-PathWithinRoot -Root $backupRoot -Candidate $destinationFull)) {
        throw "Copy destination escaped the owned backup root: $destinationFull"
    }

    $files = @(Get-SafeTreeFiles -Root $sourceFull)
    New-Item -ItemType Directory -Path $destinationFull | Out-Null
    foreach ($directory in Get-ChildItem -LiteralPath $sourceFull -Recurse -Directory -Force |
        Sort-Object { $_.FullName.Length }) {
        if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing a reparse point inside the PGLite tree: $($directory.FullName)"
        }
        $relativePath = $directory.FullName.Substring($sourceFull.Length + 1)
        $destinationDirectory = ConvertTo-NormalizedFullPath -Path (Join-Path $destinationFull $relativePath)
        if (-not (Test-PathWithinRoot -Root $destinationFull -Candidate $destinationDirectory)) {
            throw "Directory copy escaped its destination: $relativePath"
        }
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($sourceFull.Length + 1)
        $destinationFile = [IO.Path]::GetFullPath((Join-Path $destinationFull $relativePath))
        if (-not (Test-PathWithinRoot -Root $destinationFull -Candidate $destinationFile)) {
            throw "File copy escaped its destination: $relativePath"
        }
        $destinationDirectory = Split-Path -Parent $destinationFile
        if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }
        [IO.File]::Copy($file.FullName, $destinationFile, $false)
        [IO.File]::SetLastWriteTimeUtc($destinationFile, $file.LastWriteTimeUtc)
    }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Argument)

    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') {
        return $Argument
    }
    $builder = New-Object Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq [char]'\') {
            $backslashes++
            continue
        }
        if ($character -eq [char]'"') {
            if ($backslashes -gt 0) {
                [void]$builder.Append([char]'\', $backslashes * 2)
                $backslashes = 0
            }
            [void]$builder.Append([char]'\')
            [void]$builder.Append([char]'"')
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append([char]'\', $backslashes * 2)
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Stop-ExactProcessTree {
    param([Parameter(Mandatory)][int]$RootProcessId)

    $allProcesses = @(Get-CimInstance Win32_Process)
    $pendingParents = New-Object 'Collections.Generic.Queue[int]'
    $pendingParents.Enqueue($RootProcessId)
    $descendants = [Collections.Generic.List[int]]::new()
    while ($pendingParents.Count -gt 0) {
        $parentId = $pendingParents.Dequeue()
        foreach ($child in $allProcesses | Where-Object { [int]$_.ParentProcessId -eq $parentId }) {
            $childId = [int]$child.ProcessId
            $descendants.Add($childId)
            $pendingParents.Enqueue($childId)
        }
    }
    for ($index = $descendants.Count - 1; $index -ge 0; $index--) {
        Stop-Process -Id $descendants[$index] -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-IsolatedGBrain {
    param(
        [Parameter(Mandatory)][string]$DrillParent,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Label
    )

    $argumentLine = (@($Arguments | ForEach-Object { ConvertTo-WindowsArgument -Argument $_ })) -join ' '
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $gbrainExecutable
    $startInfo.Arguments = $argumentLine
    $startInfo.WorkingDirectory = $DrillParent
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['GBRAIN_HOME'] = $DrillParent
    $startInfo.EnvironmentVariables['GBRAIN_SOURCE'] = 'default'
    $startInfo.EnvironmentVariables['GBRAIN_SKIP_STARTUP_HOOKS'] = '1'
    $startInfo.EnvironmentVariables['GBRAIN_NO_BANNER'] = '1'
    $startInfo.EnvironmentVariables['GBRAIN_NO_GITIGNORE'] = '1'
    foreach ($name in @('GBRAIN_DATABASE_URL', 'DATABASE_URL', 'GBRAIN_BRAIN_ID')) {
        [void]$startInfo.EnvironmentVariables.Remove($name)
    }

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Could not launch the isolated GBrain $Label probe."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($DrillTimeoutSeconds * 1000)) {
            Stop-ExactProcessTree -RootProcessId $process.Id
            throw "Isolated GBrain $Label probe exceeded $DrillTimeoutSeconds seconds; only its exact process tree was stopped."
        }
        $process.WaitForExit()
        $stdout = [string]$stdoutTask.Result
        $stderr = [string]$stderrTask.Result
        $exitCode = [int]$process.ExitCode
    } finally {
        $process.Dispose()
    }
    if ($exitCode -ne 0) {
        $stderrTail = if ($stderr.Length -gt 3000) { $stderr.Substring($stderr.Length - 3000) } else { $stderr }
        throw "Isolated GBrain $Label probe failed with exit code ${exitCode}: $stderrTail"
    }
    return [pscustomobject]@{
        stdout = $stdout.Trim()
        stderr = $stderr.Trim()
    }
}

function ConvertFrom-StrictJsonText {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not $Text.Trim()) {
        throw "$Label returned no JSON."
    }
    try {
        return $Text | ConvertFrom-Json
    } catch {
        throw "$Label returned invalid JSON."
    }
}

function Invoke-RestoreDrill {
    param(
        [Parameter(Mandatory)][string]$SnapshotDatabase,
        [Parameter(Mandatory)]$ActiveConfig
    )

    $drillParent = Join-Path $backupRoot ('.drill-' + [guid]::NewGuid().ToString('N'))
    $drillConfigRoot = Join-Path $drillParent '.gbrain'
    $drillDatabase = Join-Path $drillConfigRoot 'brain.pglite'
    if (-not (Test-DirectChildPath -Parent $backupRoot -Child $drillParent)) {
        throw "Restore drill escaped the owned backup root: $drillParent"
    }
    try {
        New-Item -ItemType Directory -Path $drillConfigRoot -Force | Out-Null
        Copy-SafeDirectoryTree -Source $SnapshotDatabase -Destination $drillDatabase

        $drillConfig = [ordered]@{
            engine = 'pglite'
            database_path = $drillDatabase
        }
        if ($ActiveConfig.schema_pack) {
            $drillConfig.schema_pack = [string]$ActiveConfig.schema_pack
        }
        if ($ActiveConfig.embedding_model) {
            $drillConfig.embedding_model = [string]$ActiveConfig.embedding_model
        }
        if ($ActiveConfig.embedding_dimensions) {
            $drillConfig.embedding_dimensions = [int]$ActiveConfig.embedding_dimensions
        }
        Write-JsonAtomic -Path (Join-Path $drillConfigRoot 'config.json') -Value $drillConfig

        $statsParameters = @{
            DrillParent = $drillParent
            Arguments = @('call', '--source', 'default', 'get_stats', '{}')
            Label = 'stats'
        }
        $statsRun = Invoke-IsolatedGBrain @statsParameters
        $stats = ConvertFrom-StrictJsonText -Text $statsRun.stdout -Label 'GBrain stats probe'
        if ([int]$stats.page_count -lt 1 -or [int]$stats.chunk_count -lt 1) {
            throw "Restore drill opened the database, but it contains no active pages/chunks (pages=$($stats.page_count), chunks=$($stats.chunk_count))."
        }

        $listPayload = [ordered]@{ limit = 1; sort = 'slug' } | ConvertTo-Json -Compress
        $listParameters = @{
            DrillParent = $drillParent
            Arguments = @('call', '--source', 'default', 'list_pages', $listPayload)
            Label = 'page-list'
        }
        $listRun = Invoke-IsolatedGBrain @listParameters
        $pages = @(ConvertFrom-StrictJsonText -Text $listRun.stdout -Label 'GBrain page-list probe')
        if ($pages.Count -lt 1 -or -not $pages[0].title) {
            throw 'Restore drill could not select a page for its query probe.'
        }

        $probeTitle = [string]$pages[0].title
        $searchPayload = [ordered]@{ query = $probeTitle; limit = 3 } | ConvertTo-Json -Compress
        $searchParameters = @{
            DrillParent = $drillParent
            Arguments = @('call', '--source', 'default', 'search', $searchPayload)
            Label = 'search'
        }
        $searchRun = Invoke-IsolatedGBrain @searchParameters
        $searchResults = @(ConvertFrom-StrictJsonText -Text $searchRun.stdout -Label 'GBrain search probe')
        if ($searchResults.Count -lt 1) {
            throw "Restore drill query returned no results for the known page title '$probeTitle'."
        }

        return [pscustomobject]@{
            passed = $true
            page_count = [int]$stats.page_count
            chunk_count = [int]$stats.chunk_count
            embedded_count = [int]$stats.embedded_count
            link_count = [int]$stats.link_count
            probe_title = $probeTitle
            probe_result_count = $searchResults.Count
        }
    } finally {
        if (Test-Path -LiteralPath $drillParent) {
            $drillFull = ConvertTo-NormalizedFullPath -Path $drillParent
            if (-not (Test-DirectChildPath -Parent $backupRoot -Child $drillFull) -or
                -not ([IO.Path]::GetFileName($drillFull) -match '^\.drill-[0-9a-f]{32}$')) {
                throw "Refusing unsafe restore-drill cleanup target: $drillFull"
            }
            Remove-Item -LiteralPath $drillFull -Recurse -Force
        }
    }
}

function Read-OwnedSnapshot {
    param(
        [Parameter(Mandatory)][string]$SnapshotPath,
        [Parameter(Mandatory)][string]$RootId,
        [Parameter(Mandatory)][string]$ActiveDatabase
    )

    $snapshotFull = ConvertTo-NormalizedFullPath -Path $SnapshotPath
    if (-not (Test-DirectChildPath -Parent $backupRoot -Child $snapshotFull)) {
        throw "Snapshot is not a direct child of the owned backup root: $snapshotFull"
    }
    Assert-NormalDirectory -Path $snapshotFull -Label 'GBrain snapshot'
    $name = [IO.Path]::GetFileName($snapshotFull)
    if ($name -notmatch '^gbrain-pglite-\d{8}T\d{9}Z-[0-9a-f]{8}$') {
        throw "Snapshot name is outside the owned naming contract: $name"
    }
    $manifestPath = Join-Path $snapshotFull 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Snapshot is missing its ownership manifest: $snapshotFull"
    }
    $manifestItem = Get-Item -LiteralPath $manifestPath -Force
    if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Snapshot manifest must not be a symlink: $manifestPath"
    }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        throw "Snapshot manifest is invalid JSON: $manifestPath"
    }
    if ([int]$manifest.schema_version -ne $snapshotSchemaVersion -or
        [string]$manifest.kind -ne $snapshotKind -or
        [string]$manifest.backup_root_id -ne $RootId -or
        -not [string]::Equals(
            (ConvertTo-NormalizedFullPath -Path ([string]$manifest.source_database)),
            $ActiveDatabase,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not [bool]$manifest.verified) {
        throw "Snapshot ownership manifest does not match this profile: $manifestPath"
    }
    return [pscustomobject]@{
        name = $name
        path = $snapshotFull
        manifest = $manifest
        manifest_path = $manifestPath
        created_at = [DateTimeOffset]::Parse([string]$manifest.created_at)
    }
}

function Get-OwnedSnapshots {
    param(
        [Parameter(Mandatory)][string]$RootId,
        [Parameter(Mandatory)][string]$ActiveDatabase
    )

    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
        return @()
    }
    $snapshots = [Collections.Generic.List[object]]::new()
    foreach ($directory in Get-ChildItem -LiteralPath $backupRoot -Directory -Force |
        Where-Object { $_.Name -like 'gbrain-pglite-*' }) {
        $readParameters = @{
            SnapshotPath = $directory.FullName
            RootId = $RootId
            ActiveDatabase = $ActiveDatabase
        }
        $snapshots.Add((Read-OwnedSnapshot @readParameters))
    }
    return @($snapshots | Sort-Object created_at -Descending)
}

function Remove-OwnedSnapshot {
    param(
        [Parameter(Mandatory)]$Snapshot,
        [Parameter(Mandatory)][string]$RootId,
        [Parameter(Mandatory)][string]$ActiveDatabase
    )

    $readParameters = @{
        SnapshotPath = [string]$Snapshot.path
        RootId = $RootId
        ActiveDatabase = $ActiveDatabase
    }
    $validated = Read-OwnedSnapshot @readParameters
    if (-not (Test-DirectChildPath -Parent $backupRoot -Child $validated.path)) {
        throw "Refusing recursive deletion outside the owned backup root: $($validated.path)"
    }
    Remove-Item -LiteralPath $validated.path -Recurse -Force
    return [string]$validated.name
}

function Get-InstalledGBrainVersion {
    $packagePath = Join-Path $env:USERPROFILE '.bun\install\global\node_modules\gbrain\package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        return $null
    }
    try {
        return [string]((Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version)
    } catch {
        return $null
    }
}

function New-ResultEnvelope {
    return [ordered]@{
        success = $false
        dry_run = [bool]$DryRun
        backup_path = $null
        manifest_path = $null
        verified = $false
        restore_drill_passed = $null
        page_count = $null
        chunk_count = $null
        embedded_count = $null
        file_count = $null
        total_bytes = $null
        inventory_sha256 = $null
        retention_count = $RetentionCount
        pruned_backup_names = @()
        pruned_backup_count = 0
        error = $null
    }
}

$result = New-ResultEnvelope
$operationLock = $null
$partialSnapshot = $null
try {
    $active = Read-ActiveGBrainConfig
    $activeDatabase = [string]$active.database_path
    Assert-ActiveDatabaseQuiescent -DatabasePath $activeDatabase
    $rootMarker = Initialize-OrReadBackupRoot -ActiveDatabase $activeDatabase -Preview:$DryRun

    $timestamp = (Get-Date).ToUniversalTime()
    $snapshotName = 'gbrain-pglite-{0}-{1}' -f $timestamp.ToString('yyyyMMddTHHmmssfffZ'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $snapshotPath = Join-Path $backupRoot $snapshotName
    $manifestPath = Join-Path $snapshotPath 'manifest.json'
    $result.backup_path = $snapshotPath
    $result.manifest_path = $manifestPath

    $existingSnapshots = @(Get-OwnedSnapshots -RootId ([string]$rootMarker.root_id) -ActiveDatabase $activeDatabase)

    if ($DryRun) {
        $wouldPrune = [Math]::Max(0, $existingSnapshots.Count + 1 - $RetentionCount)
        $result.success = $true
        $result.pruned_backup_names = @(
            $existingSnapshots |
                Sort-Object created_at |
                Select-Object -First $wouldPrune |
                ForEach-Object { $_.name }
        )
        $result.pruned_backup_count = $result.pruned_backup_names.Count
        if ($Json) {
            $result | ConvertTo-Json -Depth 8 -Compress
        } else {
            Write-Output "Dry run passed. GBrain is quiescent and a snapshot would be created at: $snapshotPath"
            Write-Output "Retention would prune $wouldPrune ownership-verified snapshot(s)."
        }
        return
    }

    $operationLock = Enter-BackupOperationLock
    Assert-ActiveDatabaseQuiescent -DatabasePath $activeDatabase

    $partialSnapshot = Join-Path $backupRoot ('.partial-' + [guid]::NewGuid().ToString('N'))
    if (-not (Test-DirectChildPath -Parent $backupRoot -Child $partialSnapshot)) {
        throw "Partial snapshot escaped the backup root: $partialSnapshot"
    }
    New-Item -ItemType Directory -Path $partialSnapshot | Out-Null
    $partialDatabase = Join-Path $partialSnapshot 'brain.pglite'

    $sourceInventoryBefore = @(Get-TreeInventory -Root $activeDatabase)
    $sourceSummaryBefore = Get-InventorySummary -Inventory $sourceInventoryBefore
    Copy-SafeDirectoryTree -Source $activeDatabase -Destination $partialDatabase
    $backupInventory = @(Get-TreeInventory -Root $partialDatabase)
    $backupSummary = Get-InventorySummary -Inventory $backupInventory
    $sourceInventoryAfter = @(Get-TreeInventory -Root $activeDatabase)
    $sourceSummaryAfter = Get-InventorySummary -Inventory $sourceInventoryAfter

    Assert-ActiveDatabaseQuiescent -DatabasePath $activeDatabase
    if ($sourceSummaryBefore.inventory_sha256 -ne $sourceSummaryAfter.inventory_sha256 -or
        $sourceSummaryBefore.file_count -ne $sourceSummaryAfter.file_count -or
        $sourceSummaryBefore.total_bytes -ne $sourceSummaryAfter.total_bytes) {
        throw 'The active PGLite files changed during backup; the partial snapshot was rejected.'
    }
    if ($sourceSummaryBefore.inventory_sha256 -ne $backupSummary.inventory_sha256 -or
        $sourceSummaryBefore.file_count -ne $backupSummary.file_count -or
        $sourceSummaryBefore.total_bytes -ne $backupSummary.total_bytes) {
        throw 'The copied PGLite inventory does not match the stable active database.'
    }

    $restoreDrill = $null
    if (-not $SkipRestoreDrill) {
        $restoreDrill = Invoke-RestoreDrill -SnapshotDatabase $partialDatabase -ActiveConfig $active.config
    }
    Assert-ActiveDatabaseQuiescent -DatabasePath $activeDatabase

    $configHash = (Get-FileHash -LiteralPath $activeConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        schema_version = $snapshotSchemaVersion
        kind = $snapshotKind
        backup_root_id = [string]$rootMarker.root_id
        created_at = $timestamp.ToString('o')
        source_database = $activeDatabase
        source_config_path = $activeConfigPath
        source_config_sha256 = $configHash
        gbrain_version = Get-InstalledGBrainVersion
        verified = $true
        restore_drill_passed = if ($restoreDrill) { [bool]$restoreDrill.passed } else { $null }
        excluded_runtime_paths = @('.gbrain-resolve.sock')
        database = [ordered]@{
            relative_path = 'brain.pglite'
            file_count = [int]$backupSummary.file_count
            total_bytes = [long]$backupSummary.total_bytes
            inventory_sha256 = [string]$backupSummary.inventory_sha256
            files = $backupInventory
        }
        restore_drill = if ($restoreDrill) { $restoreDrill } else { $null }
    }
    Write-JsonAtomic -Path (Join-Path $partialSnapshot 'manifest.json') -Value $manifest -Depth 20

    if (Test-Path -LiteralPath $snapshotPath) {
        throw "Snapshot destination unexpectedly exists: $snapshotPath"
    }
    Move-Item -LiteralPath $partialSnapshot -Destination $snapshotPath
    $partialSnapshot = $null

    $finalSnapshot = Read-OwnedSnapshot -SnapshotPath $snapshotPath -RootId ([string]$rootMarker.root_id) -ActiveDatabase $activeDatabase
    $finalInventory = @(Get-TreeInventory -Root (Join-Path $snapshotPath 'brain.pglite'))
    $finalSummary = Get-InventorySummary -Inventory $finalInventory
    if ($finalSummary.inventory_sha256 -ne $backupSummary.inventory_sha256 -or
        $finalSummary.file_count -ne $backupSummary.file_count -or
        $finalSummary.total_bytes -ne $backupSummary.total_bytes) {
        throw "Final snapshot verification failed after publication: $($finalSnapshot.path)"
    }

    $ownedSnapshots = @(Get-OwnedSnapshots -RootId ([string]$rootMarker.root_id) -ActiveDatabase $activeDatabase)
    $pruneCandidates = @($ownedSnapshots | Select-Object -Skip $RetentionCount)
    $prunedNames = [Collections.Generic.List[string]]::new()
    foreach ($candidate in $pruneCandidates) {
        $removeParameters = @{
            Snapshot = $candidate
            RootId = [string]$rootMarker.root_id
            ActiveDatabase = $activeDatabase
        }
        $prunedNames.Add((Remove-OwnedSnapshot @removeParameters))
    }

    $result.success = $true
    $result.backup_path = $snapshotPath
    $result.manifest_path = Join-Path $snapshotPath 'manifest.json'
    $result.verified = $true
    $result.restore_drill_passed = if ($restoreDrill) { [bool]$restoreDrill.passed } else { $null }
    $result.page_count = if ($restoreDrill) { [int]$restoreDrill.page_count } else { $null }
    $result.chunk_count = if ($restoreDrill) { [int]$restoreDrill.chunk_count } else { $null }
    $result.embedded_count = if ($restoreDrill) { [int]$restoreDrill.embedded_count } else { $null }
    $result.file_count = [int]$finalSummary.file_count
    $result.total_bytes = [long]$finalSummary.total_bytes
    $result.inventory_sha256 = [string]$finalSummary.inventory_sha256
    $result.pruned_backup_names = @($prunedNames)
    $result.pruned_backup_count = $prunedNames.Count

    if ($Json) {
        $result | ConvertTo-Json -Depth 8 -Compress
    } else {
        Write-Output "Verified GBrain snapshot: $snapshotPath"
        Write-Output "SHA-256 inventory: $($finalSummary.inventory_sha256) ($($finalSummary.file_count) files, $($finalSummary.total_bytes) bytes)"
        if ($restoreDrill) {
            Write-Output "Isolated restore drill passed: $($restoreDrill.page_count) pages, $($restoreDrill.chunk_count) chunks, $($restoreDrill.probe_result_count) query result(s)."
        } else {
            Write-Warning 'The restore drill was explicitly skipped; file-integrity verification still passed.'
        }
        Write-Output "Retention pruned $($prunedNames.Count) ownership-verified snapshot(s)."
    }
} catch {
    $result.error = $_.Exception.Message
    if ($Json) {
        $result | ConvertTo-Json -Depth 8 -Compress
    }
    throw
} finally {
    if ($partialSnapshot -and (Test-Path -LiteralPath $partialSnapshot)) {
        $partialFull = ConvertTo-NormalizedFullPath -Path $partialSnapshot
        if ((Test-DirectChildPath -Parent $backupRoot -Child $partialFull) -and
            [IO.Path]::GetFileName($partialFull) -match '^\.partial-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $partialFull -Recurse -Force
        }
    }
    if ($operationLock) {
        $operationLock.Dispose()
        if (Test-Path -LiteralPath $operationLockPath) {
            Remove-Item -LiteralPath $operationLockPath -Force
        }
    }
}
