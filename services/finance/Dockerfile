FROM node:22-alpine AS build
WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build
WORKDIR /app/services/finance
COPY services/finance/package.json services/finance/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY services/finance/tsconfig.json services/finance/tsconfig.test.json services/finance/prisma.config.ts ./
COPY services/finance/prisma ./prisma
COPY services/finance/src ./src
RUN FINANCE_DATABASE_URL=postgresql://finance:build@localhost:5432/finance npm run prisma:generate && npm run build
FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]
FROM build AS prod-deps
RUN npm prune --omit=dev --omit=optional --workspaces=false && find node_modules /app/packages/contracts/node_modules -type f -name '*.map' -delete
FROM node:22-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app/services/finance
RUN apk add --no-cache tini && mkdir -p /data && chown node:node /data
COPY --from=prod-deps --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=prod-deps --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=prod-deps --chown=node:node /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=prod-deps --chown=node:node /app/services/finance/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/services/finance/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/services/finance/dist ./dist
USER node
EXPOSE 4105
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4105/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
