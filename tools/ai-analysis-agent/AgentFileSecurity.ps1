#Requires -Version 5.1

Set-StrictMode -Version Latest

function Initialize-MinimalistAgentDirectory {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$LiteralPath
  )

  $fullPath = [IO.Path]::GetFullPath($LiteralPath)
  $parentPath = Split-Path -Parent $fullPath
  if (!(Test-Path -LiteralPath $parentPath -PathType Container)) {
    throw "The protected agent directory parent does not exist: $parentPath"
  }
  $parentItem = Get-Item -LiteralPath $parentPath -Force
  if (($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to create a protected agent directory through a reparse point: $parentPath"
  }

  if (Test-Path -LiteralPath $fullPath) {
    $existing = Get-Item -LiteralPath $fullPath -Force
    if (!$existing.PSIsContainer -or
        ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "The protected agent directory is not a normal directory: $fullPath"
    }
  }
  else {
    New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
  }

  Protect-MinimalistAgentPath -LiteralPath $fullPath
  return (Resolve-Path -LiteralPath $fullPath).Path
}

function Protect-MinimalistAgentPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$LiteralPath,

    [switch]$Recurse
  )

  $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).Path
  $rootItem = Get-Item -LiteralPath $resolvedPath -Force -ErrorAction Stop
  if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to secure a reparse point: $resolvedPath"
  }

  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $currentUser = $currentIdentity.User
  if ($null -eq $currentUser) {
    throw "The current Windows user SID could not be resolved."
  }

  $approvedSids = @(
    $currentUser,
    [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null),
    [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
  )
  $approvedSidValues = @($approvedSids | ForEach-Object Value)

  $targets = @($rootItem)
  if ($Recurse -and $rootItem.PSIsContainer) {
    $descendants = @(Get-ChildItem -LiteralPath $resolvedPath -Force -Recurse -ErrorAction Stop)
    $reparsePoint = $descendants |
      Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 } |
      Select-Object -First 1
    if ($null -ne $reparsePoint) {
      throw "Refusing to secure a tree that contains a reparse point: $($reparsePoint.FullName)"
    }
    $targets += $descendants
  }

  foreach ($target in $targets) {
    # Build a fresh DACL instead of mutating the descriptor returned by
    # Get-Acl. Some published .NET artifacts carry SACL control metadata;
    # passing that descriptor back to Set-Acl makes a standard user require
    # SeSecurityPrivilege even though this helper only intends to change the
    # owner and DACL.
    $acl = if ($target.PSIsContainer) {
      [Security.AccessControl.DirectorySecurity]::new()
    }
    else {
      [Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($currentUser)

    $inheritance = if ($target.PSIsContainer) {
      [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
      [Security.AccessControl.InheritanceFlags]::None
    }

    foreach ($sid in $approvedSids) {
      $accessRule = [Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
      [void]$acl.AddAccessRule($accessRule)
    }
    # Set-Acl can attempt to persist untouched SACL metadata and fail with
    # SeSecurityPrivilege on otherwise user-owned release directories. These
    # framework calls persist only the owner/DACL sections modified above.
    if ($target.PSIsContainer) {
      [IO.Directory]::SetAccessControl($target.FullName, $acl)
    }
    else {
      [IO.File]::SetAccessControl($target.FullName, $acl)
    }
  }

  foreach ($target in $targets) {
    $savedAcl = Get-Acl -LiteralPath $target.FullName -ErrorAction Stop
    $savedOwner = $savedAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $savedRules = @($savedAcl.Access)
    $savedSidValues = @($savedRules | ForEach-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    })

    if (!$savedAcl.AreAccessRulesProtected -or
        $savedOwner -cne $currentUser.Value -or
        $savedRules.Count -ne $approvedSidValues.Count -or
        @($savedRules | Where-Object {
          $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
          $_.IsInherited -or
          ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
            [Security.AccessControl.FileSystemRights]::FullControl
        }).Count -ne 0 -or
        @(Compare-Object -ReferenceObject $approvedSidValues -DifferenceObject $savedSidValues).Count -ne 0) {
      throw "The protected ACL failed verification: $($target.FullName)"
    }
  }
}
