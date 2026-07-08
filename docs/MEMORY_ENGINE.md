# Memory Engine — Design & Rationale

## The Memory Model

The Vera Bot is **stateful**. Every merchant the judge sends context for must have an isolated, persistent memory that survives across multiple `/v1/context`, `/v1/tick`, and `/v1/reply` calls during the test window.

No database. Everything lives in-process, in JavaScript `Map`s.

---

## Why Maps?

Three concrete reasons Maps were chosen over plain objects `{}`:

### 1. O(1) size queries
```js
// Map: O(1)
merchantStore.size

// Plain object: O(n) — have to count keys
Object.keys(merchantObj).length
```

The judge polls `/v1/healthz` every 60 seconds. The response must include `contexts_loaded: { category, merchant, customer, trigger }` — 4 size queries on every health probe. With Maps this is O(1) regardless of how many merchants are loaded.

### 2. Prototype safety
```js
// Plain object — vulnerable to prototype pollution
const store = {};
store['__proto__'] = { isAdmin: true }; // pollutes Object.prototype

// Map — immune
const store = new Map();
store.set('__proto__', { isAdmin: true }); // harmless, just a key
```

The judge sends arbitrary `context_id` strings. A Map-based store cannot be poisoned by reserved keys.

### 3. Ordered, iterable entries
```js
// Map preserves insertion order
for (const [merchantId, memory] of merchantStore) {
  // process in the order merchants were loaded
}
```

This matters for `resolveActiveTriggers()` — the results are returned in insertion order, giving consistent ordering for the judge's comparison.

---

## Memory Store Layout

Each merchant has a `MerchantMemory` object:

```js
{
  merchantId: string,
  scope: string,              // category slug
  merchantState: string,      // current state machine state
  identity: object,           // name, city, verified, languages
  performance: object,        // views, calls, CTR, delta_7d
  metrics: {
    currentCtr: number | null,
    peerMedianCtr: number,
    currentViews: number | null,
  },
  offers: object[],           // active + paused offers
  campaigns: object[],        // active campaigns
  triggerHistory: object[],   // all triggers received for this merchant
  _triggerMap: Map | null,    // O(1) index (lazy, invalidated on push)
  customerContexts: Map,      // customer_id → CustomerContext
  conversationHistory: object[], // last N merchant↔vera turns (capped at 100)
  replyHistory: object[],     // per-strategy reply log (for cooldown checks)
  suppressionKeys: {
    lastTrigger: string | null,
    used: Set<string>,
  },
  analytics: {
    totalTicks: number,
    totalReplies: number,
    avgReplyLatencyMs: number,   // Welford rolling average
    lastTickAt: string | null,
    lastReplyAt: string | null,
  },
  timestamps: {
    createdAt: string,
    lastUpdated: string,
  },
  metadata: {
    version: number,
    source: string,
  },
}
```

---

## Version Control (Idempotency)

The challenge contract requires:
- Same `(context_id, version)` → no-op (idempotent)
- Higher `version` → replace atomically
- Lower `version` → reject with 409

`VersionManager` maintains a two-level Map: `{ contextId → { scope → currentVersion } }`.

```
versionManager.resolve(contextId, scope, incomingVersion)
  → 'UPGRADE'  if incomingVersion > current
  → 'SAME'     if incomingVersion === current
  → 'STALE'    if incomingVersion < current
```

`resolve()` is **read-only** — it only inspects, never writes. `commit()` is called separately after the memory write succeeds. This prevents partial writes: if `memoryStore.replaceContext()` throws, no version is committed.

---

## O(1) Trigger Resolution

The challenge sends `available_triggers: ["trg_001", "trg_002", ..., "trg_100"]` on each tick. The bot must find which merchant each trigger belongs to.

**Naive approach** (O(n×m)):
```js
for (const merchantId of allMerchantIds) {         // n merchants
  for (const entry of merchant.triggerHistory) {    // m triggers
    if (triggerIds.includes(entry.triggerId)) { ... } // O(m) includes!
  }
}
// Total: O(n × m × m) = O(n·m²) — terrible with 50 merchants, 100 triggers
```

**Optimised approach** (O(n + m)):
```js
const triggerSet = new Set(triggerIds);             // O(m) build
for (const merchantId of allMerchantIds) {          // O(n)
  for (const [triggerId, payload] of merchant._triggerMap) { // O(m)
    if (triggerSet.has(triggerId)) { ... }          // O(1) lookup
  }
}
// Total: O(n + m) — linear
```

The `_triggerMap` is a lazy `Map` built on first access and invalidated (set to `null`) whenever a new trigger is pushed to the merchant. This means:
- First access after a push: O(m) rebuild
- Subsequent accesses without a new push: O(1) lookup

---

## Conversation History

`conversationHistory` is capped at `MAX_CONVERSATION_MESSAGES = 100` entries. When the cap is exceeded, the oldest entries are trimmed. This prevents unbounded memory growth during long test sessions.

Each entry records: `{ speaker, body, cta, suppression_key, turnNumber, timestamp }`.

The `suppression_key` field enables the SuppressionEngine's loop-detection rule (Rule 5): if the same key appears in the last 3 Vera messages, the conversation is in a loop.

---

## Analytics (Welford's Algorithm)

Reply latency is tracked using **Welford's online algorithm** — a numerically stable running mean that requires O(1) space and O(1) time per update (vs storing all values and computing mean offline).

```js
// Per new latency value:
analytics.totalReplies += 1;
const delta = latencyMs - analytics.avgReplyLatencyMs;
analytics.avgReplyLatencyMs += delta / analytics.totalReplies;
```

This means the analytics system works correctly even after millions of replies without any memory growth.
