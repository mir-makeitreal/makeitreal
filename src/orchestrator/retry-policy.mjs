const DEFAULT_MAX_RETRY_ATTEMPTS = 5;

/**
 * Retry attempt count is POLICY — it belongs to the board/LLM, not the engine.
 * The engine only reads the configured value; if none is supplied it falls back
 * to the default of 5.
 *
 * @param {{ maxRetryAttempts?: number } | null | undefined} config board config
 * @returns {number}
 */
export function getMaxRetryAttempts(config) {
  return config?.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS;
}

/**
 * Pure math utility: capped exponential backoff for a given attempt number.
 * This is not policy — it just computes a delay — so it stays in the engine.
 *
 * @param {number} attemptNumber
 * @returns {number} delay in milliseconds
 */
export function backoffMsForAttempt(attemptNumber) {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attemptNumber - 1));
}

// Backward-compatible aliases. Existing callers/tests import these names; the
// default constant remains the readable fallback used by getMaxRetryAttempts.
export const MAX_RETRY_ATTEMPTS = DEFAULT_MAX_RETRY_ATTEMPTS;
export const nextBackoffMs = backoffMsForAttempt;
