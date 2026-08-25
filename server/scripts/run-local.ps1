[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$CredentialsPath,

  [switch]$EnableLocalDemoLogin
)

$ErrorActionPreference = 'Stop'
$serverRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$values = @{}
Get-Content -LiteralPath $CredentialsPath | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $values[$matches[1]] = $matches[2]
  }
}

$required = 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_SSL_CA'
foreach ($name in $required) {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "The credentials file is missing $name."
  }
}

$managedEnvironment = @(
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_TLS',
  'DB_TLS_CA_PATH', 'DB_TLS_SERVERNAME', 'TLS_CERT_PATH', 'TLS_KEY_PATH',
  'APP_ORIGIN', 'ALLOWED_ORIGINS', 'NODE_ENV', 'HOST', 'TRUST_PROXY',
  'TLS_TERMINATED_BY_PROXY', 'LOCAL_DEV_LOGIN', 'LOCAL_DEV_LOGIN_USER_EMAIL'
)
$previousEnvironment = @{}
foreach ($name in $managedEnvironment) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$env:DB_HOST = $values.MYSQL_HOST
$env:DB_PORT = $values.MYSQL_PORT
$env:DB_NAME = $values.MYSQL_DATABASE
$env:DB_USER = $values.MYSQL_USER
$env:DB_PASSWORD = $values.MYSQL_PASSWORD
$env:DB_TLS = 'true'
$env:DB_TLS_CA_PATH = $values.MYSQL_SSL_CA
$env:DB_TLS_SERVERNAME = 'localhost'
$env:TLS_CERT_PATH = Join-Path $serverRoot 'certs\localhost.pem'
$env:TLS_KEY_PATH = Join-Path $serverRoot 'certs\localhost-key.pem'
$env:APP_ORIGIN = 'https://localhost:3443'
$env:ALLOWED_ORIGINS = 'https://localhost:3443'
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:TRUST_PROXY = '0'
$env:TLS_TERMINATED_BY_PROXY = 'false'
$env:LOCAL_DEV_LOGIN = if ($EnableLocalDemoLogin) { 'true' } else { 'false' }
$env:LOCAL_DEV_LOGIN_USER_EMAIL = if ($EnableLocalDemoLogin) { 'demo@local.am-market.test' } else { '' }

Push-Location $serverRoot
try {
  if ($EnableLocalDemoLogin) {
    & node scripts/provision-local-demo-user.js
    if ($LASTEXITCODE -ne 0) { throw "Demo account provisioning exited with code $LASTEXITCODE." }
  }
  & npm start
  if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
  foreach ($name in $managedEnvironment) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}
