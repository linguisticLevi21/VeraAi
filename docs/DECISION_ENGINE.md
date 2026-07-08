# Decision Engine — How It Works

## Overview

The Decision Engine is a **8-step deterministic reasoning pipeline**. It runs on every `/v1/tick` and `/v1/reply` call. No LLM, no randomness — the same merchant context always produces the same output.

---

## Step 1 — SignalExtractor

**File**: `src/engine/SignalExtractor.js`

Extracts typed signals from merchant memory. Signals are atomic observations about a specific measurable condition.

**Signal dimensions:**
- **Performance signals**: `ctr_below_peer`, `ctr_critically_below_peer`, `views_declining`, `views_spiking`, `calls_declining`
- **Offer signals**: `offer_expiring_soon` (≤24h), `offer_expiring_3d` (≤3 days), `offer_expired`, `no_active_offer`
- **Campaign signals**: `campaign_active`, `campaign_underperforming`
- **Conversation signals**: `merchant_replied_yes`, `merchant_replied_no`, `merchant_asked_question`, `waiting_for_reply`
- **Customer signals**: `inactive_customers`, `lapsed_ratio_high` (>30%), `customer_lapsed_soft`
- **Trigger signals**: `trigger_high_urgency`, `trigger_research_digest`, `trigger_festival`, `trigger_recall_due`
- **Temporal signals**: `stale_posts`, `no_recent_activity`

**Why sort by priority?** Signals with priority 1 (critical — refusal, high urgency) override signals with priority 5 (informational). This ensures the InferenceEngine sees the most critical observations first.

---

## Step 2 — InferenceEngine

**File**: `src/engine/InferenceEngine.js`

Applies 30+ declarative rules to signals, producing structured observations.

**Design principle**: Rules are pure functions — `(signals[]) → observations[]`. No side effects, no state.

Example rules:
```
if signal "merchant_replied_no"  → observation "merchant_refused"      (priority: 1)
if signal "merchant_replied_yes" → observation "merchant_ready_to_act" (priority: 1)
if signal "offer_expiring_soon"  → observation "offer_about_to_expire" (priority: 2)
if signal "views_declining"      → observation "merchant_declining"    (priority: 3)
if signal "inactive_customers"   → observation "merchant_should_recall_customers" (priority: 3)
```

**Why observations and not just signals?** Strategies should not need to understand raw signal semantics. An observation like `merchant_declining` is a composed, intent-bearing concept that any strategy can act on — whether the underlying cause is declining views, falling CTR, or stale posts.

---

## Step 3 — ReplayGuard

**File**: `src/engine/ReplayGuard.js`

Evaluates 6 hard-exit conditions **before strategy selection begins**. If any rule fires, the pipeline short-circuits and returns an `action` directly.

| Rule | Trigger | Action |
|---|---|---|
| Merchant refused | `merchant_refused` observation | `end` + polite exit message |
| Auto-reply flood | ≥3 consecutive auto-replies | `wait` 2h |
| Single auto-reply | 1 auto-reply | `wait` 1h |
| Trigger expired | `trigger_expired` observation | `end` |
| Max turns | `>= MAX_TURNS_PER_CONVERSATION` (5) | `end` |
| Stalled conversation | >72h since last message | `end` |

**Why run this before strategy selection?** Strategy selection and ranking involve allocating candidate lists, scoring arrays, and composition. Running these rules first means we never do unnecessary work for dead conversations.

---

## Step 4 — StrategySelector

**File**: `src/engine/StrategySelector.js`

Scores all 10 strategy classes and returns a sorted `CandidateAction[]`.

**Scoring formula per strategy:**
```
baseScore = strategy.score(context)    // 0.0–1.0 from the strategy itself
observationBoost = Σ(matchingObservations) * 0.05  // up to +0.15
totalScore = min(1.0, baseScore + observationBoost)
```

**Why observation boosts?** A strategy's base score reflects the raw signal strength. The observation boost rewards strategies that are aligned with multiple confirmed observations — e.g., `FollowUpStrategy` gets a boost when both `merchant_ready_to_act` AND `merchant_declining` are present.

