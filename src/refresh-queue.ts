/**
 * Internal request queue used by the refresh token plugin.
 *
 * This module manages the queue of pending requests while a token refresh is
 * in progress. It deduplicates requests by key, applies the new auth header
 * once a refresh succeeds, and rejects all queued requests if the refresh
 * fails.
 *
 * @module
 */

import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

type RefreshFailedError = Error & {
  originalError?: Error;
};

/**
 * An Axios request config extended with internal flags used by the refresh
 * plugin.
 */
export type RetryableRequestConfig = InternalAxiosRequestConfig & {
  /** Set to `true` once the request has already been queued for retry. */
  _retry?: boolean;
  /**
   * Set to `true` on a per-request basis to bypass the refresh interceptor
   * entirely. Useful for login, logout, or the refresh endpoint itself.
   */
  skipAuthRefresh?: boolean;
};

type QueueItem = {
  request: RetryableRequestConfig;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

/** The public surface returned by {@link createRefreshQueue}. */
export interface RefreshQueue {
  /**
   * Apply the auth header to a request config if a token is available.
   *
   * @param config The request config to mutate.
   * @param token The token to set, or `null` to leave the header untouched.
   * @param force When `true`, overwrite an existing `Authorization` header.
   * @returns The mutated request config.
   */
  applyAuthHeader: (
    config: RetryableRequestConfig,
    token: string | null,
    force?: boolean,
  ) => RetryableRequestConfig;
  /**
   * Add a request to the queue. Dedupe only happens when the queue was
   * created with a `getRequestKey`: requests sharing a key share one retry
   * promise. Without `getRequestKey` every request gets its own retry — two
   * identical-looking requests are still distinct calls expecting distinct
   * responses.
   *
   * @param request The failed request to retry after refresh.
   * @returns A promise that resolves with the retried response or rejects on failure.
   */
  enqueue: (request: RetryableRequestConfig) => Promise<unknown>;
  /**
   * Resolve all queued requests: apply the new token and fire each request.
   * When `maxConcurrentRetries` is finite, at most that many retries are in
   * flight at once.
   *
   * @param newToken The freshly obtained token, or `null`.
   * @param axiosInstance The Axios instance used to execute the retried requests.
   */
  resolve: (newToken: string | null, axiosInstance: AxiosInstance) => void;
  /**
   * Reject all queued requests with a `Token refresh failed` error that
   * carries the original error on its `originalError` property.
   *
   * @param refreshError The error that caused the refresh to fail.
   */
  reject: (refreshError: unknown) => void;
  /** Clear the queue and the request-promise map. */
  reset: () => void;
}

/**
 * Create a request queue that holds pending requests during a token refresh.
 *
 * @param authHeaderFormatter Transforms a token into the `Authorization` header value.
 * @param getRequestKey Optional dedupe key generator. When provided, requests
 *   with the same key share one retry. Omit it to retry every failed request
 *   independently.
 * @param maxConcurrentRetries Max retried requests in flight at once. Defaults
 *   to unlimited (all queued retries fire simultaneously).
 * @returns A {@link RefreshQueue} instance.
 */
export function createRefreshQueue(
  authHeaderFormatter: (token: string) => string,
  getRequestKey?: (config: AxiosRequestConfig) => string,
  maxConcurrentRetries: number = Number.POSITIVE_INFINITY,
): RefreshQueue {
  const pendingRequests: QueueItem[] = [];
  const requestPromiseMap = new Map<string, Promise<unknown>>();

  const applyAuthHeader = (
    config: RetryableRequestConfig,
    token: string | null,
    force = false,
  ): RetryableRequestConfig => {
    if (!token) {
      return config;
    }

    const headers = (config.headers ??= {} as RetryableRequestConfig['headers']);
    if (force || !headers.Authorization) {
      headers.Authorization = authHeaderFormatter(token);
    }
    return config;
  };

  const reset = (): void => {
    pendingRequests.length = 0;
    requestPromiseMap.clear();
  };

  const enqueue = (request: RetryableRequestConfig): Promise<unknown> => {
    const requestKey = getRequestKey?.(request);

    if (requestKey !== undefined) {
      const existing = requestPromiseMap.get(requestKey);
      if (existing) {
        return existing;
      }
    }

    let resolveFn!: (value: unknown) => void;
    let rejectFn!: (reason?: unknown) => void;
    const retryPromise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    if (requestKey !== undefined) {
      requestPromiseMap.set(requestKey, retryPromise);
    }

    pendingRequests.push({ request, resolve: resolveFn, reject: rejectFn });
    return retryPromise;
  };

  const executeRequest = (
    axiosInstance: AxiosInstance,
    request: RetryableRequestConfig,
  ): Promise<unknown> => {
    const callableInstance = axiosInstance as unknown as (
      config: RetryableRequestConfig,
    ) => Promise<unknown>;

    if (typeof callableInstance === 'function') {
      return callableInstance(request);
    }

    return axiosInstance.request(request);
  };

  const resolve = (newToken: string | null, axiosInstance: AxiosInstance): void => {
    const requestsToResolve = [...pendingRequests];
    reset();

    let cursor = 0;
    let inFlight = 0;

    const launchNext = (): void => {
      while (inFlight < maxConcurrentRetries && cursor < requestsToResolve.length) {
        const { request, resolve: resolveRequest } = requestsToResolve[cursor];
        cursor += 1;
        const requestConfig: RetryableRequestConfig = { ...request };
        applyAuthHeader(requestConfig, newToken, true);
        inFlight += 1;
        const attempt = executeRequest(axiosInstance, requestConfig);
        resolveRequest(attempt);
        Promise.resolve(attempt)
          .finally(() => {
            inFlight -= 1;
            launchNext();
          })
          // The queued caller receives the attempt's own rejection; this
          // chain only tracks concurrency slots.
          .catch(() => {});
      }
    };

    launchNext();
  };

  const reject = (refreshError: unknown): void => {
    const error = refreshError instanceof Error ? refreshError : new Error('Token refresh failed');
    const requestsToReject = [...pendingRequests];
    reset();

    requestsToReject.forEach(({ reject: rejectRequest }) => {
      const refreshFailedError: RefreshFailedError = new Error('Token refresh failed');
      refreshFailedError.originalError = error;
      rejectRequest(refreshFailedError);
    });
  };

  return {
    applyAuthHeader,
    enqueue,
    resolve,
    reject,
    reset,
  };
}
