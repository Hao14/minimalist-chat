[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
    [Parameter(ParameterSetName = 'Install')]
    [ValidateSet('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')]
    [string]$DayOfWeek = 'Sunday',
    [Parameter(ParameterSetName = 'Install')]
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$At = '03:00',
    [Parameter(ParameterSetName = 'Install')]
    [switch]$DryRun,
    [Parameter(Mandatory, ParameterSetName = 'Uninstall')]
    [switch]$Uninstall,
    [Parameter(Mandatory, ParameterSetName = 'Verify')]
    [switch]$Verify,
    [string]$TaskName = 'Minimalist Chat GBrain Maintenance'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runner = (Resolve-Path (Join-Path $PSScriptRoot 'Run-GBrainScheduledMaintenance.ps1')).Path
$maintenanceRoot = Join-Path $env:USERPROFILE '.gbrain\maintenance'
$schedulePath = Join-Path $maintenanceRoot 'minimalist-chat-schedule.json'
$taskDescription = 'Runs the guarded Minimalist Chat GBrain backup, refresh, evaluation, and graph maintenance workflow.'
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$workingDirectory = Split-Path -Parent $runner

function Get-NativeWindowsPowerShellPath {
    $systemRoot = [Environment]::ExpandEnvironmentVariables('%SystemRoot%')
    $persistedPath = Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $probePath = $persistedPath
    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
        # Sysnative bypasses WOW64 redirection for the existence probe only.
        # Task Scheduler is native 64-bit and must persist the System32 spelling.
        $probePath = Join-Path $systemRoot 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
    }
    if (-not (Test-Path -LiteralPath $probePath -PathType Leaf)) {
        throw "Native Windows PowerShell was not found: $probePath"
    }
    return [IO.Path]::GetFullPath($persistedPath)
}

function Get-NormalizedExecutablePath {
    param([Parameter(Mandatory)][string]$Value)
    try {
        return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Value))
    } catch {
        return $null
    }
}

$powershellExecutable = Get-NativeWindowsPowerShellPath

function Get-GBrainScheduleRecord {
    if (-not (Test-Path -LiteralPath $schedulePath -PathType Leaf)) {
        return $null
    }
    try {
        $record = Get-Content -LiteralPath $schedulePath -Raw | ConvertFrom-Json
        if ($record.schema_version -ne 1 -or $record.task_name -ne $TaskName) {
            return $null
        }
        return $record
    } catch {
        return $null
    }
}

function Get-AccountSid {
    param([Parameter(Mandatory)][string]$Account)
    try {
        $name = [Security.Principal.NTAccount]::new($Account)
        return $name.Translate([Security.Principal.SecurityIdentifier]).Value
    } catch {
        return $null
    }
}

