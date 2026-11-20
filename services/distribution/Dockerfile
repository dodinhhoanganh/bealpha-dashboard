FROM node:22-alpine AS build
WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build
WORKDIR /app/services/distribution
COPY services/distribution/package.json services/distribution/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY services/distribution/tsconfig.json services/distribution/tsconfig.test.json services/distribution/prisma.config.ts ./
COPY services/distribution/prisma ./prisma
COPY services/distribution/src ./src
RUN DISTRIBUTION_DATABASE_URL=postgresql://distribution:build@localhost:5432/distribution npm run prisma:generate && npm run build
FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]
FROM build AS prod-deps
RUN npm prune --omit=dev --omit=optional --workspaces=false && find node_modules /app/packages/contracts/node_modules -type f -name '*.map' -delete
FROM node:22-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app/services/distribution
RUN apk add --no-cache libxml2-utils openssh-client tini zip
RUN mkdir -p /packages && chown node:node /packages
COPY --from=prod-deps --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=prod-deps --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=prod-deps --chown=node:node /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=prod-deps --chown=node:node /app/services/distribution/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/services/distribution/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/services/distribution/dist ./dist
USER node
EXPOSE 4104
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4104/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
