# Upload Server Development Guide

`bealpha-upload-server` is the Express service that owns every byte of media on the platform: uploads, validation, preview generation, signed streaming, file moves/deletes, DDEX delivery packaging, and DSP receipt polling. The dashboard calls it directly from browser upload flows and indirectly via server-side API routes.

---

## 1. Prerequisites

- Node.js 20
- **FFmpeg** on `PATH` — required for HLS, waveform peaks, and preview generation. Without it, every media job fails.
- **Redis** at `redis://127.0.0.1:6379` (or `REDIS_URL`) — used for the BullMQ queue, rate limiting, and stream concurrency counters
- **PostgreSQL** reachable via `DATABASE_URL` for DB-backed operations
- Writable upload directory (`UPLOAD_DIR`, default `./uploads`)

### FFmpeg install hints

| OS | Command |
|---|---|
| Windows | `winget install Gyan.FFmpeg` then restart shell |
| macOS | `brew install ffmpeg` |
| Linux | `sudo apt install ffmpeg` |

Verify: `ffmpeg -version` and `ffprobe -version`.

### Minimum `.env`

```env
NODE_ENV=development
PORT=3001
BASE_URL=http://localhost:3001
DASHBOARD_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://app_backend:admin@localhost:5432/bealpha_db
REDIS_URL=redis://127.0.0.1:6379
UPLOAD_API_KEY=dev-shared-secret
UPLOAD_DIR=./uploads
TRUST_PROXY_HOPS=0
```

`UPLOAD_API_KEY` must match the dashboard's value. **In production the server refuses to start without it.**
`TRUST_PROXY_HOPS=0` when there is no reverse proxy in front of the service locally — otherwise IP-based limits use the wrong source.

---

## 2. First-time setup

```powershell
cd bealpha-upload-server
npm install
npm run dev                                  # nodemon, port 3001
```

Smoke-test:

```powershell
Invoke-WebRequest http://localhost:3001/health
```

For an environment closer to production:

```powershell
docker compose up -d postgres upload-server
docker compose logs -f upload-server
```

---

## 3. Daily commands

```powershell
npm run dev          # nodemon — auto-restart on edit
npm start            # node server.js (production-style)
node server.js       # direct, for debugging
node --check server.js   # syntax check without running
```

---

## 4. Code organization

```
bealpha-upload-server/
├── server.js            # Express app: middleware, endpoints, queue, workers (~4600 lines)
├── s3-receipt-worker.js # Standalone delivery receipt poller (optional, skipped without S3 creds)
├── lib/
│   └── safe-path.js     # Path-traversal guard — used by both this service and the dashboard
├── uploads/             # Runtime media store (NOT source — do not commit contents)
├── Dockerfile
└── package.json
```

`server.js` is intentionally monolithic right now. Inside it, sections are demarcated by `// ====...====` comment banners (`BACKGROUND JOBS`, `MIDDLEWARE`, `STREAMING`, `UPLOAD`, `DELIVERY`). Find a comparable section before adding new code rather than dropping it at the bottom.

---

## 5. Authentication model

Two layers, both required on protected endpoints:

### Server-to-server: `x-api-key`

Every write endpoint is wrapped in `requireApiKey` middleware. The caller (dashboard or a script) sends:

```
x-api-key: <UPLOAD_API_KEY>
```

The comparison is constant-time (`crypto.timingSafeEqual`). Without the key in production the process refuses to start; in dev without the key the middleware fails closed with `ERROR_UPLOAD_SERVER_NOT_CONFIGURED_UPLOAD_API_KEY`.

### Stream tokens: signed, short-lived

`/stream/sign` (auth: `x-api-key`) returns an HMAC-signed token bound to the resource path and (optionally) the client IP. Streaming endpoints verify the token with `verifyStreamToken` before serving bytes.

```
POST /stream/sign            # mint token (dashboard server only)
GET  /stream/audio/<path>?t=<token>
GET  /stream/video/<path>?t=<token>
GET  /stream/canvas/<path>?t=<token>
```

Never trust the URL path on a stream request — `verifyStreamToken` enforces path equality against the token's `.p` claim.

---

## 6. Important endpoints

