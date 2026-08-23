[CmdletBinding()]
param(
  [string]$MkcertPath,
  [string]$CertificateDirectory,
  [string]$CaRoot,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsWithinDirectory {
  param(
    [Parameter(Mandatory)] [string]$Candidate,
    [Parameter(Mandatory)] [string]$Parent
  )

  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $separator = [System.IO.Path]::DirectorySeparatorChar
  return $Candidate.Equals($Parent, $comparison) -or
    $Candidate.StartsWith($Parent + $separator, $comparison)
}

function Resolve-MkcertExecutable {
  param([string]$RequestedPath)

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    if (Test-Path -LiteralPath $RequestedPath -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($RequestedPath)
    }

    $requestedCommand = Get-Command $RequestedPath -CommandType Application -ErrorAction SilentlyContinue
    if ($requestedCommand) {
      return $requestedCommand.Source
    }

    throw "mkcert was not found at the requested path: $RequestedPath"
  }

  $command = Get-Command mkcert -CommandType Application -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $userScoped = Join-Path $env:LOCALAPPDATA 'AMMarket\tools\mkcert.exe'
    if (Test-Path -LiteralPath $userScoped -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($userScoped)
    }
  }

  throw 'mkcert is required but was not found. Install it outside the repository or pass -MkcertPath to its executable.'
}

function Set-CurrentUserOnlyAcl {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [switch]$Directory
  )

  if (-not $IsWindows) {
    return
  }

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($Directory) {
    $grant = '{0}:(OI)(CI)F' -f $identity
  } else {
    $grant = '{0}:F' -f $identity
  }

  & icacls.exe $Path /inheritance:r /grant:r $grant *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict access to $Path"
  }
}

$serverRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowedCertificateRoot = [System.IO.Path]::GetFullPath((Join-Path $serverRoot 'certs'))

if ([string]::IsNullOrWhiteSpace($CertificateDirectory)) {
  $CertificateDirectory = $allowedCertificateRoot
}
$requestedCertificateRoot = [System.IO.Path]::GetFullPath($CertificateDirectory)

if (-not (Test-IsWithinDirectory -Candidate $requestedCertificateRoot -Parent $allowedCertificateRoot)) {
  throw "CertificateDirectory must resolve inside $allowedCertificateRoot"
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -and [string]::IsNullOrWhiteSpace($CaRoot)) {
  throw 'LOCALAPPDATA is unavailable. Pass -CaRoot to a user-scoped directory outside the repository.'
}
if ([string]::IsNullOrWhiteSpace($CaRoot)) {
  $CaRoot = Join-Path $env:LOCALAPPDATA 'AMMarket\mkcert-ca'
}
$resolvedCaRoot = [System.IO.Path]::GetFullPath($CaRoot)

if (Test-IsWithinDirectory -Candidate $resolvedCaRoot -Parent $serverRoot) {
  throw 'CaRoot must remain outside the repository because it contains the local CA private key.'
}

$mkcert = Resolve-MkcertExecutable -RequestedPath $MkcertPath
$versionOutput = & $mkcert -version 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'The selected mkcert executable could not be validated.'
}
$mkcertVersion = ($versionOutput | Out-String).Trim()

New-Item -ItemType Directory -Force -Path $allowedCertificateRoot | Out-Null
New-Item -ItemType Directory -Force -Path $requestedCertificateRoot | Out-Null
New-Item -ItemType Directory -Force -Path $resolvedCaRoot | Out-Null

$resolvedAllowedRoot = (Resolve-Path -LiteralPath $allowedCertificateRoot).Path
$resolvedCertificateRoot = (Resolve-Path -LiteralPath $requestedCertificateRoot).Path
if (-not (Test-IsWithinDirectory -Candidate $resolvedCertificateRoot -Parent $resolvedAllowedRoot)) {
  throw "Resolved certificate target escaped $resolvedAllowedRoot"
}

$certificatePath = Join-Path $resolvedCertificateRoot 'localhost.pem'
$privateKeyPath = Join-Path $resolvedCertificateRoot 'localhost-key.pem'
$certificateExists = Test-Path -LiteralPath $certificatePath -PathType Leaf
$keyExists = Test-Path -LiteralPath $privateKeyPath -PathType Leaf

if ($certificateExists -xor $keyExists) {
  throw 'Only one local TLS file exists. Remove the incomplete pair manually after checking the paths, then rerun the script.'
}
if ($certificateExists -and -not $Force) {
  throw 'Local TLS files already exist. Rerun with -Force only when certificate rotation is intended.'
}

if ($Force) {
  foreach ($target in @($certificatePath, $privateKeyPath)) {
    $resolvedTarget = [System.IO.Path]::GetFullPath($target)
    if (-not (Test-IsWithinDirectory -Candidate $resolvedTarget -Parent $resolvedAllowedRoot)) {
      throw "Refusing to replace a TLS file outside $resolvedAllowedRoot"
    }
    if (Test-Path -LiteralPath $resolvedTarget -PathType Leaf) {
      Remove-Item -LiteralPath $resolvedTarget -Force
    }
  }
}

Set-CurrentUserOnlyAcl -Path $resolvedCaRoot -Directory

$previousCaRoot = $env:CAROOT
try {
  $env:CAROOT = $resolvedCaRoot

  & $mkcert -install *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'mkcert could not install the local CA into the current user trust store.'
  }

  & $mkcert -cert-file $certificatePath -key-file $privateKeyPath localhost 127.0.0.1 '::1' *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'mkcert could not generate the localhost certificate pair.'
  }
} finally {
  if ($null -eq $previousCaRoot) {
    Remove-Item Env:CAROOT -ErrorAction SilentlyContinue
  } else {
    $env:CAROOT = $previousCaRoot
  }
}

foreach ($privateFile in @($privateKeyPath, (Join-Path $resolvedCaRoot 'rootCA-key.pem'))) {
  if (-not (Test-Path -LiteralPath $privateFile -PathType Leaf)) {
    throw "Expected private key was not generated: $privateFile"
  }
  Set-CurrentUserOnlyAcl -Path $privateFile
}

$caCertificatePath = Join-Path $resolvedCaRoot 'rootCA.pem'
if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $caCertificatePath -PathType Leaf)) {
  throw 'Expected certificate material was not generated.'
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPemFile(
  $certificatePath,
  $privateKeyPath
)
$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
try {
  $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
  $trusted = $chain.Build($certificate)
  $matchesLocalhost = $certificate.MatchesHostname('localhost', $false, $false)
  $matchesLoopback = $certificate.MatchesHostname('127.0.0.1', $false, $false)
  $currentlyValid = $certificate.NotBefore.ToUniversalTime() -le [DateTime]::UtcNow -and
    $certificate.NotAfter.ToUniversalTime() -gt [DateTime]::UtcNow

  if (-not $certificate.HasPrivateKey -or -not $trusted -or
      -not $matchesLocalhost -or -not $matchesLoopback -or -not $currentlyValid) {
    throw 'The generated certificate failed private-key, trust, validity, or hostname verification.'
  }

  [PSCustomObject]@{
    MkcertVersion = $mkcertVersion
    Certificate = $certificatePath
    PrivateKey = $privateKeyPath
    CaCertificate = $caCertificatePath
    TrustedByCurrentUser = $trusted
    MatchesLocalhost = $matchesLocalhost
    Matches127001 = $matchesLoopback
    NotAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('O')
  }
} finally {
  $chain.Dispose()
  $certificate.Dispose()
}
