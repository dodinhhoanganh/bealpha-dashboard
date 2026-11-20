param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backupCandidate = if ([IO.Path]::IsPathRooted($BackupFile)) { $BackupFile } else { Join-Path $root $BackupFile }
$backup = (Resolve-Path -LiteralPath $backupCandidate).Path
if (-not $backup.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Rollback backup must be inside workspace" }
if (-not $Execute) {
  Write-Output "[dry-run] Remove new edge from external traffic."
  Write-Output "[dry-run] Restore $backup into a separate recovery database."
  Write-Output "[dry-run] Verify recovery database, then point legacy app to it."
  Write-Output "[dry-run] This script never runs docker down or stops unrelated containers."
  exit 0
}
if ($env:ROLLBACK_CONFIRMED -ne "YES") { throw "ROLLBACK_CONFIRMED=YES is required" }
if (-not $env:ROLLBACK_DATABASE_URL) { throw "ROLLBACK_DATABASE_URL is required and must target a separate empty recovery database" }
$rollbackUri = [Uri]$env:ROLLBACK_DATABASE_URL
if ($rollbackUri.Scheme -notin @("postgres", "postgresql")) { throw "ROLLBACK_DATABASE_URL must be a PostgreSQL URL" }
if ($env:LEGACY_DATABASE_URL -and $rollbackUri.AbsoluteUri -eq ([Uri]$env:LEGACY_DATABASE_URL).AbsoluteUri) { throw "ROLLBACK_DATABASE_URL must not target the legacy database" }
$tableCount = & psql $env:ROLLBACK_DATABASE_URL --set ON_ERROR_STOP=1 --tuples-only --no-align --quiet --command "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';"
if ($LASTEXITCODE -ne 0) { throw "Recovery database preflight failed" }
if ([int64]$tableCount.Trim() -ne 0) { throw "ROLLBACK_DATABASE_URL must target an empty recovery database" }
& pg_restore --exit-on-error --no-owner --dbname=$env:ROLLBACK_DATABASE_URL $backup
if ($LASTEXITCODE -ne 0) { throw "Restore failed" }
Write-Output "Recovery database restored. Verify it before changing traffic or legacy configuration."
