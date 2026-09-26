/**
 * Configuration options controlling throughput and concurrency thresholds.
 */
export interface RateLimiterConfig {
  /** Maximum allowable invocations per 60-second period */
  maxRequestsPerMinute: number;
  /** Maximum allowable token consumption per 60-second period */
  maxTokensPerMinute: number;
  /** Maximum number of simultaneous operations running concurrently */
  maxConcurrent: number;
}

export const DEFAULT_RATE_LIMITS: RateLimiterConfig = {
  maxRequestsPerMinute: 50,
  maxTokensPerMinute: 100000,
  maxConcurrent: 5
};

interface RequestLog {
  timestamp: number;
  tokens: number;
}

const WINDOW_DURATION_MS = 60000;
const pause = (duration: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, duration));

/**
 * Coordinates API requests across a moving 60-second time window
 * while enforcing concurrency constraints.
 */
export class RateLimiter {
  private readonly limits: RateLimiterConfig;
  private logs: RequestLog[] = [];
  private inFlightCount = 0;
  private pendingQueue: Array<() => void> = [];

  constructor(customConfig: Partial<RateLimiterConfig> = {}) {
    this.limits = { ...DEFAULT_RATE_LIMITS, ...customConfig };
  }

  /**
   * Blocks execution until capacity allows a new request to proceed.
   */
  async acquire(estimatedTokens: number = 1000): Promise<void> {
    await this.reserveConcurrencySlot();
    await this.throttleUntilCapacity(estimatedTokens);

    this.inFlightCount += 1;
    this.logs.push({ timestamp: Date.now(), tokens: estimatedTokens });
  }

  /**
   * Concludes an in-flight operation and unblocks awaiting tasks.
   */
  release(actualTokens?: number): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);

    if (actualTokens !== undefined && this.logs.length > 0) {
      const mostRecent = this.logs[this.logs.length - 1];
      if (mostRecent) {
        mostRecent.tokens = actualTokens;
      }
    }

    const nextTask = this.pendingQueue.shift();
    if (nextTask) {
      nextTask();
    }
  }

  /**
   * Retrieves usage metrics and remaining headroom in the active window.
   */
  getStatus(): {
    activeRequests: number;
    requestsInWindow: number;
    tokensInWindow: number;
    availableRequests: number;
    availableTokens: number;
  } {
    this.cleanExpiredLogs();

    const requestsInWindow = this.logs.length;
    const tokensInWindow = this.logs.reduce((accum, log) => accum + log.tokens, 0);

    return {
      activeRequests: this.inFlightCount,
      requestsInWindow,
      tokensInWindow,
      availableRequests: Math.max(0, this.limits.maxRequestsPerMinute - requestsInWindow),
      availableTokens: Math.max(0, this.limits.maxTokensPerMinute - tokensInWindow)
    };
  }

  /**
   * Checks whether immediate dispatch is permitted without delaying.
   */
  canProceed(estimatedTokens: number = 1000): boolean {
    this.cleanExpiredLogs();

    if (this.inFlightCount >= this.limits.maxConcurrent) {
      return false;
    }

    if (this.logs.length >= this.limits.maxRequestsPerMinute) {
      return false;
    }

    const currentTokenLoad = this.logs.reduce((accum, log) => accum + log.tokens, 0);
    if (currentTokenLoad + estimatedTokens > this.limits.maxTokensPerMinute) {
      return false;
    }

    return true;
  }

  private async reserveConcurrencySlot(): Promise<void> {
    if (this.inFlightCount < this.limits.maxConcurrent) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.pendingQueue.push(resolve);
    });
  }

  private async throttleUntilCapacity(estimatedTokens: number): Promise<void> {
    while (!this.canProceed(estimatedTokens)) {
      this.cleanExpiredLogs();

      const earliestEntry = this.logs[0];
      if (!earliestEntry) {
        break;
      }

      const expiryThreshold = earliestEntry.timestamp + WINDOW_DURATION_MS;
      const calculatedDelay = Math.max(100, expiryThreshold - Date.now() + 100);
      const sleepDuration = Math.min(calculatedDelay, 5000);

      await pause(sleepDuration);
    }
  }

  private cleanExpiredLogs(): void {
    const windowStart = Date.now() - WINDOW_DURATION_MS;
    this.logs = this.logs.filter((entry) => entry.timestamp > windowStart);
  }
}

/**
 * Wraps an asynchronous routine with lifecycle-managed rate-limit guards.
 */
export async function withRateLimit<T>(
  rateLimiter: RateLimiter,
  fn: () => Promise<T>,
  estimatedTokens: number = 1000
): Promise<T> {
  await rateLimiter.acquire(estimatedTokens);
  try {
    return await fn();
  } finally {
    rateLimiter.release();
  }
}

export const globalRateLimiter = new RateLimiter();