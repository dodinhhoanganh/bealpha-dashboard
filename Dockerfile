# ── Stage 1: Dependencies ─────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Native compatibility layer required by sharp.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Stage 2: Build ────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set production environment for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build -- --webpack

# ── Stage 3: Production ──────────────────────────────────
FROM node:20-alpine AS runner
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN apk upgrade --no-cache
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built artifacts
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["node", "server.js"]
