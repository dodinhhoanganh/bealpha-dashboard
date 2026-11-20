param(
  [string]$EnvFile = ".env.microservices",
  [string]$MigrationEnvFile = ".env.migration",
  [string]$BaseUrl = "https://localhost",
  [string]$AccessToken = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$compose = @("compose", "--env-file", $EnvFile, "--env-file", $MigrationEnvFile, "-f", "docker-compose.microservices.yml")
$required = @("gateway", "identity", "catalog", "media", "distribution", "finance", "notifications", "analytics", "audit", "catalog-import-worker", "media-worker", "distribution-worker", "finance-worker", "notifications-worker", "audit-worker")
$report = Join-Path $root ".migration-output/migration-verification.json"

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Missing microservice environment file: $EnvFile" }
  if (-not (Test-Path -LiteralPath $MigrationEnvFile)) { throw "Missing migration environment file: $MigrationEnvFile" }
  if (-not $AccessToken) { throw "AccessToken is required for authenticated smoke tests" }
  if (-not (Test-Path -LiteralPath $report)) { throw "Missing migration verification report: $report" }

  $verification = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  if (-not $verification.passed) { throw "Migration verification report failed" }

  $rows = & docker @compose ps --format json | ForEach-Object { $_ | ConvertFrom-Json }
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect microservice stack" }
  foreach ($service in $required) {
    $row = $rows | Where-Object { $_.Service -eq $service } | Select-Object -First 1
    if (-not $row) { throw "Missing running service: $service" }
    if ($row.State -ne "running") { throw "$service state is $($row.State)" }
    if ($row.Health -and $row.Health -ne "healthy") { throw "$service health is $($row.Health)" }
  }

  $live = Invoke-RestMethod -Uri "$BaseUrl/health/live" -Method Get
  if ($live.data.status -ne "ok") { throw "Gateway live check failed" }
  $ready = Invoke-RestMethod -Uri "$BaseUrl/health/ready" -Method Get
  if ($ready.data.status -ne "ready") { throw "Gateway ready check failed" }

  $headers = @{ Authorization = "Bearer $AccessToken" }
  Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/profile" -Headers $headers -Method Get | Out-Null
  Invoke-RestMethod -Uri "$BaseUrl/api/v1/catalog/releases?limit=1" -Headers $headers -Method Get | Out-Null
  Invoke-RestMethod -Uri "$BaseUrl/api/v1/media/assets" -Headers $headers -Method Get | Out-Null
  Write-Output "Runtime verification passed."
} finally {
  Pop-Location
}
