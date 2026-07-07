# Vera Bot — Magicpin AI Challenge

> **Production-grade AI decision engine** for the Magicpin Vera Bot Challenge.  
> Receives structured merchant context, maintains evolving in-memory state, and returns the single best deterministic merchant message.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Installation](#installation)
5. [Running Locally](#running-locally)
6. [Environment Variables](#environment-variables)
7. [API Documentation](#api-documentation)
8. [Sample cURL Commands](#sample-curl-commands)
9. [Testing](#testing)
10. [Render Deployment](#render-deployment)
11. [Docker Deployment](#docker-deployment)
12. [Design Decisions](#design-decisions)

---

## Overview

This is the backend server for the **Magicpin Vera Bot Challenge**. The bot exposes a 5-endpoint HTTP API that is consumed by Magicpin's judge harness during a 60-minute simulated test window.

The judge:
1. Pushes merchant/category/customer/trigger context via `POST /v1/context`
2. Periodically calls `POST /v1/tick` — the bot decides which merchants to proactively message
3. Sends merchant replies via `POST /v1/reply` — the bot returns the next conversation action

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Express HTTP Server                 │
│  Middleware: helmet → cors → body-parser → morgan    │
│              → requestContext → rateLimiter          │
├─────────────────────────────────────────────────────┤
│  Routes (/v1)                                        │
│  ├── GET  /healthz   → systemController              │
│  ├── GET  /metadata  → systemController              │
│  ├── POST /context   → contextController             │
│  ├── POST /tick      → tickController                │
│  └── POST /reply     → replyController               │
├─────────────────────────────────────────────────────┤
│  Services                                            │
│  ├── contextService  — stores/versions context       │
│  ├── tickService     — orchestrates DecisionEngine   │
│  └── replyService    — orchestrates ReplyEngine      │
├─────────────────────────────────────────────────────┤
│  Engine (AI layer — future)                          │
│  ├── DecisionEngine  — ranking + trigger selection   │
│  └── ReplyEngine     — intent classification         │
├─────────────────────────────────────────────────────┤
│  Memory                                              │
│  ├── ContextStore      — versioned 4-context store   │
│  └── ConversationStore — per-conversation turn state │
├─────────────────────────────────────────────────────┤
│  State                                               │
│  └── SuppressionState  — dedup sent messages         │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
.
├── server.js                   # Entry point — binds HTTP, graceful shutdown
├── app.js                      # Express app factory
├── Dockerfile                  # Multi-stage production image
├── nodemon.json                # Dev server config
├── eslint.config.js            # ESLint 9 flat config
├── .env.example                # Environment variable template
│
├── src/
│   ├── config/
│   │   ├── index.js            # Central config loader (reads .env once)
│   │   └── constants.js        # Fixed challenge-contract invariants
│   │
│   ├── controllers/
│   │   ├── systemController.js # GET /healthz, GET /metadata
│   │   ├── contextController.js# POST /context
│   │   ├── tickController.js   # POST /tick
│   │   └── replyController.js  # POST /reply
│   │
│   ├── routes/
│   │   ├── system.js           # Registers system endpoints
│   │   └── api.js              # Registers context/tick/reply endpoints
│   │
│   ├── services/
│   │   ├── contextService.js   # Business logic for context operations
│   │   ├── tickService.js      # Business logic for tick evaluation
│   │   └── replyService.js     # Business logic for reply handling
│   │
│   ├── engine/
│   │   ├── DecisionEngine.js   # Placeholder: trigger ranking + action gen
│   │   └── ReplyEngine.js      # Placeholder: multi-turn reply classification
│   │
│   ├── strategies/
│   │   └── BaseStrategy.js     # Abstract base for trigger-kind strategies
│   │
│   ├── memory/
│   │   ├── contextStore.js     # Singleton: versioned context storage
│   │   └── conversationStore.js# Singleton: per-conversation turn state
│   │
│   ├── state/
│   │   └── suppressionState.js # Singleton: dedup suppression keys
│   │
│   ├── middleware/
│   │   ├── requestContext.js   # Stamps X-Request-Id + request timing
│   │   ├── errorHandler.js     # Global 4-argument error handler
│   │   ├── notFound.js         # 404 catch-all
│   │   └── rateLimiter.js      # express-rate-limit factory
│   │
│   ├── validators/
│   │   ├── schemas.js          # Input validators for all POST endpoints
│   │   └── errors.js           # AppError hierarchy (Validation/NotFound/Conflict)
│   │
│   └── utils/
│       ├── logger.js           # Winston logger (dev pretty / prod JSON + rotate)
│       ├── ids.js              # generateRequestId / generateAckId / generateConversationId
│       └── response.js         # Centralized success() / fail() formatters
│
├── tests/
│   ├── contextStore.test.js    # ContextStore unit tests (Node assert)
│   └── validators.test.js      # Schema validator unit tests
│
└── logs/                       # Rotating log files (production only, gitignored)
```

---

## Installation

```bash
# Clone or download the project
cd your-project-directory

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
```

---

## Running Locally

```bash
# Development (auto-restart on file change)
npm run dev

# Production
npm start

# Lint
npm run lint
```

The server starts on `http://localhost:3000` by default.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port to listen on |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `LOG_DIR` | No | `logs` | Directory for rotating log files |
| `TEAM_NAME` | No | `Team Vera` | Returned by `/v1/metadata` |
| `TEAM_MEMBERS` | No | `Alice,Bob` | Comma-separated list |
| `BOT_MODEL` | No | `claude-opus-4-7` | LLM model identifier |
| `BOT_APPROACH` | No | *(see .env.example)* | Short description of composition approach |
| `CONTACT_EMAIL` | No | `team@example.com` | Team contact |
| `BOT_VERSION` | No | `1.0.0` | Bot version string |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `RATE_LIMIT_MAX` | No | `200` | Max requests per window |
| `MAX_CONTEXT_SIZE_BYTES` | No | `512000` | Body size limit for `/v1/context` |

---

## API Documentation

### `GET /v1/healthz`

Liveness probe. The judge polls this every 60 seconds; three consecutive failures disqualify the bot.

**Response `200`:**
```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "contexts_loaded": {
    "category": 5,
    "merchant": 50,
    "customer": 200,
    "trigger": 100
  }
}
```

---

### `GET /v1/metadata`

Bot identity endpoint. Called once during judge warmup.

**Response `200`:**
```json
{
  "team_name": "Team Vera",
  "team_members": ["Alice", "Bob"],
  "model": "claude-opus-4-7",
  "approach": "single-prompt composer with retrieval over digest items",
  "contact_email": "team@example.com",
  "version": "1.0.0",
  "submitted_at": "2026-04-26T08:00:00Z"
}
```

---

### `POST /v1/context`

Receive a context push. Idempotent on `(scope, context_id, version)`.

**Request body:**
```json
{
  "scope": "merchant",
  "context_id": "m_001_drmeera",
  "version": 1,
  "payload": { "merchant_id": "m_001_drmeera", "identity": { "name": "Dr. Meera's Dental Clinic" } },
  "delivered_at": "2026-04-26T10:00:00Z"
}
```

**Response `200` (accepted):**
```json
{ "accepted": true, "ack_id": "ack_m_001_drmeera_v1", "stored_at": "2026-04-26T10:00:00.123Z" }
```

**Response `409` (stale version):**
```json
{ "accepted": false, "reason": "stale_version", "current_version": 5 }
```

**Response `400` (invalid input):**
```json
{ "accepted": false, "reason": "invalid_scope", "details": [...] }
```

---

### `POST /v1/tick`

Periodic wake-up. The bot decides which proactive messages to send.

**Request body:**
```json
{
  "now": "2026-04-26T10:30:00Z",
  "available_triggers": ["trg_2026_04_26_research_digest_dentists"]
}
```

**Response `200`:**
```json
{
  "actions": [
    {
      "conversation_id": "conv_m001drmeera_trg2026_3f2504e0",
      "merchant_id": "m_001_drmeera",
      "customer_id": null,
      "send_as": "vera",
      "trigger_id": "trg_2026_04_26_research_digest_dentists",
      "template_name": "vera_research_digest_v1",
      "template_params": ["Dr. Meera", "JIDA Oct issue", "..."],
      "body": "Dr. Meera, JIDA's Oct issue landed...",
      "cta": "open_ended",
      "suppression_key": "research:dentists:2026-W17",
      "rationale": "External research digest with merchant-relevant clinical anchor"
    }
  ]
}
```

Returns `{ "actions": [] }` when nothing should be sent this tick.

---

### `POST /v1/reply`

Receive a merchant/customer reply. Must respond within 30 seconds.

**Request body:**
```json
{
  "conversation_id": "conv_001",
  "merchant_id": "m_001_drmeera",
  "customer_id": null,
  "from_role": "merchant",
  "message": "Yes, send me the abstract",
  "received_at": "2026-04-26T10:45:00Z",
  "turn_number": 2
}
```

**Response — send next message:**
```json
{
  "action": "send",
  "body": "Sending now — also drafted a 90-sec patient-ed WhatsApp...",
  "cta": "open_ended",
  "rationale": "Honoring the merchant's accept; adding the next-best-step"
}
```

**Response — wait:**
```json
{ "action": "wait", "wait_seconds": 1800, "rationale": "Merchant asked for time; back off 30 min" }
```

**Response — end:**
```json
{ "action": "end", "rationale": "Merchant said not interested; gracefully exiting" }
```

---

## Sample cURL Commands

```bash
# Health check
curl -s http://localhost:3000/v1/healthz | jq

# Metadata
curl -s http://localhost:3000/v1/metadata | jq

# Push a category context
curl -s -X POST http://localhost:3000/v1/context \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "category",
    "context_id": "dentists",
    "version": 1,
    "payload": { "slug": "dentists", "voice": { "tone": "peer_clinical" } },
    "delivered_at": "2026-04-26T10:00:00Z"
  }' | jq

# Push a merchant context
curl -s -X POST http://localhost:3000/v1/context \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "merchant",
    "context_id": "m_001_drmeera",
    "version": 1,
    "payload": { "merchant_id": "m_001_drmeera", "identity": { "name": "Dr. Meeras Dental Clinic" } },
    "delivered_at": "2026-04-26T10:00:00Z"
  }' | jq

# Trigger a tick
curl -s -X POST http://localhost:3000/v1/tick \
  -H "Content-Type: application/json" \
  -d '{
    "now": "2026-04-26T10:30:00Z",
    "available_triggers": ["trg_2026_04_26_research_digest_dentists"]
  }' | jq

# Send a reply
curl -s -X POST http://localhost:3000/v1/reply \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv_001",
    "merchant_id": "m_001_drmeera",
    "customer_id": null,
    "from_role": "merchant",
    "message": "Yes, send me the abstract",
    "received_at": "2026-04-26T10:45:00Z",
    "turn_number": 2
  }' | jq
```

---

## Testing

```bash
# Run unit tests (no test runner needed)
node tests/contextStore.test.js
node tests/validators.test.js

# Run the official Magicpin judge simulator against local server
export BOT_URL=http://localhost:3000
python judge_simulator.py
```

---

## Render Deployment

1. **Create a new Web Service** on [render.com](https://render.com)
2. Connect your GitHub repository
3. Configure the service:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
4. Add environment variables in the Render dashboard (see [Environment Variables](#environment-variables))
5. Set `NODE_ENV=production`
6. Deploy — Render will assign a public URL like `https://vera-bot.onrender.com`
7. Submit `https://vera-bot.onrender.com` as your bot URL

**Important**: Render free-tier instances sleep after 15 minutes of inactivity. For the judge test window, upgrade to a paid instance or use a keep-alive ping.

---

## Docker Deployment

```bash
# Build
docker build -t vera-bot .

# Run locally
docker run -p 3000:3000 --env-file .env vera-bot

# Push to a registry
docker tag vera-bot gcr.io/your-project/vera-bot:latest
docker push gcr.io/your-project/vera-bot:latest
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| **No database** | The judge spec explicitly allows in-memory storage. A database would add latency and infra complexity with zero benefit. |
| **Singleton stores** | `ContextStore` and `ConversationStore` are module-level singletons. This is idiomatic in single-process Node and avoids dependency injection boilerplate at this stage. |
| **Factory pattern for app.js** | Separating `createApp()` from `server.js` makes the app testable without binding a port. |
| **Engine/Service split** | Services handle orchestration and persistence; Engines contain reasoning logic. This allows the AI layer to be dropped in without touching any HTTP layer. |
| **Centralized validators** | All validation throws a typed `ValidationError` — the error handler catches it uniformly, keeping controller code clean. |
| **Graceful shutdown** | 10-second drain window prevents judge from seeing a `SIGTERM` as a connection failure mid-tick. |
# VeraAi
