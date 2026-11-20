# BeAlpha

Music distribution platform. The dashboard calls the Fastify gateway; domain services own their data. Media uploads use signed media-service URLs.

| Branch | Contents |
| --- | --- |
| `main` | Integrated workspace: services, shared contracts, dashboard, landing site and deployment configuration |
| `dashboard` | Next.js UI only, at the repository root |
| `landing` | Static marketing site |
| `server` | Legacy upload server for rollback reference only |

Clone the default branch for platform development. Create short-lived feature branches from the branch you intend to update. Component branches and copies on main do not sync automatically; integrate component changes into the matching directory before releasing.

## Local development

Copy the relevant environment template to its local counterpart (for example, `.env.microservices.example` to `.env.microservices`) and supply local credentials. Commit templates only.

At the platform root, install dependencies with `npm ci`, then use `npm run typecheck` and `npm test`. For UI development, see [Dashboard](bealpha-dashboard/README.md). See [API](docs/API.md) and [SPEC.md](SPEC.md) for contracts and architecture.
