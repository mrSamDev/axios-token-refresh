import { tryCatch } from './try-catch';

/** Options controlling a single refresh attempt and the retry loop around it. */
export interface RefreshAttemptOptions {
  /** Performs the token refresh; resolves with the new token or `null`, or rejects. */
  refreshTokenFn: () => Promise<string | null>;
  /** Timeout in ms for a single refresh attempt. */
  refreshTimeout: number;
  /** Max attempts including the first one. */
  maxRetryAttempts: number;
  /** Delay in ms between retry attempts. */
  retryDelay: number;
}

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const createSingleRefreshAttempt = (
  refreshTokenFn: () => Promise<string | null>,
  refreshTimeout: number,
): Promise<string | null> => {
  const timeoutPromise = new Promise<string | null>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Token refresh timeout'));
    }, refreshTimeout);
  });

  return Promise.race([Promise.resolve().then(refreshTokenFn), timeoutPromise]);
};

/**
 * Run the refresh with a per-attempt timeout and a retry loop.
 *
 * Resolves with the new token string, or `null` if `refreshTokenFn` does. On a
 * transient rejection, retries up to `maxRetryAttempts` (with `retryDelay`
 * between attempts), then rejects with the last error.
 */
export async function createRefreshPromise(options: RefreshAttemptOptions): Promise<string | null> {
  const { refreshTokenFn, refreshTimeout, maxRetryAttempts, retryDelay } = options;
  let latestError: Error = new Error('Token refresh failed');

  for (let attempt = 1; attempt <= maxRetryAttempts; attempt++) {
    const [token, refreshError] = await tryCatch<string | null, Error>(
      createSingleRefreshAttempt(refreshTokenFn, refreshTimeout),
    );
    if (!refreshError) {
      return token;
    }

    latestError = refreshError;
    if (attempt < maxRetryAttempts && retryDelay > 0) {
      await wait(retryDelay);
    }
  }

  throw latestError;
}
