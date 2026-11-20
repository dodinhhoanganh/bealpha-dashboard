# BeAlpha Upload Server

**Legacy rollback reference (branch: `server`).** Do not deploy after cutover. New upload and streaming work belongs in `services/media` on `main`.

Express service for uploads, media processing, signed streaming, file operations, and delivery support.

For local setup and development workflow, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Quick Start

```powershell
npm install
npm run dev
```

The service defaults to `http://localhost:3001`. Configure `.env` before testing dashboard upload flows.
