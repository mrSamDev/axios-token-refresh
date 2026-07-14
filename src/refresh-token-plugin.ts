import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

import { createRefreshQueue, type RetryableRequestConfig } from './refresh-queue';
import { tryCatch } from './try-catch';

/** The lifecycle status of a token refresh operation, reported via {@link RefreshTokenPluginOptions.onStatusChange}. */
export type RefreshStatus = 'refreshing' | 'success' | 'failed' | 'error';

/**
 * Configuration options for {@link createRefreshTokenPlugin}.
 */
export interface RefreshTokenPluginOptions {
  /**
   * Async function that performs the token refresh and resolves with the new
   * token string, or `null` if the refresh could not be completed.
   */
  refreshTokenFn: () => Promise<string | null>;

  /**
   * Function that returns the current auth token, or `null` if no token is
   * available. Used both to inject the token into outgoing requests and to
   * decide whether a refresh should be attempted.
   */
  getAuthToken: () => string | null;

  /**
   * Predicate that determines whether a failed response should trigger a token
   * refresh.
   *
   * The default implementation returns `false` when no token is present,
   * `true` for network errors (no `response`), and `true` for HTTP 401
   * responses.
   *
   * @param error The Axios error from the failed response.
   * @param originalRequest The original request config that failed.
   * @returns `true` if a refresh should be attempted.
   */
  shouldRefreshToken?: (error: AxiosError, originalRequest: AxiosRequestConfig) => boolean;

  /**
   * Callback invoked whenever the refresh status changes.
   *
   * @param status The new {@link RefreshStatus}.
   * @param error The error, if the status is `"failed"` or `"error"`.
   */
  onStatusChange?: (status: RefreshStatus, error?: Error) => void;

  /**
   * Transforms a token into the value used for the `Authorization` header.
   * Defaults to `(token) => \`Bearer ${token}\``.
   *
   * @param token The auth token.
   * @returns The formatted header value.
   */
  authHeaderFormatter?: (token: string) => string;

  /**
   * Custom dedupe key generator for queued requests. Two requests with the
   * same key share a single retry promise instead of being duplicated.
   *
   * The default key is `${method}-${url}-${JSON.stringify(params)}`. Override
   * this to include fields like `data` or custom headers when needed.
   *
   * @param request The request config to generate a key for.
   * @returns A unique string key for deduplication.
   */
  getRequestKey?: (request: AxiosRequestConfig) => string;

  /** Timeout in milliseconds for a single refresh attempt. Defaults to `10000` (10 seconds). */
  refreshTimeout?: number;

  /**
   * Maximum number of refresh attempts (including the first one) before
   * failing. Must be an integer greater than or equal to `1`. Defaults to `1`.
   */
  maxRetryAttempts?: number;

  /** Delay in milliseconds between refresh retry attempts. Must be greater than or equal to `0`. Defaults to `0`. */
  retryDelay?: number;

  /**
   * When `true` (the default), a request interceptor is installed that
   * automatically injects the current token into outgoing requests. Set to
   * `false` if you handle auth headers yourself.
   */
  autoInjectToken?: boolean;
}

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
  shouldRefreshToken = (error, _originalRequest) => {
    if (!getAuthToken()) {
      return false;
    }

    if (!error?.response) {
      return true;
    }

    return error.response.status === 401;
  },
  onStatusChange = (status, error) => {
    console.log(`Token refresh status: ${status}`, error || '');
  },
  authHeaderFormatter = (token) => `Bearer ${token}`,
  getRequestKey,
  refreshTimeout = 10000,
  maxRetryAttempts = 1,
  retryDelay = 0,
  autoInjectToken = true,
}: RefreshTokenPluginOptions): (axios: AxiosInstance) => () => void {
  if (typeof refreshTokenFn !== 'function') {
    throw new Error('refreshTokenFn must be a function');
  }

  if (typeof getAuthToken !== 'function') {
    throw new Error('getAuthToken must be a function');
  }

  if (!Number.isInteger(maxRetryAttempts) || maxRetryAttempts < 1) {
    throw new Error('maxRetryAttempts must be an integer greater than or equal to 1');
  }

  if (!Number.isFinite(retryDelay) || retryDelay < 0) {
    throw new Error('retryDelay must be a number greater than or equal to 0');
  }

  const queue = createRefreshQueue(authHeaderFormatter, getRequestKey);
  let isRefreshing = false;
  let refreshPromise: Promise<string | null> | null = null;

  const createSingleRefreshAttempt = (): Promise<string | null> => {
    const timeoutPromise = new Promise<string | null>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Token refresh timeout'));
      }, refreshTimeout);
    });

    return Promise.race([Promise.resolve().then(refreshTokenFn), timeoutPromise]);
  };

  const wait = (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });

  const createRefreshPromise = async (): Promise<string | null> => {
    let latestError: Error = new Error('Token refresh failed');

    for (let attempt = 1; attempt <= maxRetryAttempts; attempt++) {
      const [token, refreshError] = await tryCatch<string | null, Error>(
        createSingleRefreshAttempt(),
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
  };

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
            const token = getAuthToken();
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

        const [shouldRefresh, shouldRefreshError] = tryCatch<boolean, Error>(() =>
          shouldRefreshToken(error, originalRequest),
        );
        if (shouldRefreshError) {
          return handleInterceptorError(shouldRefreshError);
        }
        if (!shouldRefresh) {
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
          refreshPromise = createRefreshPromise();

          // Run refresh lifecycle in the background; all callers await queue promises.
          void (async () => {
            const [newToken, refreshError] = await tryCatch<string | null, Error>(
              refreshPromise as Promise<string | null>,
            );
            if (refreshError) {
              onStatusChange('failed', refreshError);
              queue.reject(refreshError);
            } else {
              onStatusChange('success');
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
