# State Machine — Merchant States & Transitions

## Overview

Every merchant has a **current state** that drives strategy priority weighting. The state machine is deterministic — transitions are computed from real signals by `StateManager.compute()` and stored in `MerchantMemory.merchantState`.

States are recomputed on every context update. They are **read-only** from outside `StateManager` — nothing mutates `merchantState` directly except `StateManager.compute()` and `MerchantRepository.ingestMerchantContext()`.

---

## State Definitions

| State | Meaning | Typical signals |
|---|---|---|
| `NEW` | First context push, no performance data yet | No prior data |
| `ACTIVE` | Healthy merchant, no concerning signals | Positive or neutral performance |
| `HIGH_PERFORMING` | CTR or views significantly above peer | CTR > 1.5× peer median |
| `LOW_PERFORMING` | Below peer benchmarks but stable | CTR < peer, no decline |
| `DECLINING` | Measurable downward trend | views_pct < -20%, CTR < 50% peer |
| `RECOVERING` | Previously declining, now improving | views_pct > 0 after prior decline |
| `CAMPAIGN_RUNNING` | Active marketing campaign in progress | `hasActiveCampaign = true` |
| `WAITING_REPLY` | Last Vera message awaiting merchant response | Last speaker = 'vera' |
| `NEEDS_ATTENTION` | Stale posts, no recent activity, dormant | stale signals, dormant flag |
| `CUSTOMER_ENGAGED` | Active customer conversations | `customerContexts.size > 0` |
| `CUSTOMER_INACTIVE` | Customers present but lapsing | `lapsedCustomers / totalCustomers > 0.3` |
| `OFFLINE` | Subscription lapsed | `subscriptionStatus = 'lapsed'` |
| `UNKNOWN` | Fallback when signals are ambiguous | Insufficient data |

---

## State Transition Diagram

```
                                  ┌─────────────┐
                                  │     NEW      │
                                  └──────┬───────┘
                                         │ context received
                                         ▼
                  ┌──────────────────── ACTIVE ──────────────────────┐
                  │                                                    │
         CTR > 1.5× peer                                        CTR < peer
                  │                                                    │
                  ▼                                                    ▼
          HIGH_PERFORMING                                      LOW_PERFORMING
                  │                                                    │
             CTR drops                                        views_pct < -20%
                  │                                                    │
                  ▼                                                    ▼
              ACTIVE ◄────────────────────────────────────────── DECLINING
                                    improving                         │
                                                                      │
                                                               lapsed_180d > 30%
                                                                      │
                                                                      ▼
                                                              CUSTOMER_INACTIVE
                                                                      │
                                                               win-back success
                                                                      │
                                                                      ▼
                                                             CUSTOMER_ENGAGED

From any state:
  ──► subscription lapsed ──► OFFLINE
  ──► active campaign   ──► CAMPAIGN_RUNNING (overlay)
  ──► Vera spoke last   ──► WAITING_REPLY (overlay)
  ──► stale_posts + dormant ──► NEEDS_ATTENTION
```

---

## How Transitions Work

`StateManager.compute(merchantId, signals)` takes a `MerchantSignals` object and returns the new state. The logic is a priority-ordered evaluation:

```
1. OFFLINE              if subscriptionStatus = 'lapsed'
2. CAMPAIGN_RUNNING     if hasActiveCampaign
3. WAITING_REPLY        if awaitingMerchantReply
4. DECLINING            if viewsDelta7d < -0.20 AND ctr < 0.5 × peerMedianCtr
5. HIGH_PERFORMING      if ctr > 1.5 × peerMedianCtr
6. RECOVERING           if viewsDelta7d > 0 AND previousState = DECLINING
7. CUSTOMER_INACTIVE    if lapsedCustomers / totalCustomers > 0.30
8. CUSTOMER_ENGAGED     if activeCustomerConversations > 0
9. LOW_PERFORMING       if ctr < peerMedianCtr
10. NEEDS_ATTENTION     if hasStaleSignals AND !hasPerformanceData
11. ACTIVE              (default for healthy merchants with data)
12. NEW                 (no performance data at all)
13. UNKNOWN             (fallback)
```

**Why priority-ordered and not a switch/case?** Because states can overlap. A merchant can be both `CAMPAIGN_RUNNING` and `DECLINING`. The priority order determines which state is reported — campaign status wins because it's more actionable.

---

## State → Strategy Priority Mapping

State influences `StrategySelector`'s scoring boosts:

| State | Boosted Strategies |
|---|---|
| `DECLINING` | `PerformanceRecoveryStrategy`, `GrowthStrategy`, `CampaignStrategy` |
| `WAITING_REPLY` | `FollowUpStrategy` (highest priority, hardcoded) |
| `CUSTOMER_INACTIVE` | `CustomerWinbackStrategy` |
| `NEEDS_ATTENTION` | `EngagementStrategy`, `ReviewStrategy` |
| `CAMPAIGN_RUNNING` | `CampaignStrategy` |
| `HIGH_PERFORMING` | `RetentionStrategy`, `FestivalStrategy` |
| `NEW` | `EngagementStrategy`, `OfferStrategy` |

---

## State Persistence

State is stored in `MerchantMemory.merchantState` and recomputed on every `/v1/context` push. This means:

- State always reflects the latest context
- No state can become stale between context updates
- State recomputation is O(1) — just evaluating a fixed priority list against pre-computed signals

The previous state is preserved in `StateManager._previousStates` Map for the `RECOVERING` transition detection (requires knowing the merchant was previously `DECLINING`).
