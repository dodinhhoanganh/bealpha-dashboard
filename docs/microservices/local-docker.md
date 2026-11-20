# Local Docker Stack

Every domain service and Dashboard already has an independent Dockerfile. The default Compose model starts PostgreSQL, Redis, migrations, APIs, workers, Dashboard, Gateway, and Nginx.

## Start

```powershell
./scripts/bootstrap-local.ps1
docker compose up -d --build
docker compose ps
```

`pull_policy: build` makes plain `docker compose up` rebuild every local service from current source before start.
`COMPOSE_PARALLEL_LIMIT=2` bounds image builds on local machines. Migration containers retry transient PostgreSQL startup races up to three times.

For automatic cached rebuild/recreate while editing source:

```powershell
./scripts/watch-local.ps1
```

Equivalent command: `docker compose up -d --build --watch`. Watch mode ignores `node_modules`, build output, and tests. Default helper limit is two parallel builds to bound CPU/RAM use. Contract changes rebuild all dependent services.

Local edge URLs:

- `https://localhost:8443`
- `http://localhost:8080` redirects to HTTPS

The bootstrap writes ignored local secrets, a self-signed TLS certificate, disabled DDEX/SFTP placeholders, and the local Compose build limit. Local Distribution runs in development mode, so this stack must not be used for real DSP delivery.

Production must use `.env.microservices`, official DDEX XSD, trusted TLS certificates, and real DSP SFTP material. Do not run `docker compose down` when unrelated containers must remain available.
