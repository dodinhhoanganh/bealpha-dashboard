# Dashboard Quick Start

## Prerequisites

- Node.js 20.11+
- API Gateway reachable from the browser

## Run

```powershell
cd bealpha-dashboard
npm install
$env:NEXT_PUBLIC_API_BASE_URL='http://localhost:8080'
npm run dev
```

Open `http://localhost:3000`.

For same-origin deployment behind Nginx, leave `NEXT_PUBLIC_API_BASE_URL` empty so requests use `/api/v1` on the current origin.

## Validate

```powershell
npm run lint -- --quiet
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run build
```

## Backend Changes

Dashboard is UI-only. Database migrations, API handlers, workers, and Docker images live in `../services/`. Platform environment and cutover instructions live in `../.env.microservices.example` and `../docs/microservices/cutover-runbook.md`.
