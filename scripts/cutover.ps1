param(
  [switch]$Execute,
  [string]$EnvFile = ".env.microservices",
  [string]$MigrationEnvFile = ".env.migration",
  [string]$BackupDirectory = ".cutover-backups"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-WorkspacePath([string]$value) {
  $candidate = if ([IO.Path]::IsPathRooted($value)) { [IO.Path]::GetFullPath($value) } else { [IO.Path]::GetFullPath((Join-Path $root $value)) }
  if (-not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Cutover paths must stay inside workspace" }
  return $candidate
}

$envPath = Resolve-WorkspacePath $EnvFile
$migrationEnvPath = Resolve-WorkspacePath $MigrationEnvFile
$composePath = Join-Path $root "docker-compose.microservices.yml"
$backupRoot = Resolve-WorkspacePath $BackupDirectory
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "legacy-$stamp.dump"
$backup = Join-Path $backupRoot $backupName
$compose = @("compose", "--env-file", $envPath, "--env-file", $migrationEnvPath, "-f", $composePath)
$services = @("identity", "catalog", "media", "distribution", "finance", "notifications", "analytics", "audit")

function Read-Setting([string]$name) {
  $environmentValue = [Environment]::GetEnvironmentVariable($name)
  if ($environmentValue) { return $environmentValue }
  $line = Get-Content -LiteralPath $migrationEnvPath | Where-Object { $_ -match "^$([regex]::Escape($name))=(.*)$" } | Select-Object -Last 1
  if ($line -and $line -match "^[^=]+=(.*)$") { return $Matches[1].Trim() }
  return $null
}

$steps = @(
  "Confirm old application is in maintenance/read-only mode",
  "Run pg_dump in migration-backup -> $backup",
  "Run all service schema migration containers",
  "Run all data migrations in migration-runner",
  "Run migration verification in migration-runner",
  "docker compose --env-file $EnvFile --env-file $MigrationEnvFile -f docker-compose.microservices.yml --profile edge up -d",
  "Run smoke tests, then switch external DNS/load balancer to Nginx"
)

if (-not $Execute) {
  $steps | ForEach-Object { Write-Output "[dry-run] $_" }
  exit 0
}
foreach ($path in @($envPath, $migrationEnvPath, $composePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required cutover file not found: $path" }
}
if ((Read-Setting "MIGRATION_MAINTENANCE_CONFIRMED") -ne "YES") { throw "MIGRATION_MAINTENANCE_CONFIRMED=YES is required" }
if ((Read-Setting "MIGRATION_DRY_RUN") -eq "1") { throw "MIGRATION_DRY_RUN must be disabled for cutover" }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $root ".migration-output") -Force | Out-Null
$env:MIGRATION_BACKUP_HOST_ROOT = $backupRoot
& docker @compose run --rm migration-backup sh -c "pg_dump --format=custom --file=/backups/$backupName `"`$LEGACY_DATABASE_URL`""
if ($LASTEXITCODE -ne 0) { throw "Legacy backup failed" }
foreach ($service in $services) {
  & docker @compose run --rm "$service-migrate"
  if ($LASTEXITCODE -ne 0) { throw "$service migration deploy failed" }
}
foreach ($migration in $services) {
  & docker @compose run --rm migration-runner npm run "migrate:$migration"
  if ($LASTEXITCODE -ne 0) { throw "$migration data migration failed" }
}
& docker @compose run --rm migration-runner npm run migrate:verify
if ($LASTEXITCODE -ne 0) { throw "Migration verification failed; do not switch traffic" }
& docker @compose --profile edge up -d
if ($LASTEXITCODE -ne 0) { throw "Microservice startup failed" }
Write-Output "Cutover candidate started. Backup: $backup. Run smoke tests before switching traffic."