**The registry**: strategies are stored in a `_strategies` array. Adding a new strategy is a 1-line change. No conditionals.

---

## Step 5 — ActionRanker

**File**: `src/engine/ActionRanker.js`

Re-scores candidates using 10 orthogonal dimensions. Never picks the highest-scoring candidate from Step 4 — always re-ranks.

**Why re-rank after StrategySelector?** StrategySelector scores reflect strategy-specific signal alignment. ActionRanker adds cross-strategy concerns like `freshness` (was this strategy used recently?), `replay_safety` (was this the same strategy as last turn?), and `novelty` (has this strategy been tried at all?). These concerns are meaningless within a single strategy's scoring logic.

**10 dimensions:**

| Dimension | Weight | Rationale |
|---|---|---|
| `urgency` | 20% | Time-sensitive situations should be prioritised unconditionally |
| `merchant_fit` | 15% | Irrelevant messages damage trust faster than no message at all |
| `specificity` | 15% | The judge penalises generic copy — specific anchors score higher |
| `conversation_cont` | 12% | Continuing an active thread is better than starting a new one |
| `business_impact` | 12% | ROI for the merchant is the ultimate goal |
| `category_match` | 10% | Category-appropriate voice wins the "Category Fit" judge dimension |
| `freshness` | 8% | Prevents strategy monotony — favours less recently used strategies |
| `replay_safety` | 4% | Never same strategy as last turn unless context has changed |
| `reply_probability` | 3% | Compulsion-driven messages get higher scores |
| `novelty` | 1% | Slight tie-breaker preference for untried strategies |

---

## Step 6 — strategy.compose()

**File**: `src/strategies/*.js`

Each strategy implements `compose(context)` and returns:
```js
{
  body: string,           // raw message body (not yet filtered)
  cta: 'binary'|'open_ended'|'none',
  reason: string,         // single-sentence rationale
  suppression_key: string // unique dedup key for this strategy+context combo
}
```

**Category specialisation**: each strategy's `compose()` calls `_voice(body, scope)` which applies category-specific message adaptation — professional tone for dentists/pharmacies, warm for salons, motivational for gyms.

**Data grounding principle**: all compose() implementations access real merchant data — actual offer titles, actual CTR numbers, actual lapsed customer counts. No fabricated statistics.

---

## Step 7 — SuppressionEngine

**File**: `src/engine/SuppressionEngine.js`

Runs 6 rules against the composed message. If any fires, the message is blocked and the pipeline returns `action: wait`.

Rules are ordered by strictness — the most definitive signals (exact key collision) come first.

**Session keys**: cleared on every tick. Prevents the same message from being sent to two different merchants in the same tick batch if they share a suppression key.

---

## Step 8 — MessageComposer

**File**: `src/engine/MessageComposer.js`

Final output assembly:

1. **Anti-generic filter**: 14 blocked phrases (e.g., "hope you're doing well", "just checking in", "increase your sales"). Any composed message containing these is rejected and triggers strategy fallback.

2. **Single-CTA enforcement**: exactly one call to action per message. No double CTAs.

3. **Category voice adapter**: applies contraction expansion for professional scopes (dentists, pharmacies) — `we've` → `we have`, `that's` → `that is`.

4. **Confidence calculation**: derived from the ActionRanker's weighted total score, adjusted for suppression history.

5. **Metadata assembly**: attaches strategy, dimensions, observations, merchantScope, and composedAt for full auditability.

---

## Confidence Score

The final `confidence` field is calculated as:

```
confidence = rankedScore.total
           * (1 - 0.05 * suppressionPenalty)
           * (turnNumber <= 1 ? 1.0 : 0.95)   // slight decay on later turns
```

This means confidence is:
- Highest for the first message in a conversation with strong signals
- Slightly lower for follow-up turns (uncertainty increases)
- Penalised if suppression was close to firing (strategy is near its cooldown)

Confidence is **not** exposed to the judge in the official API response — it's included for observability and internal routing decisions.
