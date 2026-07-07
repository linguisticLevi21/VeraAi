'use strict';

/**
 * VersionManager — per-merchant context version tracking.
 *
 * Maintains an independent version counter for each context scope
 * (category, merchant, customer, trigger) associated with each merchantId.
 * This is separate from the global ContextStore version tracking so that
 * merchant-specific history can be queried independently.
 *
 * Rules (per challenge contract §2.1):
 *   version < current  → STALE   (reject)
 *   version == current → SAME    (idempotent, no-op)
 *   version > current  → UPGRADE (accept, replace atomically)
 */
class VersionManager {
  constructor() {
    /**
     * Map<merchantId, Map<scope, { version: number, updatedAt: string }>>
     * @type {Map<string, Map<string, { version: number, updatedAt: string }>>}
     */
    this._versions = new Map();
  }

  // ---------------------------------------------------------------------------
  // Core version resolution
  // ---------------------------------------------------------------------------

  /**
   * Evaluates whether an incoming version should be accepted.
   *
   * @param {string} merchantId
   * @param {string} scope
   * @param {number} incomingVersion
   * @returns {'UPGRADE' | 'SAME' | 'STALE'}
   */
  resolve(merchantId, scope, incomingVersion) {
    const current = this._getCurrent(merchantId, scope);
    if (current === null) return 'UPGRADE';
    if (incomingVersion > current) return 'UPGRADE';
    if (incomingVersion === current) return 'SAME';
    return 'STALE';
  }

  /**
   * Commits a version upgrade for a given merchant + scope.
   * Must only be called after resolve() returns 'UPGRADE'.
   *
   * @param {string} merchantId
   * @param {string} scope
   * @param {number} version
   */
  commit(merchantId, scope, version) {
    if (!this._versions.has(merchantId)) {
      this._versions.set(merchantId, new Map());
    }
    this._versions.get(merchantId).set(scope, {
      version,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Returns the current committed version for a merchant + scope.
   *
   * @param {string} merchantId
   * @param {string} scope
   * @returns {number | null}
   */
  getCurrentVersion(merchantId, scope) {
    return this._getCurrent(merchantId, scope);
  }

  /**
   * Returns the full version map for a merchant (all scopes).
   *
   * @param {string} merchantId
   * @returns {Record<string, { version: number, updatedAt: string }>}
   */
  getScopeVersions(merchantId) {
    const scopeMap = this._versions.get(merchantId);
    if (!scopeMap) return {};
    const result = {};
    for (const [scope, entry] of scopeMap.entries()) {
      result[scope] = { ...entry };
    }
    return result;
  }

  /**
   * Removes all version tracking for a merchant.
   *
   * @param {string} merchantId
   */
  deleteMerchant(merchantId) {
    this._versions.delete(merchantId);
  }

  /**
   * Wipes all version state.
   */
  clear() {
    this._versions.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _getCurrent(merchantId, scope) {
    const scopeMap = this._versions.get(merchantId);
    if (!scopeMap) return null;
    const entry = scopeMap.get(scope);
    return entry ? entry.version : null;
  }
}

module.exports = new VersionManager();
