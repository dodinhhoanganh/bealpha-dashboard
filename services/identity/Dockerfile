FROM node:22-alpine AS build

WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build

WORKDIR /app/services/identity
COPY services/identity/package.json services/identity/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY services/identity/tsconfig.json services/identity/prisma.config.ts ./
COPY services/identity/prisma ./prisma
COPY services/identity/src ./src
RUN IDENTITY_DATABASE_URL=postgresql://identity:build@localhost:5432/identity npm run prisma:generate && npm run build

FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prod-deps
RUN npm prune --omit=dev --omit=optional --workspaces=false && find node_modules /app/packages/contracts/node_modules -type f -name '*.map' -delete

FROM node:22-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
WORKDIR /app/services/identity

RUN apk add --no-cache openssl tini

COPY --from=prod-deps --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=prod-deps --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=prod-deps --chown=node:node /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=prod-deps --chown=node:node /app/services/identity/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/services/identity/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/services/identity/dist ./dist

USER node
EXPOSE 4101

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4101/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
