import type { AxiosError, AxiosInstance } from 'axios';

import type { RefreshTokenPluginOptions } from './plugin-options';
import { createRefreshPromise } from './refresh-attempts';
import { dispatchRefreshOutcome } from './refresh-outcome';
import { createRefreshQueue, type RetryableRequestConfig } from './refresh-queue';
import { resolvePluginOptions } from './resolve-options';
import { createTokenInjector } from './token-injector';
import { tryCatch } from './try-catch';

/**
 * Create an Axios interceptor plugin that handles automatic token refresh.
 *
 * When a request fails and {@link RefreshTokenPluginOptions.shouldRefreshToken}
 * returns `true`, the failed request is queued, a refresh is initiated (if not
 * already in progress), and all queued requests are retried with the new token
 * once the refresh succeeds. Concurrent failures during a refresh share the
 * same refresh promise.
 *
 * @param options Configuration for the plugin. See {@link RefreshTokenPluginOptions}.
 * @returns A function that, when called with an Axios instance, installs the
 *   interceptors and returns a cleanup function to eject them.
 *
 *   Each install owns its queue and refresh lifecycle: installing on two
 *   instances refreshes them independently, and cleaning up one install
 *   never affects another. Install on multiple instances only with a
 *   rotation-safe `refreshTokenFn` (each install may refresh concurrently).
 *
 * Usage examples live in the README.
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  accessTokenStore,
  shouldRefreshToken,
  onStatusChange = () => {},
  onRefreshStart,
  onRefreshSuccess,
  onRefreshFail,
  authHeaderFormatter = (token) => `Bearer ${token}`,
  getRequestKey,
  refreshTimeout = 10000,
  maxRetryAttempts = 1,
  retryDelay = 0,
  maxConcurrentRetries,
  autoInjectToken = true,
}: RefreshTokenPluginOptions): (axios: AxiosInstance) => () => void {
  const { tokenGetter, shouldRefresh } = resolvePluginOptions({
    refreshTokenFn,
    getAuthToken,
    accessTokenStore,
    shouldRefreshToken,
    refreshTimeout,
    maxRetryAttempts,
    retryDelay,
    maxConcurrentRetries,
  });

  // Per-install state: each plugin install owns its queue and refresh
  // lifecycle. Installing on two instances refreshes them independently,
  // and cleaning up one install never affects another.

  return (axios: AxiosInstance) => {
    const queue = createRefreshQueue(authHeaderFormatter, getRequestKey, maxConcurrentRetries);
    let isRefreshing = false;
    let refreshPromise: Promise<string | null> | null = null;
    let cleanedUp = false;

    const handleInterceptorError = (interceptorError: unknown): Promise<never> => {
      const handledError =
        interceptorError instanceof Error
          ? interceptorError
          : new Error('Unknown error in refresh token interceptor');

      // Drain first: a throwing onStatusChange must not strand queued requests.
      if (isRefreshing && refreshPromise) {
        queue.reject(handledError);
      }
      tryCatch(() => onStatusChange('error', handledError));

      // Keep isRefreshing/refreshPromise as-is: resetting them here would let
      // the next 401 start a second refresh while the first still runs.
      return Promise.reject(handledError);
    };

    const requestInterceptorId = autoInjectToken
      ? axios.interceptors.request.use(
          createTokenInjector(tokenGetter, authHeaderFormatter),
          (error) => Promise.reject(error),
        )
      : null;

    const responseInterceptorId = axios.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error?.config as RetryableRequestConfig | undefined;
        if (!originalRequest || originalRequest._retry || originalRequest.skipAuthRefresh) {
          return Promise.reject(error);
        }

        const [shouldRefreshResult, shouldRefreshError] = tryCatch<boolean, Error>(() =>
          shouldRefresh(error, originalRequest),
        );
        if (shouldRefreshError) {
          return handleInterceptorError(shouldRefreshError);
        }
        if (!shouldRefreshResult) {
          return Promise.reject(error);
        }

        originalRequest._retry = true;
        const [retryPromise, enqueueError] = tryCatch<Promise<unknown>, Error>(() =>
          queue.enqueue(originalRequest),
        );
        if (enqueueError) {
          return handleInterceptorError(enqueueError);
        }

        if (!isRefreshing) {
          isRefreshing = true;
          tryCatch(() => onStatusChange('refreshing'));
          tryCatch(() => onRefreshStart?.());
          refreshPromise = createRefreshPromise({
            refreshTokenFn,
            refreshTimeout,
            maxRetryAttempts,
            retryDelay,
          });

          // Run refresh lifecycle in the background; all callers await queue promises.
          void (async () => {
            const [newToken, refreshError] = await tryCatch<string | null, Error>(
              refreshPromise as Promise<string | null>,
            );
            // cleanup() already rejected the queue and ejected the interceptors;
            // a late refresh result must not touch the store or fire hooks.
            if (cleanedUp) {
              return;
            }
            try {
              dispatchRefreshOutcome({
                newToken,
                refreshError,
                axiosInstance: axios,
                queue,
                accessTokenStore,
                onStatusChange,
                onRefreshSuccess,
                onRefreshFail,
              });
            } finally {
              // dispatchRefreshOutcome never throws; finally is a backstop so
              // a bug there can never wedge isRefreshing and hang the next 401.
              if (isRefreshing) {
                isRefreshing = false;
                refreshPromise = null;
              }
            }
          })();
        }

        return retryPromise;
      },
    );

    return () => {
      cleanedUp = true;
      queue.reject(new Error('Refresh interceptor cleaned up'));

      if (autoInjectToken && typeof axios?.interceptors?.request?.eject === 'function') {
        axios.interceptors.request.eject(requestInterceptorId as number);
      }

      if (typeof axios?.interceptors?.response?.eject === 'function') {
        axios.interceptors.response.eject(responseInterceptorId);
      }

      isRefreshing = false;
      refreshPromise = null;
    };
  };
}
