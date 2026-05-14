# ── Upload Server Dockerfile ──────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install ffmpeg for audio/video processing
RUN apk add --no-cache ffmpeg

COPY package.json ./
RUN npm ci --production

COPY . .

# Create upload directories
RUN mkdir -p uploads/audio uploads/covers uploads/artists \
    uploads/labels uploads/avatars uploads/documents uploads/video

# Create non-root user
RUN addgroup --system --gid 1001 appuser && \
    adduser --system --uid 1001 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
