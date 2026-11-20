param(
  [ValidateRange(1, 8)][int]$ParallelLimit = 2
)

$ErrorActionPreference = "Stop"
$previousLimit = $env:COMPOSE_PARALLEL_LIMIT
$env:COMPOSE_PARALLEL_LIMIT = [string]$ParallelLimit

try {
  & docker compose up -d --build --watch
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose watch failed" }
} finally {
  $env:COMPOSE_PARALLEL_LIMIT = $previousLimit
}
