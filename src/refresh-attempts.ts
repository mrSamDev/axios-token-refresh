import { tryCatch } from './try-catch';

/** Options controlling a single refresh attempt and the retry loop around it. */
export interface RefreshAttemptOptions {
  /** Performs the token refresh; resolves with the new token or `null`, or rejects. */
  refreshTokenFn: (signal: AbortSignal) => Promise<string | null>;
  /** Timeout in ms for a single refresh attempt. */
  refreshTimeout: number;
  /** Max attempts including the first one. */
  maxRetryAttempts: number;
  /** Delay in ms between retry attempts. */
  retryDelay: number;
  /** Called with the 1-based attempt number before each attempt starts. */
  onAttempt?: (attempt: number) => void;
}

/** Refresh handle: the settling promise plus best-effort cancellation. */
export interface RefreshHandle {
  promise: Promise<string | null>;
  /**
   * Stop the retry loop and abort the in-flight attempt's signal. The
   * promise rejects with `Token refresh aborted` unless it already settled.
   */
  abort: () => void;
}

export const REFRESH_ABORTED_MESSAGE = 'Token refresh aborted';

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const createSingleRefreshAttempt = (
  refreshTokenFn: RefreshAttemptOptions['refreshTokenFn'],
  refreshTimeout: number,
): { attempt: Promise<string | null>; cancel: () => void } => {
  const controller = new AbortController();

  let rejectAbort!: (error: Error) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });

  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<string | null>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Token refresh timeout'));
    }, refreshTimeout);
  });

  const attempt = Promise.race([
    Promise.resolve().then(() => refreshTokenFn(controller.signal)),
    timeoutPromise,
    abortPromise,
  ]).finally(() => clearTimeout(timeoutId));

  const cancel = (): void => {
    controller.abort();
    rejectAbort(new Error(REFRESH_ABORTED_MESSAGE));
  };

  return { attempt, cancel };
};

/**
 * Run the refresh with a per-attempt timeout, a retry loop, and an abort
 * handle. Each attempt passes its own `AbortSignal` to `refreshTokenFn`; the
 * signal aborts when that attempt times out or the handle is aborted.
 *
 * Resolves with the new token string, or `null` if `refreshTokenFn` does. On a
 * transient rejection, retries up to `maxRetryAttempts` (with `retryDelay`
 * between attempts), then rejects with the last error.
 */
export function createRefreshPromise(options: RefreshAttemptOptions): RefreshHandle {
  const { refreshTokenFn, refreshTimeout, maxRetryAttempts, retryDelay, onAttempt } = options;
  let latestError: Error = new Error('Token refresh failed');
  let isAborted = false;
  let cancelInFlightAttempt: (() => void) | null = null;

  const promise = (async () => {
    for (let attempt = 1; attempt <= maxRetryAttempts; attempt++) {
      onAttempt?.(attempt);
      const { attempt: singleAttempt, cancel: cancelAttempt } = createSingleRefreshAttempt(
        refreshTokenFn,
        refreshTimeout,
      );
      cancelInFlightAttempt = cancelAttempt;

      const [token, refreshError] = await tryCatch(singleAttempt);
      cancelInFlightAttempt = null;

      if (isAborted) {
        throw new Error(REFRESH_ABORTED_MESSAGE);
      }
      if (!refreshError) {
        return token;
      }

      // fn may reject with non-Error; normalize so consumers can trust the type.
      latestError =
        refreshError instanceof Error
          ? refreshError
          : new Error(`Token refresh failed: ${String(refreshError)}`);
      if (attempt < maxRetryAttempts && retryDelay > 0) {
        await wait(retryDelay);
        if (isAborted) {
          throw new Error(REFRESH_ABORTED_MESSAGE);
        }
      }
    }

    throw latestError;
  })();

  const abort = (): void => {
    if (isAborted) {
      return;
    }
    isAborted = true;
    cancelInFlightAttempt?.();
  };

  return { promise, abort };
}