function Test-OwnedGBrainTask {
    param(
        [Parameter(Mandatory)]$Task,
        [Parameter(Mandatory)][string]$ExpectedDay,
        [Parameter(Mandatory)][string]$ExpectedAt,
        [Parameter(Mandatory)][string]$ExpectedUserSid,
        [switch]$AllowLegacyExecutable
    )

    $actions = @($Task.Actions)
    $triggers = @($Task.Triggers)
    if ($actions.Count -ne 1 -or $triggers.Count -ne 1) {
        return $false
    }
    $executeRaw = [string]$actions[0].Execute
    $executePath = Get-NormalizedExecutablePath -Value $executeRaw
    $executeMatches = $null -ne $executePath -and $executePath -eq $powershellExecutable
    if ($AllowLegacyExecutable -and $executeRaw -eq 'powershell.exe') {
        $executeMatches = $true
    }
    $dayMasks = @{
        Sunday = 1; Monday = 2; Tuesday = 4; Wednesday = 8
        Thursday = 16; Friday = 32; Saturday = 64
    }
    try {
        $triggerAt = ([DateTime]$triggers[0].StartBoundary).ToString('HH:mm')
        $executionLimit = [Xml.XmlConvert]::ToTimeSpan([string]$Task.Settings.ExecutionTimeLimit)
        $taskUserSid = Get-AccountSid -Account ([string]$Task.Principal.UserId)
    } catch {
        return $false
    }
    return $Task.Description -eq $taskDescription -and
        $executeMatches -and
        [string]$actions[0].Arguments -eq $arguments -and
        [string]$actions[0].WorkingDirectory -eq $workingDirectory -and
        $taskUserSid -eq $ExpectedUserSid -and
        [string]$Task.Principal.LogonType -eq 'Interactive' -and
        [string]$Task.Principal.RunLevel -eq 'Limited' -and
        [int]$triggers[0].DaysOfWeek -eq [int]$dayMasks[$ExpectedDay] -and
        [int]$triggers[0].WeeksInterval -eq 1 -and
        $triggerAt -eq $ExpectedAt -and
        [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' -and
        $executionLimit -eq (New-TimeSpan -Hours 3) -and
        [bool]$Task.Settings.StartWhenAvailable -and
        -not [bool]$Task.Settings.WakeToRun -and
        -not [bool]$Task.Settings.DisallowStartIfOnBatteries -and
        -not [bool]$Task.Settings.StopIfGoingOnBatteries
}

function Get-ExpectedOwnedContract {
    param([Parameter(Mandatory)]$Record)
    $hasUserSid = $Record.PSObject.Properties.Name -contains 'user_sid'
    $userSid = if ($hasUserSid -and [string]$Record.user_sid) {
        [string]$Record.user_sid
    } else {
        Get-AccountSid -Account ([string]$Record.user)
    }
    if (-not $Record.installed -or
        $Record.day_of_week -notin @('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') -or
        [string]$Record.at -notmatch '^([01]\d|2[0-3]):[0-5]\d$' -or
        -not [string]$Record.user -or
        $userSid -notmatch '^S-\d(?:-\d+)+$') {
        return $null
    }
    return [pscustomobject]@{
        Day = [string]$Record.day_of_week
        At = [string]$Record.at
        User = [string]$Record.user
        UserSid = $userSid
    }
}

if ($Verify) {
    $record = Get-GBrainScheduleRecord
    $expected = if ($record) { Get-ExpectedOwnedContract -Record $record } else { $null }
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $liveVerified = $null -ne $task -and $null -ne $expected -and (Test-OwnedGBrainTask -Task $task -ExpectedDay $expected.Day -ExpectedAt $expected.At -ExpectedUserSid $expected.UserSid)
    $recordInstalled = $null -ne $record -and [bool]$record.installed
    [ordered]@{
        schema_version = 1
        task_name = $TaskName
        installed = [bool]($recordInstalled -and $task)
        live_verified = [bool]$liveVerified
        day_of_week = if ($expected) { $expected.Day } else { $null }
        at = if ($expected) { $expected.At } else { $null }
        user = if ($expected) { $expected.User } else { $null }
        next_run_time = if ($task) { (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime.ToUniversalTime().ToString('o') } else { $null }
        checked_at = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json -Depth 5
    return
}

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        $record = Get-GBrainScheduleRecord
        $expected = if ($record) { Get-ExpectedOwnedContract -Record $record } else { $null }
        if (-not $expected -or -not (Test-OwnedGBrainTask -Task $existing -ExpectedDay $expected.Day -ExpectedAt $expected.At -ExpectedUserSid $expected.UserSid)) {
            throw "Refusing to remove an unowned scheduled task named '$TaskName'."
        }
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    New-Item -ItemType Directory -Path $maintenanceRoot -Force | Out-Null
    [ordered]@{
        schema_version = 1
        task_name = $TaskName
        installed = $false
        updated_at = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $schedulePath -Encoding utf8
    Write-Output "Removed scheduled task: $TaskName"
    return
}

$startTime = [DateTime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$preview = [ordered]@{
    schema_version = 1
    action = 'install_gbrain_maintenance_task'
    task_name = $TaskName
    user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    user_sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    day_of_week = $DayOfWeek
    at = $At
    executable = $powershellExecutable
    arguments = $arguments
    logon_type = 'Interactive'
    run_level = 'Limited'
    multiple_instances = 'IgnoreNew'
    execution_time_limit = 'PT3H'
    start_when_available = $true
    wake_to_run = $false
}
if ($DryRun) {
    $preview | ConvertTo-Json -Depth 5
    return
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    $existingRecord = Get-GBrainScheduleRecord
    $existingExpected = if ($existingRecord) { Get-ExpectedOwnedContract -Record $existingRecord } else { $null }
    $existingOwned = if ($existingExpected) {
        Test-OwnedGBrainTask -Task $existing -ExpectedDay $existingExpected.Day -ExpectedAt $existingExpected.At -ExpectedUserSid $existingExpected.UserSid -AllowLegacyExecutable
    } else {
        Test-OwnedGBrainTask -Task $existing -ExpectedDay $DayOfWeek -ExpectedAt $At -ExpectedUserSid $preview.user_sid -AllowLegacyExecutable
    }
    if (-not $existingOwned) {
        throw "Refusing to replace an unowned scheduled task named '$TaskName'."
    }
}

$action = New-ScheduledTaskAction -Execute $powershellExecutable -Argument $arguments -WorkingDirectory $workingDirectory
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $DayOfWeek -At $startTime
$principal = New-ScheduledTaskPrincipal -UserId $preview.user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable:$true -WakeToRun:$false -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $taskDescription -Force | Out-Null
$registeredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not (Test-OwnedGBrainTask -Task $registeredTask -ExpectedDay $DayOfWeek -ExpectedAt $At -ExpectedUserSid $preview.user_sid)) {
    throw "Scheduled task registration did not match the owned GBrain action contract: $TaskName"
}

New-Item -ItemType Directory -Path $maintenanceRoot -Force | Out-Null
$record = [ordered]@{
    schema_version = 1
    task_name = $TaskName
    installed = $true
    day_of_week = $DayOfWeek
    at = $At
    user = $preview.user
    user_sid = $preview.user_sid
    executable = $powershellExecutable
    arguments = $arguments
    working_directory = $workingDirectory
    description = $taskDescription
    logon_type = 'Interactive'
    run_level = 'Limited'
    multiple_instances = 'IgnoreNew'
    execution_time_limit = 'PT3H'
    start_when_available = $true
    wake_to_run = $false
    live_verified = $true
    updated_at = [DateTime]::UtcNow.ToString('o')
}
$temporaryPath = "$schedulePath.tmp-$PID"
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
Move-Item -LiteralPath $temporaryPath -Destination $schedulePath -Force
$record | ConvertTo-Json -Depth 5
