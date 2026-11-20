param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $root ".env"
$templatePath = Join-Path $root ".env.example"
$localRoot = Join-Path $root ".local-dev"

if ((Test-Path -LiteralPath $envPath) -and -not $Force) {
  Write-Output ".env already exists; use -Force to replace it"
  exit 0
}

function Random-Hex([int]$bytes = 32) {
  return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes)).ToLowerInvariant()
}

function Random-Base64([int]$bytes = 32) {
  return [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes))
}

function Set-EnvValue([string]$content, [string]$name, [string]$value) {
  $pattern = "(?m)^$([regex]::Escape($name))=.*$"
  $line = "$name=$value"
  if ([regex]::IsMatch($content, $pattern)) { return [regex]::Replace($content, $pattern, $line) }
  return $content.TrimEnd() + "`n" + $line + "`n"
}

$access = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
$context = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
try {
  $values = @{}
  foreach ($name in @(
    "POSTGRES_ADMIN_PASSWORD", "IDENTITY_DB_PASSWORD", "CATALOG_DB_PASSWORD",
    "MEDIA_DB_PASSWORD", "DISTRIBUTION_DB_PASSWORD", "FINANCE_DB_PASSWORD",
    "NOTIFICATION_DB_PASSWORD", "ANALYTICS_DB_PASSWORD", "AUDIT_DB_PASSWORD", "REDIS_PASSWORD"
  )) { $values[$name] = Random-Hex }

  $values["IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_B64"] = [Convert]::ToBase64String($access.ExportPkcs8PrivateKey())
  $values["GATEWAY_ACCESS_TOKEN_PUBLIC_KEY_B64"] = [Convert]::ToBase64String($access.ExportSubjectPublicKeyInfo())
  $values["GATEWAY_INTERNAL_CONTEXT_PRIVATE_KEY_B64"] = [Convert]::ToBase64String($context.ExportPkcs8PrivateKey())
  $values["GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64"] = [Convert]::ToBase64String($context.ExportSubjectPublicKeyInfo())
  foreach ($name in @(
    "IDENTITY_OUTBOX_ENCRYPTION_KEY_B64", "CATALOG_IMPORT_GRANT_ENCRYPTION_KEY_B64",
    "DISTRIBUTION_GRANT_ENCRYPTION_KEY_B64", "DISTRIBUTION_EXPORT_SIGNING_KEY_B64",
    "NOTIFICATION_ENCRYPTION_KEY_B64"
  )) { $values[$name] = Random-Base64 }

  $values += @{
    COMPOSE_PARALLEL_LIMIT = "1"
    COMPOSE_BAKE = "false"
    EDGE_HTTP_PORT = "8080"
    EDGE_HTTPS_PORT = "8443"
    EDGE_SERVER_NAMES = "localhost 127.0.0.1"
    EDGE_CANONICAL_HOST = "localhost"
    CORS_ORIGINS = "https://localhost:8443"
    MEDIA_PUBLIC_BASE_URL = "https://localhost:8443"
    DISTRIBUTION_PUBLIC_BASE_URL = "https://localhost:8443"
    FINANCE_PUBLIC_BASE_URL = "https://localhost:8443"
    APP_URL = "https://localhost:8443"
    DISTRIBUTION_NODE_ENV = "development"
    DISTRIBUTION_ERN_XSD_PATH = ""
    DISTRIBUTION_ERN_XSD_HOST_PATH = "./.local-dev/ddex/ern.xsd"
    DISTRIBUTION_SFTP_PRIVATE_KEY_HOST_PATH = "./.local-dev/secrets/dsp_sftp_key"
    DISTRIBUTION_SFTP_KNOWN_HOSTS_HOST_PATH = "./.local-dev/secrets/dsp_known_hosts"
    DISTRIBUTION_DSP_RECIPIENTS_JSON = "{}"
    DISTRIBUTION_SFTP_TARGETS_JSON = "{}"
    SMTP_HOST = "localhost"
    SMTP_FROM = "noreply@localhost"
    LEGACY_DATABASE_URL = "postgresql://unused:unused@host.docker.internal:5432/unused"
    LEGACY_MEDIA_HOST_ROOT = "./.local-dev/legacy-media"
    MIGRATION_SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001"
    MIGRATION_MAINTENANCE_CONFIRMED = "NO"
    MIGRATION_DRY_RUN = "1"
  }

  $content = Get-Content -LiteralPath $templatePath -Raw
  foreach ($entry in $values.GetEnumerator()) { $content = Set-EnvValue $content $entry.Key $entry.Value }
  Set-Content -LiteralPath $envPath -Value $content -Encoding utf8
} finally {
  $access.Dispose()
  $context.Dispose()
}

New-Item -ItemType Directory -Force -Path (Join-Path $localRoot "ddex"), (Join-Path $localRoot "secrets"), (Join-Path $localRoot "legacy-media"), (Join-Path $root "certs") | Out-Null
Set-Content -LiteralPath (Join-Path $localRoot "ddex/ern.xsd") -Value "<!-- Local placeholder. Production requires licensed official DDEX XSD. -->" -Encoding ascii
Set-Content -LiteralPath (Join-Path $localRoot "secrets/dsp_sftp_key") -Value "disabled-local-development" -Encoding ascii
Set-Content -LiteralPath (Join-Path $localRoot "secrets/dsp_known_hosts") -Value "disabled-local-development" -Encoding ascii

$rsa = [Security.Cryptography.RSA]::Create(2048)
try {
  $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=localhost", $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddDnsName("localhost")
  $san.AddIpAddress([Net.IPAddress]::Parse("127.0.0.1"))
  $request.CertificateExtensions.Add($san.Build())
  $cert = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears(1))
  try {
    Set-Content -LiteralPath (Join-Path $root "certs/fullchain.pem") -Value $cert.ExportCertificatePem() -Encoding ascii
    Set-Content -LiteralPath (Join-Path $root "certs/privkey.pem") -Value $rsa.ExportPkcs8PrivateKeyPem() -Encoding ascii
  } finally { $cert.Dispose() }
} finally { $rsa.Dispose() }

Write-Output "Local Docker environment created. Run: docker compose up -d --build"
