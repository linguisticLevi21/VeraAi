'use strict';

/**
 * BaseStrategy — abstract base class for all composition strategies.
 *
 * Each trigger kind (research_digest, recall_due, perf_spike, festival_upcoming, …)
 * will have its own Strategy subclass that knows how to:
 *   - Score whether it should fire given the current merchant state
 *   - Assemble the LLM prompt for its specific composition pattern
 *   - Validate and post-process the composed output
 *
 * Strategies are invoked by the DecisionEngine through a uniform interface.
 *
 * @abstract
 */
class BaseStrategy {
  /**
   * A unique identifier for this strategy (e.g., "research_digest").
   * Must be overridden by subclasses.
   *
   * @type {string}
   */
  get name() {
    throw new Error(`Strategy must declare a name.`);
  }

  /**
   * Returns a score (0-1) representing how urgently this strategy should fire.
   * Higher score = higher priority in the ranking queue.
   *
   * @param {object} context
   * @param {object} context.merchant
   * @param {object} context.category
   * @param {object} context.trigger
   * @param {object|null} context.customer
   * @returns {number}
   */
  score(context) {
    throw new Error(`Strategy "${this.name}" must implement score().`);
  }

  /**
   * Composes and returns the message action for this strategy.
   *
   * @param {object} context
   * @param {object} context.merchant
   * @param {object} context.category
   * @param {object} context.trigger
   * @param {object|null} context.customer
   * @returns {Promise<import('../engine/DecisionEngine').ActionItem>}
   */
  async compose(context) {
    throw new Error(`Strategy "${this.name}" must implement compose().`);
  }
}

module.exports = BaseStrategy;
