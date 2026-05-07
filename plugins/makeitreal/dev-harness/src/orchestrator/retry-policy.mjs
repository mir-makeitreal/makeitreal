export function nextBackoffMs(attemptNumber) {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attemptNumber - 1));
}
