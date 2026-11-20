FROM node:22-alpine AS build
WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build
WORKDIR /app/services/media
COPY services/media/package.json services/media/package-lock.json ./
RUN npm ci --ignore-scripts --workspaces=false
COPY services/media/tsconfig.json services/media/tsconfig.test.json services/media/prisma.config.ts ./
COPY services/media/prisma ./prisma
COPY services/media/src ./src
RUN MEDIA_DATABASE_URL=postgresql://media:build@localhost:5432/media npm run prisma:generate && npm run build
FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]
FROM build AS prod-deps
RUN npm prune --omit=dev --omit=optional --workspaces=false && find node_modules /app/packages/contracts/node_modules -type f -name '*.map' -delete
FROM node:22-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app/services/media
RUN apk add --no-cache ffmpeg tini
COPY --from=prod-deps --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=prod-deps --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=prod-deps --chown=node:node /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=prod-deps --chown=node:node /app/services/media/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/services/media/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/services/media/dist ./dist
USER node
EXPOSE 4103
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4103/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
