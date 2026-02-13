/**
 * Simple in-memory sliding-window rate limiter keyed by string (e.g. IP address).
 * Not shared across processes — suitable for single-instance deployments.
 */
export class RateLimiter {
  private attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /**
   * Check if a key is allowed to proceed. Returns true if under the limit.
   * Automatically records the attempt.
   */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.attempts.get(key);
    if (timestamps) {
      timestamps = timestamps.filter((t) => t > cutoff);
    } else {
      timestamps = [];
    }

    if (timestamps.length >= this.maxAttempts) {
      this.attempts.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.attempts.set(key, timestamps);
    return true;
  }

  /** Periodically clean up expired entries to prevent memory leaks. */
  startCleanup(intervalMs = 60_000): NodeJS.Timeout {
    return setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      for (const [key, timestamps] of this.attempts) {
        const valid = timestamps.filter((t) => t > cutoff);
        if (valid.length === 0) {
          this.attempts.delete(key);
        } else {
          this.attempts.set(key, valid);
        }
      }
    }, intervalMs);
  }
}
