# Vera Bot — Magicpin AI Merchant Assistant

> **Production-grade, deterministic AI decision engine** for the Magicpin Merchant AI Challenge.
> Talks to merchants over WhatsApp. No LLM. Same input always produces same output.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-102%20passing-brightgreen)](#testing)
[![Response Time](https://img.shields.io/badge/response%20time-%3C100ms-blue)](#performance)
[![Deploy](https://img.shields.io/badge/deploy-Render%20%7C%20Railway%20%7C%20Docker-purple)](#deployment)

---

## What Is This?

This is **Vera** — an AI merchant assistant that engages ~10,000 merchants/day over WhatsApp. Vera:

- Receives merchant context (performance data, offers, campaigns, customers)
- Evaluates incoming triggers (festival events, performance drops, research digests)
- Returns the single best proactive message for each merchant
- Handles multi-turn conversations (YES/NO replies, follow-ups, graceful exits)

**The core design principle**: every decision is deterministic. No randomness, no hallucination, no LLM calls. The same merchant context + trigger always produces the same output.

---

## Architecture Overview

```
                         ┌─────────────────────────────────────────┐
                         │           Vera Bot (this repo)           │
                         │                                          │
  Judge Harness  ──────► │  POST /v1/context   (context push)       │
  (simulated           │  POST /v1/tick      (wake-up, initiate)   │
   merchant)   ◄──────  │  POST /v1/reply     (conversation turn)   │
                         │  GET  /v1/healthz   (liveness probe)      │
                         │  GET  /v1/metadata  (bot identity)        │
                         └─────────────────────────────────────────┘
```

**Memory Layer** → all state stored in-memory using JavaScript `Map`s. No database.

**AI Pipeline** → 8 deterministic steps, no LLM:

```
MerchantMemory
    │
    ▼
SignalExtractor   ──  30+ typed signals (ctr_below_peer, offer_expiring_soon, merchant_replied_yes…)
    │
    ▼
InferenceEngine   ──  30+ declarative rules → observations (merchant_ready_to_act, recall_due…)
    │
    ▼
ReplayGuard       ──  Hard exit checks (refusal, auto-reply threshold, expired trigger, max turns)
    │
    ▼
StrategySelector  ──  Scores 10 strategies + observation-alignment boosts
    │
    ▼
ActionRanker      ──  10-dimension weighted scorer (urgency 20%, merchant_fit 15%, specificity 15%…)
    │
    ▼
strategy.compose()──  Winning strategy generates grounded, specific message
    │
    ▼
SuppressionEngine ──  6-rule dedup (session key, memory key, strategy cooldown, CTA repeat, loop, body)
    │
    ▼
MessageComposer   ──  Anti-generic filter, single-CTA enforcement, category voice adaptation
    │
    ▼
FinalAction       ──  { message, strategy, cta, confidence, merchant_state, metadata }
```

---

## Project Structure

```
vera-bot/
├── src/
│   ├── engine/
│   │   ├── SignalExtractor.js       # 30+ typed signals from merchant memory
│   │   ├── InferenceEngine.js       # Signals → structured observations
│   │   ├── ReplayGuard.js           # Hard exit logic (6 rules)
│   │   ├── StrategySelector.js      # Scores all 10 strategies
│   │   ├── ActionRanker.js          # 10-dimension weighted ranker
│   │   ├── SuppressionEngine.js     # 6-rule dedup engine
│   │   ├── MessageComposer.js       # Anti-generic filter + voice adapter
│   │   ├── DecisionEngine.js        # Tick pipeline orchestrator
│   │   └── ReplyEngine.js           # Reply pipeline orchestrator
│   │
│   ├── strategies/
│   │   ├── BaseStrategy.js          # Interface contract (score + compose)
│   │   ├── CampaignStrategy.js      # Active/underperforming campaigns
│   │   ├── CustomerWinbackStrategy.js # Lapsed customer recall
│   │   ├── EngagementStrategy.js    # Research digests, peer benchmarks
│   │   ├── FestivalStrategy.js      # Festival/seasonal triggers
│   │   ├── FollowUpStrategy.js      # Post-YES delivery + question answers
│   │   ├── GrowthStrategy.js        # CTR below peer, no campaign
│   │   ├── OfferStrategy.js         # Offer expiry/absence
│   │   ├── PerformanceRecoveryStrategy.js # Declining views/CTR
│   │   ├── RetentionStrategy.js     # Stalled conversation follow-up
│   │   └── ReviewStrategy.js        # Rating drop/review spike
│   │
│   ├── knowledge/
│   │   ├── index.js                 # getKnowledge(scope) accessor
│   │   ├── restaurants.js           # Weekend/lunch/delivery/rating hooks
│   │   ├── dentists.js              # Appointments/preventive care/trust
│   │   ├── salons.js                # Festivals/beauty/repeat visits
│   │   ├── gyms.js                  # Renewals/fitness plans/motivation
│   │   └── pharmacies.js            # Availability/prescriptions/delivery
│   │
│   ├── memory/
│   │   ├── MemoryStore.js           # Core Map-based merchant store
│   │   ├── MerchantRepository.js    # Unified read/write gateway
│   │   ├── ContextManager.js        # Context ingestion coordinator
│   │   ├── ConversationManager.js   # Turn recording + auto-reply detection
│   │   ├── ConversationStore.js     # Per-conversation state
│   │   ├── StateManager.js          # Merchant state machine
│   │   ├── VersionManager.js        # Idempotent version control
│   │   ├── TickManager.js           # Tick recording + analytics
│   │   └── AnalyticsManager.js      # Welford rolling-average latency
│   │
│   ├── services/
│   │   ├── contextService.js        # POST /v1/context business logic
│   │   ├── tickService.js           # POST /v1/tick business logic
│   │   └── replyService.js          # POST /v1/reply business logic
│   │
│   ├── controllers/                 # HTTP handlers (thin, delegate to services)
│   ├── routes/                      # Express route definitions
│   ├── middleware/
│   │   ├── requestContext.js        # Request ID + observability logging
│   │   ├── rateLimiter.js           # Judge-compatible rate limiting
│   │   ├── errorHandler.js          # Global error handler
│   │   └── notFound.js              # 404 handler
│   ├── config/
│   │   ├── index.js                 # Environment variable loader
│   │   └── constants.js             # Fixed challenge invariants
│   ├── validators/                  # Schema validators for all endpoints
│   └── utils/                       # Logger, response helpers, IDs
│
├── tests/
│   ├── contextStore.test.js         # Context versioning + idempotency
│   ├── validators.test.js           # Schema validation coverage
│   ├── merchantMemory.test.js       # Memory operations (41 tests)
│   └── decisionEngine.test.js       # Full AI pipeline (46 tests)
│
├── docs/
│   ├── ARCHITECTURE.md              # Why this design, key trade-offs
│   ├── DECISION_ENGINE.md           # Pipeline walkthrough, scoring dims
│   ├── MEMORY_ENGINE.md             # Memory model, Maps rationale
│   ├── STATE_MACHINE.md             # State transitions, determinism
│   └── DEPLOYMENT.md                # Render/Railway/Docker guide
│
├── Dockerfile                       # Multi-stage production image
├── docker-compose.yml               # Production + dev services
├── render.yaml                      # Render.com deployment config
├── railway.json                     # Railway deployment config
└── .env.example                     # All required environment variables
```

---

## Decision Pipeline

Every `/v1/tick` and `/v1/reply` call runs through the same 8-step pipeline:

| Step | Module | What it does |
|------|--------|--------------|
| 1 | `MerchantRepository` | Assembles the 4-context bundle (merchant + category + trigger + customer) |
| 2 | `SignalExtractor` | Extracts 30+ typed signals sorted by priority (1=critical, 5=informational) |
| 3 | `InferenceEngine` | Applies 30+ declarative rules → structured observations |
| 4 | `ReplayGuard` | Checks 6 hard-exit rules before any composition happens |
| 5 | `StrategySelector` | Scores all 10 strategies; adds observation-alignment boosts up to +0.15 |
| 6 | `ActionRanker` | 10-dimension weighted scoring; never picks first — always evaluates all |
| 7 | `strategy.compose()` | Winning strategy generates a grounded, specific message from real data |
| 8 | `SuppressionEngine` → `MessageComposer` | Dedup check, anti-generic filter, voice adaptation, final assembly |

---

## Memory Model

4 types of context, stored in separate `Map`s inside `MemoryStore`:

| Context Type | Store Key | Example |
|---|---|---|
| `category` | slug (`dentists`) | Offer catalog, peer stats, voice profile, seasonal beats |
| `merchant` | merchant_id | Performance metrics, offers, campaigns, conversation history |
| `customer` | customer_id | Last visit, relationship, consent, preferences |
| `trigger` | trigger_id | Kind, urgency, suppression_key, expires_at |

**Version control**: every context update is gated by `VersionManager`. A higher version replaces; same version is a no-op (idempotent); lower version is rejected with 409.

**O(1) lookup**: triggers are indexed in a lazy `Map` on each merchant object. `resolveActiveTriggers()` uses a `Set` for O(1) trigger ID checks instead of `Array.includes`.

---

## State Machine

Merchants progress through deterministic states based on real signals:

```
NEW ──► ACTIVE ──► HIGH_PERFORMING
                ├─► LOW_PERFORMING ──► DECLINING ──► NEEDS_ATTENTION
                ├─► RECOVERING
                ├─► CAMPAIGN_RUNNING
                ├─► WAITING_REPLY
                ├─► CUSTOMER_ENGAGED
                ├─► CUSTOMER_INACTIVE
                └─► OFFLINE
```

State drives strategy scoring — a `DECLINING` merchant gets higher scores for `PerformanceRecoveryStrategy` and `GrowthStrategy`.

---

## Strategy Engine

10 strategies, each independently scoring and composing:

| Strategy | Primary Signal | Score Range |
|---|---|---|
| `FollowUpStrategy` | Merchant affirmed / asked question | 0.88–0.95 |
| `CustomerWinbackStrategy` | Lapsed customer ratio > 30% | 0.65–0.92 |
| `CampaignStrategy` | Active/underperforming campaign | 0–0.85 |
| `ReviewStrategy` | Rating drop / review spike | 0–0.90 |
| `PerformanceRecoveryStrategy` | Views declining > 20% | 0–0.92 |
| `EngagementStrategy` | Research digest / peer benchmark | 0–0.85 |
| `OfferStrategy` | Offer expiring (≤3d) / absent | 0–0.90 |
| `GrowthStrategy` | CTR below peer, no campaign | 0–0.90 |
| `FestivalStrategy` | Festival trigger / seasonal month | 0–0.88 |
| `RetentionStrategy` | No reply in > 24h | 0–0.85 |

ActionRanker scoring dimensions (total = 1.0):

| Dimension | Weight | Purpose |
|---|---|---|
| `urgency` | 20% | Time-sensitivity of the underlying signal |
| `merchant_fit` | 15% | How relevant to this specific merchant's data |
| `specificity` | 15% | How grounded in real, verifiable facts |
| `conversation_cont` | 12% | Maintains conversation continuity |
| `business_impact` | 12% | Expected revenue/visibility improvement |
| `category_match` | 10% | Suits the merchant's category voice |
| `freshness` | 8% | Not recently used (hours since last use) |
| `replay_safety` | 4% | Not the same strategy as last turn |
| `reply_probability` | 3% | Likelihood of merchant replying |
| `novelty` | 1% | Slight preference for untried strategies |

---

## Replay Protection

6 suppression rules, evaluated in order before any message is sent:

1. **Session key collision** — same suppression key already used in this tick
2. **Memory key match** — same key as last sent message in merchant memory
3. **Strategy cooldown** — same strategy used < 6 hours ago
4. **CTA repetition** — same CTA type in last 2 consecutive Vera turns
5. **Loop detection** — same suppression key in last 3 Vera messages
6. **Body dedup** — identical message body in last 2 Vera messages

ReplayGuard (runs before strategy selection):

1. Merchant refused → `action: end` (graceful exit message)
2. Auto-reply threshold (≥3 consecutive) → `action: wait` (2h backoff)
3. Single auto-reply → `action: wait` (1h backoff)
4. Trigger expired → `action: end`
5. Max turns (default: 5) reached → `action: end`
6. Conversation stalled > 72h → `action: end`

---

## API Documentation

### `POST /v1/context`
Receive a context push from the judge.

**Request:**
```json
{
  "scope": "merchant",
  "context_id": "m_001_drmeera",
  "version": 3,
  "payload": { "merchant_id": "m_001_drmeera", "category_slug": "dentists", ... },
  "delivered_at": "2026-04-26T10:00:00Z"
}
```

**Response 200:** `{ "accepted": true, "ack_id": "ack_m_001_drmeera_v3", "stored_at": "..." }`  
**Response 409:** `{ "accepted": false, "reason": "stale_version", "current_version": 5 }`  
**Response 400:** `{ "accepted": false, "reason": "invalid_scope", "details": "..." }`

---

### `POST /v1/tick`
Periodic wake-up. Bot decides what to send proactively.

**Request:** `{ "now": "2026-04-26T10:30:00Z", "available_triggers": ["trg_001", "trg_002"] }`

**Response 200:** `{ "actions": [ { "conversation_id": "conv_001", "body": "...", "cta": "binary", ... } ] }`

---

### `POST /v1/reply`
Receive a merchant reply. Bot responds synchronously within 30s.

**Request:** `{ "conversation_id": "conv_001", "from_role": "merchant", "message": "Yes", "turn_number": 2 }`

**Response 200:** `{ "action": "send"|"wait"|"end", "body": "...", "cta": "...", "rationale": "..." }`

---

### `GET /v1/healthz`
Liveness probe. Polled every 60s by the judge.

**Response 200:** `{ "status": "ok", "uptime_seconds": 3600, "contexts_loaded": { "category": 5, "merchant": 50, "customer": 200, "trigger": 100 } }`

---

### `GET /v1/metadata`
Bot identity.

**Response 200:** `{ "team_name": "...", "model": "vera-deterministic-engine-v1", "approach": "...", "version": "1.0.0" }`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` disables dev logs |
| `PORT` | `3000` | HTTP port (Render sets this automatically) |
| `TEAM_NAME` | `Team Vera` | Returned by `/v1/metadata` |
| `TEAM_MEMBERS` | `Your Name` | Comma-separated list |
| `BOT_MODEL` | `vera-deterministic-engine-v1` | Engine identifier |
| `BOT_VERSION` | `1.0.0` | Submission version |
| `CONTACT_EMAIL` | `team@example.com` | Contact for the judge |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_DIR` | `logs` | Log file directory (use `/tmp/logs` on Render) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `RATE_LIMIT_MAX` | `300` | Max requests per window |
| `MAX_CONTEXT_SIZE_BYTES` | `524288` | Max context payload size (512KB) |

---

## Testing

```bash
# Run all 102 tests
npm test

# Run individual suites
npm run test:context    # Context versioning + idempotency
npm run test:validators # Schema validation
npm run test:memory     # Memory operations (41 tests)
npm run test:engine     # Full AI pipeline (46 tests)
```

Test coverage spans:
- Context versioning (idempotent updates, stale rejection, upgrade path)
- Signal extraction (30+ signal types)
- Inference rules (30+ observation types)
- Strategy selection (all 10 strategies)
- Action ranking (10-dimension weighted scoring)
- Suppression (6 rules)
- ReplayGuard (6 exit conditions)
- MessageComposer (anti-generic filter, CTA enforcement, voice)
- End-to-end per category (restaurant, dentist, gym, salon, pharmacy)

---

## Deployment

### Docker (recommended for local judge simulator)

```bash
# Build and run production image
docker compose up vera-bot

# Development with hot-reload
docker compose --profile dev up vera-dev
```

### Render (one-click deploy)

1. Connect your GitHub repo to Render
2. Render auto-detects `render.yaml`
3. Set secrets in Render dashboard: `TEAM_NAME`, `TEAM_MEMBERS`, `CONTACT_EMAIL`
4. Deploy — health check at `/v1/healthz`

> **Important**: Set `LOG_DIR=/tmp/logs` on Render (ephemeral filesystem).

### Railway

```bash
railway login
railway up
```

Railway auto-detects `railway.json`. Set environment variables in the Railway dashboard.

### Manual (Node.js)

```bash
npm install
cp .env.example .env   # Edit with your values
npm start              # Production
npm run dev            # Development (hot-reload)
```

---

## Performance

| Endpoint | p50 | p95 | p99 |
|---|---|---|---|
| `GET /v1/healthz` | < 1ms | 2ms | 5ms |
| `POST /v1/context` | 3ms | 8ms | 15ms |
| `POST /v1/tick` | 6ms | 12ms | 25ms |
| `POST /v1/reply` | 5ms | 10ms | 20ms |

All well within the judge's 30-second SLA.

Key performance decisions:
- **O(1) trigger lookup** via lazy `Map` index per merchant (vs O(n) `Array.find`)
- **Set-based trigger resolution** (vs `Array.includes` — O(1) vs O(n))
- **Singleton strategies** — no re-instantiation per request
- **Lazy category knowledge loading** — cached after first access
- **No async I/O** in the hot path — pure in-memory computation

---

## Trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **No LLM** | Deterministic, fast, no API cost, no hallucination | Lower linguistic creativity vs GPT-4 |
| **In-memory storage** | Zero latency, no network hop | State lost on restart (acceptable for judge) |
| **10 strategy classes** | Modular, testable, extensible | More code vs a monolithic if-else tree |
| **Weighted ranker** | Explains every decision, auditable | Weights require tuning per domain |
| **Maps over objects** | O(1) lookup, iterable, no prototype pollution | Slightly more verbose API |
| **Singleton exports** | Zero allocation per request | Not thread-safe (Node.js is single-threaded — fine) |

---

## Future Improvements

1. **Persistent memory** — Redis or SQLite for state survival across restarts
2. **A/B ranking** — test weight configurations against judge score to auto-tune ranker
3. **Hindi-English code-mix** — full transliteration support for Hinglish merchant messages
4. **Customer-facing pipeline** — full `send_as: merchant_on_behalf` path for customer messages
5. **LLM hybrid** — use deterministic engine for strategy selection + LLM for final message polish
6. **Real-time dashboard** — merchant state heatmap + decision trace visualisation
