# Deployment Guide

## Supported Platforms

| Platform | Config File | Estimated Setup Time |
|---|---|---|
| **Render** | `render.yaml` | 5 minutes |
| **Railway** | `railway.json` | 5 minutes |
| **Docker** | `Dockerfile` + `docker-compose.yml` | 2 minutes |
| **Bare Node.js** | `.env` | 1 minute |

---

## Render (Recommended for Magicpin Judge)

Render is recommended because:
- Singapore region (lowest latency to Indian judge infrastructure)
- Auto-SSL HTTPS (required by judge)
- Free tier available
- Zero-config deploy from GitHub

### Steps

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — review the settings
5. Set the following secrets in the Render dashboard (Environment tab):
   ```
   TEAM_NAME=Your Team Name
   TEAM_MEMBERS=Name1,Name2
   CONTACT_EMAIL=your@email.com
   BOT_SUBMITTED_AT=2026-07-08T00:00:00Z
   ```
6. Click "Create Web Service" → deploy starts

**Critical setting**: `LOG_DIR=/tmp/logs` — Render has an ephemeral filesystem. The `render.yaml` already sets this.

**Health check**: Render pings `/v1/healthz` every 30s. Three failures = restart.

**Your public URL**: `https://vera-bot.onrender.com/v1/healthz`

---

## Railway

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Create project and deploy
railway init
railway up

# 4. Set environment variables in Railway dashboard
# TEAM_NAME, TEAM_MEMBERS, CONTACT_EMAIL, BOT_SUBMITTED_AT
```

Railway auto-detects `railway.json`. Uses Nixpacks builder — no Dockerfile needed.

---

## Docker

### Production

```bash
# Build and start
docker compose up vera-bot

# Run in background
docker compose up -d vera-bot

# View logs
docker compose logs -f vera-bot

# Stop
docker compose down
```

The production service uses the multi-stage `Dockerfile`:
- **Stage 1 (builder)**: installs all deps including dev
- **Stage 2 (production)**: copies only source + prod deps, runs as non-root `vera` user

### Development (hot-reload)

```bash
docker compose --profile dev up vera-dev
```

Source files are mounted as a volume — changes reload automatically via `nodemon`.

---

## Bare Node.js

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — set TEAM_NAME, TEAM_MEMBERS, CONTACT_EMAIL

# Start production
NODE_ENV=production npm start

# Start development (hot-reload)
npm run dev
```

---

## Environment Variables Reference

| Variable | Required | Production Value |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `PORT` | Yes (set by platform) | Platform-assigned |
| `TEAM_NAME` | Yes | Your team name |
| `TEAM_MEMBERS` | Yes | Comma-separated names |
| `BOT_MODEL` | No | `vera-deterministic-engine-v1` |
| `BOT_VERSION` | No | `1.0.0` |
| `CONTACT_EMAIL` | Yes | Your email |
| `BOT_SUBMITTED_AT` | No | Submission timestamp |
| `LOG_LEVEL` | No | `info` |
| `LOG_DIR` | No | `/tmp/logs` (on Render) |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` |
| `RATE_LIMIT_MAX` | No | `300` |
| `MAX_CONTEXT_SIZE_BYTES` | No | `524288` |

---

## Health Check Verification

After deployment, verify the judge can reach your bot:

```bash
# Health check
curl https://your-url.onrender.com/v1/healthz

# Expected response:
# { "status": "ok", "uptime_seconds": 42, "contexts_loaded": { "category": 0, "merchant": 0, "customer": 0, "trigger": 0 } }

# Metadata check
curl https://your-url.onrender.com/v1/metadata

# Expected: your team_name, model, approach, version
```

---

## Pre-Submission Checklist

- [ ] `/v1/healthz` returns 200 with correct shape
- [ ] `/v1/metadata` returns your real team name and email
- [ ] `BOT_SUBMITTED_AT` is set to your actual submission timestamp
- [ ] `LOG_DIR` is set correctly for your platform
- [ ] All 5 endpoints respond within 30 seconds
- [ ] `npm test` passes 102/102 locally
- [ ] Docker build succeeds: `docker build -t vera-bot .`

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| 503 on Render | Free tier spin-up | Upgrade to Starter, or send a warm-up request |
| `contexts_loaded` shows 0 | Judge hasn't pushed context yet | Normal during warmup phase |
| Rate limit hitting | Judge sending too fast | Raise `RATE_LIMIT_MAX` to 500 |
| LOG errors about LOG_DIR | Wrong log directory for platform | Set `LOG_DIR=/tmp/logs` on Render |
| `MODULE_NOT_FOUND` | Missing `node_modules` | Run `npm install` or rebuild Docker image |
