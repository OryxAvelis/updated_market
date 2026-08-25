[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$CredentialsPath,

  [switch]$MarkLocalDevelopmentDatabase,

  [string]$ConfirmedDatabaseName
)

$ErrorActionPreference = 'Stop'
$serverRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$values = @{}
Get-Content -LiteralPath $CredentialsPath | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $values[$matches[1]] = $matches[2]
  }
}

$required = 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_MIGRATION_USER', 'MYSQL_MIGRATION_PASSWORD', 'MYSQL_SSL_CA'
foreach ($name in $required) {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "The credentials file is missing $name."
  }
}

if ($MarkLocalDevelopmentDatabase) {
  if ([string]::IsNullOrWhiteSpace($ConfirmedDatabaseName) -or $ConfirmedDatabaseName -cne $values.MYSQL_DATABASE) {
    throw 'ConfirmedDatabaseName must exactly match MYSQL_DATABASE before a local-development attestation can be written.'
  }
  if ($values.MYSQL_HOST -notin @('127.0.0.1', 'localhost', '::1')) {
    throw 'A local-development database attestation can be written only through a loopback MySQL host.'
  }
}

$managedEnvironment = @(
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_TLS',
  'DB_TLS_CA_PATH', 'DB_TLS_SERVERNAME', 'LOCAL_DEVELOPMENT_DATABASE_CONFIRMATION'
)
$previousEnvironment = @{}
foreach ($name in $managedEnvironment) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$env:DB_HOST = $values.MYSQL_HOST
$env:DB_PORT = $values.MYSQL_PORT
$env:DB_NAME = $values.MYSQL_DATABASE
$env:DB_USER = $values.MYSQL_MIGRATION_USER
$env:DB_PASSWORD = $values.MYSQL_MIGRATION_PASSWORD
$env:DB_TLS = 'true'
$env:DB_TLS_CA_PATH = $values.MYSQL_SSL_CA
$env:DB_TLS_SERVERNAME = 'localhost'
$env:LOCAL_DEVELOPMENT_DATABASE_CONFIRMATION = if ($MarkLocalDevelopmentDatabase) { $ConfirmedDatabaseName } else { '' }

Push-Location $serverRoot
try {
  & npm run migrate
  if ($LASTEXITCODE -ne 0) { throw "Migration runner exited with code $LASTEXITCODE." }
  if ($MarkLocalDevelopmentDatabase) {
    & node scripts/mark-local-development-database.js
    if ($LASTEXITCODE -ne 0) { throw "Database attestation exited with code $LASTEXITCODE." }
  }
} finally {
  Pop-Location
  foreach ($name in $managedEnvironment) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}
