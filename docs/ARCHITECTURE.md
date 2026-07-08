# Architecture — Design Decisions & Trade-offs

## Why This Architecture?

The core architectural question was: **how do you build a merchant AI assistant that is reliable, auditable, and fast — without an LLM?**

The answer is a **deterministic reasoning pipeline**: a fixed sequence of composable modules, each with a single responsibility, that always produce the same output for the same input.

---

## The 4-Context Framework

Every decision is made from 4 types of context, mirroring the Magicpin challenge contract:

| Context | Update Frequency | Content |
|---|---|---|
| `category` | Slow (weekly) | Voice profile, peer stats, offer catalog, seasonal beats |
| `merchant` | Daily + real-time | Performance, offers, campaigns, conversation history |
| `customer` | Real-time | Visit history, relationship, consent, preferences |
| `trigger` | Real-time events | Kind, urgency, suppression key, expiry |

**Why separate them?** They have fundamentally different update frequencies and lifetimes. Category context is shared across 10-50 merchants. Merchant context is private. Mixing them into a single object would require careful copy semantics and would create unnecessary memory pressure.

---

## Layered Memory Architecture

```
                     ContextService
                          │
                    ContextManager
                          │
               ┌──────────┼──────────┐
               │          │          │
         MerchantRepository        (Customer, Trigger)
               │
        ┌──────┤
        │      │
  MemoryStore  VersionManager + StateManager
  (Map-based)
```

**Why this many layers?**

Each layer has a different responsibility:
- `ContextService` — HTTP contract (version resolution, 409 responses)
- `ContextManager` — routes `scope` to the right handler
- `MerchantRepository` — the single point of truth for all merchant reads/writes
- `MemoryStore` — raw Map operations, no business logic
- `VersionManager` — idempotency and version conflict detection
- `StateManager` — state machine, driven by signals

**Why not a single `store.set(key, value)` flat store?**  
Because queries like "give me all merchants in DECLINING state" or "resolve these 20 trigger IDs to merchant context bundles" require structured access patterns. A flat key-value store would push query logic into every caller, violating DRY.

---

## Why JavaScript Maps?

Maps were chosen over plain objects (`{}`) for all primary stores:

| Property | `Map` | Plain Object |
|---|---|---|
| Key type | Any (string, object, etc.) | String only |
| Iteration | `Map.entries()` — ordered, predictable | `Object.keys()` — order not guaranteed |
| `size` | O(1) `.size` property | O(n) `Object.keys().length` |
| Prototype pollution | Not possible | Possible (e.g., `obj['__proto__']`) |
| Performance | Optimised for frequent add/delete | Optimised for static shape |

**The critical one**: `merchantStore.size` is O(1). The `/v1/healthz` endpoint must return `contexts_loaded` counts on every call — with plain objects this would be O(n) on every health probe.

---

## Why the Strategy Pattern?

10 strategy classes (not a giant `if-else` tree). The key properties this gives us:

1. **Open/Closed principle** — adding a new strategy (e.g., `ReviewMilestoneStrategy`) requires zero changes to existing code. Register it in `StrategySelector._strategies` and it participates.

2. **Independent testability** — each strategy's `score()` and `compose()` can be tested in isolation with a mock merchant context.

3. **Parallel development** — multiple strategies can be developed simultaneously without merge conflicts.

4. **Transparent scoring** — `StrategySelector` returns a sorted `CandidateAction[]` with scores attached. Every decision is auditable.

**The cost**: 10 files instead of 1 function. Acceptable for a production system where maintainability matters.

---

## Why No LLM?

Three reasons:

1. **Determinism** — the challenge brief explicitly states "same input must always produce same output". LLMs are probabilistic even at temperature=0 across API versions.

2. **Latency** — the judge's SLA is 30s. An LLM API call adds 1-5s of network + inference latency. Our pipeline runs in < 10ms.

3. **Auditability** — every word in the final message can be traced to a specific strategy, a specific signal, and a specific data point. No hallucination is possible.

**The hybrid path** (future work): use the deterministic engine for strategy selection, then pass the selected strategy + grounded data to an LLM for final message polish. Best of both worlds.

---

## Concurrency Model

Node.js is single-threaded. All state is safely shared across requests without locks. The trade-off: vertical scaling only (single process per instance). For the judge's load (~300 req/min), this is fine.

If horizontal scaling were needed, the memory layer would need to be externalized to Redis with atomic version increment operations.

---

## Request Lifecycle

```
HTTP Request
    │
    ├── helmet() + cors()          # Security headers
    ├── express.json()             # Body parse (limit: 512KB)
    ├── morgan()                   # HTTP access log
    ├── requestContext()           # Request ID + observability
    ├── rateLimiter()              # 300 req/min per IP
    │
    ├── Route matched
    │       │
    │       ├── validateBody()     # Schema validation (sync, throws 400)
    │       └── service.process()  # Business logic
    │               │
    │               └── engine.evaluate() # AI pipeline (< 10ms)
    │
    ├── success(res, data)         # 200 JSON response
    └── errorHandler()             # 400/409/413/429/500 responses
```
