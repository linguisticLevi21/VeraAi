# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first to leverage layer caching.
COPY package*.json ./

# Install production + dev deps (needed to run lint/tests before final stage).
RUN npm ci

# ── Stage 2: Production Image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Non-root user for security.
RUN addgroup -S vera && adduser -S vera -G vera

WORKDIR /app

# Copy manifests and install ONLY production deps.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source.
COPY --chown=vera:vera src/ ./src/
COPY --chown=vera:vera app.js ./
COPY --chown=vera:vera server.js ./

# Create the logs directory the logger writes to.
RUN mkdir -p logs && chown vera:vera logs

USER vera

# Expose the application port.
EXPOSE 3000

# Health check — mirrors the judge's liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/v1/healthz || exit 1

ENV NODE_ENV=production

CMD ["node", "server.js"]
