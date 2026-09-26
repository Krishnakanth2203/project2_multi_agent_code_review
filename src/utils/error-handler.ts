/**
 * Application-specific exception for review operations
 */
export class ReviewError extends Error {
  readonly code: string;
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
    this.metadata = metadata;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Standardized status and error identifiers
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a promise-returning callback, reapplying exponential backoff with jitter on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let failureCause: unknown;

  for (let currentAttempt = 0; currentAttempt < maxRetries; currentAttempt++) {
    try {
      return await fn();
    } catch (err) {
      failureCause = err;

      const isFinalAttempt = currentAttempt === maxRetries - 1;
      if (isFinalAttempt) {
        break;
      }

      const backoffWait = delayMs * 2 ** currentAttempt;
      const randomizedJitter = Math.random() * 100;
      await sleep(backoffWait + randomizedJitter);
    }
  }

  const detailedMessage = formatError(failureCause);
  throw new ReviewError(
    `Operation failed after ${maxRetries} attempts: ${detailedMessage}`,
    ErrorCodes.RETRY_EXHAUSTED,
    { attempts: maxRetries, lastError: detailedMessage }
  );
}

/**
 * Bounds an asynchronous task within a maximum duration threshold.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new ReviewError(errorMessage, ErrorCodes.AGENT_TIMEOUT, { timeoutMs }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Type guard to identify ReviewError instances.
 */
export function isReviewError(error: unknown): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Serializes arbitrary errors into printable string messages.
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}