All write operations require `x-api-key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe |
| POST | `/upload/audio` | Upload audio asset (enqueues `process-audio`) |
| POST | `/upload/adm` | Upload high-quality audio master |
| POST | `/upload/video` | Upload video asset (enqueues `process-video`) |
| POST | `/stream/sign` | Mint a signed stream URL |
| GET | `/stream/audio/*` | Stream audio (token required) |
| GET | `/stream/video/*` | Stream video (token required) |
| GET | `/stream/canvas/*` | Stream Spotify canvas video |
| GET | `/hls/*` | HLS playlist + segments status |
| GET | `/preview/*` | Regenerate / fetch preview snippet |
| PUT | `/upload/move` | Move stored files |
| PUT | `/upload/finalize-release` | Finalize release storage layout |
| DELETE | `/file/*` | Delete stored files |
| POST | `/upload/export/ddex` | Build a DDEX delivery package |

---

## 7. Background jobs (BullMQ)

The queue is named `media-processing`. It has two job types:

| Job | Steps |
|---|---|
| `process-audio` | Generate HLS variants → compute waveform peaks → generate preview snippet |
| `process-video` | Generate video HLS → generate video preview snippet |

Worker config:
- Concurrency `2` — two heavy media jobs in parallel per worker process
- Attempts `3` with exponential backoff (1s base)
- `removeOnComplete: true`, `removeOnFail: 100` — keeps the last 100 failures for debugging
- Output directories are validated through `safeJoinUnder` before write

The Redis client is configured **`lazyConnect: true`** and **`maxRetriesPerRequest: null`** so the HTTP server boots even when Redis is down. While Redis is unavailable, queue-backed endpoints return 503; restoring Redis recovers automatically.

To inspect the queue locally, use Bull Board or `redis-cli`:

```powershell
redis-cli LRANGE bull:media-processing:wait 0 -1
redis-cli LRANGE bull:media-processing:failed 0 -1
```

---

## 8. Media processing rules

- All paths derived from user input must go through `safeJoinUnder` / `isSafeEntryName` from `lib/safe-path.js`. **Never** call `path.join(base, userValue)` directly.
- FFmpeg is invoked via `fluent-ffmpeg`. Failures usually mean: ffmpeg missing on PATH, unsupported input, or no write permission under `UPLOAD_DIR`.
- Validate inputs before storage: codec, container, sample rate, bit depth, duration cap. Audio must be lossless on the master path; video must meet DSP specs (codec, frame rate) before delivery enqueues.
- Heavy work goes through the queue — do not call ffmpeg synchronously from an HTTP handler. The 500ms request budget will blow up under load.

---

## 9. S3 receipt worker

`s3-receipt-worker.js` is a separate process that polls DSP receipt buckets and updates delivery status in Postgres. It is **skipped** silently when AWS credentials are absent — logs `Receipt worker: skipped (no S3 credentials)`. Run it only in environments with delivery configured:

```powershell
node s3-receipt-worker.js
```

In production, run it as a sidecar / sibling container with the same `.env`.

---

## 10. Security checklist

- Do not bypass `requireApiKey`, `verifyStreamToken`, or `safeJoinUnder`. Every CVE in this service has come from skipping one of those three.
- Static `/uploads/*` access is intentionally restricted. Sensitive media must use `/stream/*` with a signed token.
- Use `crypto.timingSafeEqual` for any secret comparison; `===` leaks timing.
- Validate request body, query, file name, and path **before** using them.
- Stream tokens are short-lived by design — do not extend their lifetime without security review.
- Log subsystem-prefixed (`[upload]`, `[ffmpeg]`, `[queue]`) and **never** log the API key, stream tokens, JWTs, or PII.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 / 403` on upload | `x-api-key` missing or mismatched between dashboard and upload server |
| Browser CORS error | `CORS_ORIGIN` and `DASHBOARD_URL` must equal the dashboard origin exactly |
| `ECONNREFUSED 127.0.0.1:6379` | Redis not running — start it before queue-backed flows |
| Processing stalls indefinitely | Redis disconnected mid-job, or FFmpeg not on PATH |
| Stream returns `ERROR_TOKEN_PATH_MISMATCH` | Token signed for a different path — request a fresh `/stream/sign` |
| Server crashes on boot in production | `UPLOAD_API_KEY` missing — set it in `.env` |
| `EACCES` writing to uploads | `UPLOAD_DIR` not writable by the process user |
| Receipt worker logs "skipped" | No S3 credentials — expected in local dev |
| IP-based limits use `127.0.0.1` for everyone | Behind a proxy — bump `TRUST_PROXY_HOPS` to match the hop count |
| BullMQ MaxRetriesPerRequestError | Old Redis client config — ensure `maxRetriesPerRequest: null` is preserved |

---

## 12. Reference

- [`../CLAUDE.md`](../CLAUDE.md) — repo architecture
- [`../codestyle.md`](../codestyle.md) — formatting and naming
- [`../SPEC.md`](../SPEC.md) — security invariants
- [`../nginx.conf`](../nginx.conf) — production routing, rate limits, security headers
