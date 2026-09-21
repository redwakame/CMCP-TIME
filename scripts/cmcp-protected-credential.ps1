param(
  [Parameter(Mandatory=$true)][ValidateSet('Store','Read')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$ReferencePath,
  [ValidateSet('deepseek','groq')][string]$Provider = 'deepseek',
  [string]$ProtectedDirectory,
  [string]$Workspace
)
$ErrorActionPreference = 'Stop'
$credentialBytes = $null
$credentialText = $null
$credentialStage = 'validate'
try {
  if ($Provider -ne 'deepseek') { throw 'Provider_disabled_by_project_decision' }
  if (-not $IsWindows) { throw 'Windows_current_user_DPAPI_required' }
  if (-not [IO.Path]::IsPathFullyQualified($ReferencePath)) { throw 'Absolute_reference_required' }
  $credentialPackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if (-not $Workspace -and $credentialPackageRoot -match '[\\/]node_modules[\\/]') { throw 'Installed_package_requires_explicit_workspace' }
  $credentialProjectRoot = if ($Workspace) { (Resolve-Path -LiteralPath $Workspace).Path } else { $credentialPackageRoot }
  function Assert-CredentialPath([string]$value) {
    $full = [IO.Path]::GetFullPath($value)
    $relative = [IO.Path]::GetRelativePath($credentialProjectRoot, $full)
    if ($relative -eq '.' -or $relative.StartsWith('..') -or [IO.Path]::IsPathFullyQualified($relative)) { throw 'Credential_path_outside_workspace' }
    $current = $credentialProjectRoot
    foreach ($component in ($relative -split '[\\/]')) {
      $current = Join-Path $current $component
      if ((Test-Path -LiteralPath $current) -and (((Get-Item -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Credential_redirect_forbidden' }
    }
  }
  Assert-CredentialPath $ReferencePath
  $credentialIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($Operation -eq 'Store') {
    $credentialPrivateRoot = [IO.Path]::GetFullPath((Join-Path $credentialProjectRoot '.cmcp/private'))
    if (-not $ProtectedDirectory) { $ProtectedDirectory = Join-Path $credentialPrivateRoot 'credentials' }
    if (-not [IO.Path]::IsPathFullyQualified($ProtectedDirectory)) { throw 'Absolute_protected_directory_required' }
    $ProtectedDirectory = [IO.Path]::GetFullPath($ProtectedDirectory)
    Assert-CredentialPath $ProtectedDirectory
    if (-not $ProtectedDirectory.StartsWith($credentialPrivateRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Project_private_credential_directory_required' }
    $credentialFile = Join-Path $ProtectedDirectory ($Provider + '.dpapi')
    if ((Test-Path -LiteralPath $ReferencePath) -or (Test-Path -LiteralPath $credentialFile)) { throw 'Existing_credential_requires_explicit_update' }
    $credentialText = [Console]::In.ReadToEnd().Trim()
    if ([string]::IsNullOrWhiteSpace($credentialText)) { throw 'Credential_required_on_private_stdin' }
    $credentialStage = 'directory_acl'
    $credentialDirectoryExists = Test-Path -LiteralPath $ProtectedDirectory
    [IO.Directory]::CreateDirectory($ProtectedDirectory) | Out-Null
    if (((Get-Item -LiteralPath $ProtectedDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse_credential_store_refused' }
    if ($credentialDirectoryExists) {
      $credentialAcl = Get-Acl -LiteralPath $ProtectedDirectory
      $credentialRules = @($credentialAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
      if (-not $credentialAcl.AreAccessRulesProtected -or $credentialRules.Count -ne 1 -or $credentialRules[0].IdentityReference -ne $credentialIdentity -or $credentialRules[0].AccessControlType -ne 'Allow' -or ($credentialRules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Existing_credential_acl_not_current_user_only' }
    } else {
      $credentialAcl = [Security.AccessControl.DirectorySecurity]::new()
      $credentialAcl.SetAccessRuleProtection($true, $false)
      $credentialRule = [Security.AccessControl.FileSystemAccessRule]::new($credentialIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $credentialAcl.AddAccessRule($credentialRule)
      Set-Acl -LiteralPath $ProtectedDirectory -AclObject $credentialAcl
    }
    $credentialStage = 'protect'
    $credentialBytes = [Text.Encoding]::UTF8.GetBytes($credentialText)
    $credentialProtected = [Security.Cryptography.ProtectedData]::Protect($credentialBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $credentialStage = 'write_ciphertext'
    $credentialStream = [IO.File]::Open($credentialFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $credentialStream.Write($credentialProtected); $credentialStream.Flush($true) } finally { $credentialStream.Dispose() }
    $credentialStage = 'write_reference'
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ReferencePath)) | Out-Null
    $credentialReference = [ordered]@{ version=1; provider=$Provider; protection='Windows_DPAPI_CurrentUser'; path=$credentialFile }
    $credentialReferenceJson = $credentialReference | ConvertTo-Json -Compress
    $referenceStream = [IO.File]::Open($ReferencePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $referenceStream.Write([Text.Encoding]::UTF8.GetBytes($credentialReferenceJson)); $referenceStream.Flush($true) } finally { $referenceStream.Dispose() }
    [Console]::Out.WriteLine('{"stored":true,"protection":"Windows_DPAPI_CurrentUser"}')
  } else {
    # Private pipe for the Node launcher; do not invoke Read interactively in a terminal.
    $credentialReference = Get-Content -Raw -LiteralPath $ReferencePath | ConvertFrom-Json
    if ($credentialReference.version -ne 1 -or $credentialReference.provider -ne $Provider -or $credentialReference.protection -ne 'Windows_DPAPI_CurrentUser') { throw 'Invalid_credential_reference' }
    Assert-CredentialPath $credentialReference.path
    $credentialBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialReference.path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($credentialBytes))
  }
} catch {
  [Console]::Error.WriteLine('protected_credential_operation_failed:' + $credentialStage + ':' + $_.Exception.GetType().Name)
  exit 1
} finally {
  if ($credentialBytes) { [Array]::Clear($credentialBytes, 0, $credentialBytes.Length) }
  $credentialText = $null
}
