'use strict';

/**
 * SuppressionState — tracks which suppression keys have already been used.
 *
 * Prevents the bot from sending the same message twice to the same merchant
 * in the same session window. The judge penalizes repeated sends (-2 per repeat).
 *
 * Suppression keys are defined per trigger in the challenge dataset, e.g.:
 *   "research:dentists:2026-W17"
 *   "recall:c_001_priya:2026-W17"
 */
class SuppressionState {
  constructor() {
    /** @type {Set<string>} */
    this._used = new Set();
  }

  /**
   * Returns true if the suppression key has already been used.
   *
   * @param {string} key
   * @returns {boolean}
   */
  isSuppressed(key) {
    return this._used.has(key);
  }

  /**
   * Marks a suppression key as used.
   *
   * @param {string} key
   */
  suppress(key) {
    this._used.add(key);
  }

  /**
   * Removes a suppression key (used during teardown or testing).
   *
   * @param {string} key
   */
  release(key) {
    this._used.delete(key);
  }

  /**
   * Clears all suppression state.
   */
  clear() {
    this._used.clear();
  }

  /**
   * Returns the number of currently-suppressed keys.
   *
   * @returns {number}
   */
  get size() {
    return this._used.size;
  }
}

// Singleton export
module.exports = new SuppressionState();
