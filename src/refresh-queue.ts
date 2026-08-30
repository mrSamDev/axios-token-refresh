/**
 * Internal request queue used by the refresh token plugin.
 *
 * This module manages the queue of pending requests while a token refresh is
 * in progress. It optionally deduplicates requests by key (when a `getRequestKey`
 * is supplied), applies the new auth header
 * once a refresh succeeds, and rejects all queued requests if the refresh
 * fails.
 *
 * @module
 */

import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

import { applyAuthHeader } from './auth-header';
import { launchRetries, type QueuedRequest } from './retry-launcher';

export type RefreshFailedError = Error & {
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

type QueueItem = QueuedRequest;

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
   * promise. Without `getRequestKey` every request gets its own retry: two
   * identical-looking requests are still distinct calls expecting distinct
   * responses.
   *
   * @param request The failed request to retry after refresh.
   * @returns A promise that resolves with the retried response or rejects on failure.
   */
  enqueue: (request: RetryableRequestConfig, requestKey?: string) => Promise<unknown>;
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
  /** Number of requests currently waiting in the queue. */
  size: () => number;
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
 * @param maxQueueSize Max requests held in the queue. Defaults to unlimited.
 *   When full, the newest request is rejected with `Token refresh queue is full`.
 * @returns A {@link RefreshQueue} instance.
 */
export function createRefreshQueue(
  authHeaderFormatter: (token: string) => string,
  getRequestKey?: (config: AxiosRequestConfig) => string,
  maxConcurrentRetries: number = Number.POSITIVE_INFINITY,
  maxQueueSize: number = Number.POSITIVE_INFINITY,
): RefreshQueue {
  const pendingRequests: QueueItem[] = [];
  const requestPromiseMap = new Map<string, Promise<unknown>>();

  const reset = (): void => {
    pendingRequests.length = 0;
    requestPromiseMap.clear();
  };

  const enqueue = (request: RetryableRequestConfig, requestKey?: string): Promise<unknown> => {
    // Reject (don't throw) so overflow never cascades into the key-fn error path.
    if (pendingRequests.length >= maxQueueSize) {
      return Promise.reject(new Error('Token refresh queue is full'));
    }

    // A caller may precompute the key from a different config (e.g. the
    // original request, not the _retry clone); fall back to getRequestKey.
    const key = requestKey ?? getRequestKey?.(request);

    if (key !== undefined) {
      const existing = requestPromiseMap.get(key);
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

    if (key !== undefined) {
      requestPromiseMap.set(key, retryPromise);
    }

    pendingRequests.push({ request, resolve: resolveFn, reject: rejectFn });
    return retryPromise;
  };

  const resolve = (newToken: string | null, axiosInstance: AxiosInstance): void => {
    const requestsToResolve = [...pendingRequests];
    reset();

    launchRetries({
      requests: requestsToResolve,
      newToken,
      axiosInstance,
      maxConcurrentRetries,
      authHeaderFormatter,
    });
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
    applyAuthHeader: (config, token, force) =>
      applyAuthHeader(config, token, authHeaderFormatter, force),
    enqueue,
    resolve,
    reject,
    size: () => pendingRequests.length,
    reset,
  };
}
