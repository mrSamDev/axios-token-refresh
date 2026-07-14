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
  requestKey: string;
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
   * Add a request to the queue. If a request with the same key is already
   * pending, the existing promise is returned instead of enqueuing a duplicate.
   *
   * @param request The failed request to retry after refresh.
   * @returns A promise that resolves with the retried response or rejects on failure.
   */
  enqueue: (request: RetryableRequestConfig) => Promise<unknown>;
  /**
   * Resolve all queued requests: apply the new token and fire each request.
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

const getDefaultRequestKey = (config?: RetryableRequestConfig): string => {
  const method = (config?.method || 'get').toLowerCase();
  const url = config?.url || '';
  const params = JSON.stringify(config?.params || {});
  return `${method}-${url}-${params}`;
};

/**
 * Create a request queue that holds pending requests during a token refresh.
 *
 * @param authHeaderFormatter Transforms a token into the `Authorization` header value.
 * @param getRequestKey Optional custom dedupe key generator. Defaults to `method-url-params`.
 * @returns A {@link RefreshQueue} instance.
 */
export function createRefreshQueue(
  authHeaderFormatter: (token: string) => string,
  getRequestKey?: (config: AxiosRequestConfig) => string,
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
    const configuredRequestKey = getRequestKey?.(request);
    const requestKey = configuredRequestKey || getDefaultRequestKey(request);
    const existing = requestPromiseMap.get(requestKey);
    if (existing) {
      return existing;
    }

    let resolveFn!: (value: unknown) => void;
    let rejectFn!: (reason?: unknown) => void;
    const retryPromise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    pendingRequests.push({ request, requestKey, resolve: resolveFn, reject: rejectFn });
    requestPromiseMap.set(requestKey, retryPromise);
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

    requestsToResolve.forEach(({ request, resolve: resolveRequest }) => {
      const requestConfig: RetryableRequestConfig = { ...request };
      applyAuthHeader(requestConfig, newToken, true);
      resolveRequest(executeRequest(axiosInstance, requestConfig));
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
    applyAuthHeader,
    enqueue,
    resolve,
    reject,
    reset,
  };
}
