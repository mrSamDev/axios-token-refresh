import type { AxiosError, AxiosInstance } from 'axios';

import type { RefreshTokenPluginOptions } from './plugin-options';
import { createRefreshPromise } from './refresh-attempts';
import { createRefreshQueue, type RetryableRequestConfig } from './refresh-queue';
import { resolvePluginOptions } from './resolve-options';
import { tryCatch } from './try-catch';

/**
 * Create an Axios interceptor plugin that handles automatic token refresh.
 *
 * When a request fails and {@link RefreshTokenPluginOptions.shouldRefreshToken}
 * returns `true`, the failed request is queued, a refresh is initiated (if not
 * already in progress), and all queued requests are retried with the new token
 * once the refresh succeeds. Concurrent failures during a refresh share the
 * same refresh promise and are deduplicated by request key.
 *
 * @param options Configuration for the plugin. See {@link RefreshTokenPluginOptions}.
 * @returns A function that, when called with an Axios instance, installs the
 *   interceptors and returns a cleanup function to eject them.
 *
 * @example
 * ```ts
 * import axios from "axios";
 * import { createRefreshTokenPlugin } from "@mrsamdev/axios-token-refresh";
 *
 * const api = axios.create({ baseURL: "https://api.example.com" });
 *
 * const plugin = createRefreshTokenPlugin({
 *   refreshTokenFn: async () => {
 *     const res = await axios.post("/refresh", {
 *       refresh_token: localStorage.getItem("refreshToken"),
 *     });
 *     return res.data.access_token as string;
 *   },
 *   getAuthToken: () => localStorage.getItem("token"),
 * });
 *
 * const cleanup = plugin(api);
 *
 * // Later, to remove the interceptors:
 * cleanup();
 * ```
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  accessTokenStore,
  shouldRefreshToken,
  onStatusChange = (status, error) => {
    console.log(`Token refresh status: ${status}`, error || '');
  },
  onRefreshStart,
  onRefreshSuccess,
  onRefreshFail,
  authHeaderFormatter = (token) => `Bearer ${token}`,
  getRequestKey,
  refreshTimeout = 10000,
  maxRetryAttempts = 1,
  retryDelay = 0,
  autoInjectToken = true,
}: RefreshTokenPluginOptions): (axios: AxiosInstance) => () => void {
  const { tokenGetter, shouldRefresh } = resolvePluginOptions({
    refreshTokenFn,
    getAuthToken,
    accessTokenStore,
    shouldRefreshToken,
    maxRetryAttempts,
    retryDelay,
  });

  const queue = createRefreshQueue(authHeaderFormatter, getRequestKey);
  let isRefreshing = false;
  let refreshPromise: Promise<string | null> | null = null;

  return (axios: AxiosInstance) => {
    const handleInterceptorError = (interceptorError: unknown): Promise<never> => {
      const handledError =
        interceptorError instanceof Error
          ? interceptorError
          : new Error('Unknown error in refresh token interceptor');
      onStatusChange('error', handledError);

      if (isRefreshing && refreshPromise) {
        queue.reject(handledError);
        isRefreshing = false;
        refreshPromise = null;
      }

      return Promise.reject(handledError);
    };

    const requestInterceptorId = autoInjectToken
      ? axios.interceptors.request.use(
          (config) => {
            const token = tokenGetter();
            if (token) {
              const headers = (config.headers ??= {} as typeof config.headers);
              if (!headers.Authorization) {
                headers.Authorization = authHeaderFormatter(token);
              }
            }
            return config;
          },
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
          onStatusChange('refreshing');
          onRefreshStart?.();
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
            if (refreshError) {
              // Rejected after all retries. Transient, so leave the stored token alone.
              onStatusChange('failed', refreshError);
              onRefreshFail?.(refreshError);
              queue.reject(refreshError);
            } else if (newToken === null) {
              // null. Auth is over; clear the token if the store supports it.
              accessTokenStore?.clear?.();
              const authOverError = new Error('Token refresh failed: refreshTokenFn returned null');
              onStatusChange('failed', authOverError);
              onRefreshFail?.(authOverError);
              queue.reject(authOverError);
            } else {
              // string. Refresh succeeded; persist the token if a store is provided.
              accessTokenStore?.setAccessToken(newToken);
              onStatusChange('success');
              onRefreshSuccess?.(newToken);
              queue.resolve(newToken, axios);
            }

            if (isRefreshing) {
              isRefreshing = false;
              refreshPromise = null;
            }
          })();
        }

        return retryPromise;
      },
    );

    return () => {
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
