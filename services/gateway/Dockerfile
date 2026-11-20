FROM node:22-alpine AS build

WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build

WORKDIR /app/services/gateway
COPY services/gateway/package.json services/gateway/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY services/gateway/tsconfig.json ./
COPY services/gateway/src ./src
RUN npm run build && npm prune --omit=dev --workspaces=false && find node_modules /app/packages/contracts/node_modules -type f -name '*.map' -delete

FROM node:22-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
WORKDIR /app/services/gateway

RUN apk add --no-cache tini

COPY --from=build --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=build --chown=node:node /app/services/gateway/package.json ./package.json
COPY --from=build --chown=node:node /app/services/gateway/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/gateway/dist ./dist

USER node
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
