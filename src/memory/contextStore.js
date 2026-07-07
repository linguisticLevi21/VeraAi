'use strict';

const logger = require('../utils/logger');

/**
 * ContextStore — in-memory store for all four context scopes.
 *
 * Implements the idempotency + version-conflict semantics required by
 * the challenge contract (§2.1):
 *
 *   - Same (scope, context_id, version)    → no-op (idempotent)
 *   - Higher version for same context_id   → atomic replace
 *   - Lower version for same context_id    → 409 stale_version
 *
 * The store is a singleton. All controllers obtain the same instance via
 * require(); no dependency injection required at this stage.
 *
 * Key format: `${scope}::${context_id}`
 *
 * Each stored entry shape:
 * {
 *   scope:      string,
 *   context_id: string,
 *   version:    number,
 *   payload:    object,
 *   stored_at:  ISO-8601 string
 * }
 */
class ContextStore {
  constructor() {
    /** @type {Map<string, { scope: string, context_id: string, version: number, payload: object, stored_at: string }>} */
    this._store = new Map();
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Attempts to store or update a context entry.
   *
   * @param {string} scope
   * @param {string} contextId
   * @param {number} version
   * @param {object} payload
   * @returns {{ accepted: boolean, reason?: string, current_version?: number, stored_at?: string }}
   */
  upsert(scope, contextId, version, payload) {
    const key = this._key(scope, contextId);
    const existing = this._store.get(key);

    if (existing) {
      if (existing.version > version) {
        logger.debug('Context upsert rejected — stale version', {
          scope,
          contextId,
          incoming: version,
          current: existing.version,
        });
        return { accepted: false, reason: 'stale_version', current_version: existing.version };
      }

      if (existing.version === version) {
        // Idempotent — same version already stored.
        logger.debug('Context upsert idempotent — same version, no-op', { scope, contextId, version });
        return { accepted: true, stored_at: existing.stored_at };
      }
    }

    const stored_at = new Date().toISOString();
    this._store.set(key, { scope, context_id: contextId, version, payload, stored_at });

    logger.debug('Context stored', { scope, contextId, version, stored_at });
    return { accepted: true, stored_at };
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the stored entry for a given (scope, contextId).
   *
   * @param {string} scope
   * @param {string} contextId
   * @returns {{ scope, context_id, version, payload, stored_at } | null}
   */
  get(scope, contextId) {
    return this._store.get(this._key(scope, contextId)) || null;
  }

  /**
   * Returns the raw payload for a given (scope, contextId), or null.
   *
   * @param {string} scope
   * @param {string} contextId
   * @returns {object | null}
   */
  getPayload(scope, contextId) {
    const entry = this.get(scope, contextId);
    return entry ? entry.payload : null;
  }

  /**
   * Returns all entries for a given scope.
   *
   * @param {string} scope
   * @returns {Array<{ scope, context_id, version, payload, stored_at }>}
   */
  getAllByScope(scope) {
    const results = [];
    for (const entry of this._store.values()) {
      if (entry.scope === scope) results.push(entry);
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Counts (used by /v1/healthz)
  // ---------------------------------------------------------------------------

  /**
   * Returns a count breakdown by scope.
   *
   * @returns {{ category: number, merchant: number, customer: number, trigger: number }}
   */
  counts() {
    const result = { category: 0, merchant: 0, customer: 0, trigger: 0 };
    for (const entry of this._store.values()) {
      if (result[entry.scope] !== undefined) {
        result[entry.scope]++;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  /**
   * Wipes all stored context.
   * Called when the judge sends POST /v1/teardown at the end of a test session.
   */
  clear() {
    const count = this._store.size;
    this._store.clear();
    logger.info('ContextStore cleared', { entriesWiped: count });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _key(scope, contextId) {
    return `${scope}::${contextId}`;
  }
}

// Singleton export — all modules share the same store instance.
module.exports = new ContextStore();
