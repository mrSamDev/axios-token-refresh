import type { AxiosError, AxiosInstance } from 'axios';

import { createHookReporter } from './hook-error';
import { createInterceptorErrorHandler } from './interceptor-error';
import type { RefreshPlugin, RefreshTokenPluginOptions } from './plugin-options';
import { createRefreshPromise } from './refresh-attempts';
import { dispatchRefreshOutcome } from './refresh-outcome';
import { createRefreshQueue, type RetryableRequestConfig } from './refresh-queue';
import { createRequestHold } from './request-hold';
import { resolvePluginOptions } from './resolve-options';
import { tryCatch } from './try-catch';

/**
 * Create an Axios interceptor plugin that handles automatic token refresh.
 *
 * On a refreshable failure, the request is queued, a refresh starts (if not
 * already in flight), and queued requests retry with the new token.
 * Mid-refresh outgoing requests are parked and released with the fresh token.
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
  onHookError,
  silent = false,
  authHeaderFormatter = (token) => `Bearer ${token}`,
  getRequestKey,
  refreshTimeout = 10000,
  maxRetryAttempts = 1,
  retryDelay = 0,
  maxConcurrentRetries,
  maxQueueSize,
  autoInjectToken = true,
  pauseRequestsWhileRefreshing = true,
}: RefreshTokenPluginOptions): RefreshPlugin {
  const { tokenGetter, shouldRefresh } = resolvePluginOptions({
    refreshTokenFn,
    getAuthToken,
    accessTokenStore,
    shouldRefreshToken,
    refreshTimeout,
    maxRetryAttempts,
    retryDelay,
    maxConcurrentRetries,
    maxQueueSize,
  });

  const install = (axios: AxiosInstance) => {
    const reportHook = createHookReporter(onHookError, silent);
    const queue = createRefreshQueue(
      authHeaderFormatter,
      getRequestKey,
      maxConcurrentRetries,
      maxQueueSize,
    );
    const requestHold = createRequestHold({
      getRefreshPromise: () => refreshPromise,
      tokenGetter,
      authHeaderFormatter,
      autoInjectToken,
      pauseRequestsWhileRefreshing,
    });
    let isRefreshing = false;
    let refreshPromise: Promise<string | null> | null = null;
    let refreshAbort: (() => void) | null = null;
    let currentAttempt = 1;
    let cleanedUp = false;

    const handleInterceptorError = createInterceptorErrorHandler({
      reportHook,
      onStatusChange,
      queueSize: () => queue.size(),
      getAttempt: () => currentAttempt,
    });

    const requestInterceptorId =
      autoInjectToken || pauseRequestsWhileRefreshing
        ? axios.interceptors.request.use(requestHold.interceptor, (e) => Promise.reject(e))
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
          return handleInterceptorError(shouldRefreshError, error);
        }
        if (!shouldRefreshResult) {
          return Promise.reject(error);
        }

        const retryConfig: RetryableRequestConfig = { ...originalRequest, _retry: true };
        const [retryPromise, enqueueError] = tryCatch<Promise<unknown>, Error>(() =>
          queue.enqueue(retryConfig, getRequestKey?.(originalRequest)),
        );
        if (enqueueError) {
          return handleInterceptorError(enqueueError, error);
        }

        if (!isRefreshing) {
          isRefreshing = true;
          reportHook('onStatusChange', () =>
            onStatusChange('refreshing', undefined, { queueDepth: queue.size(), attemptCount: 1 }),
          );
          reportHook('onRefreshStart', () => onRefreshStart?.());
          const refresh = createRefreshPromise({
            refreshTokenFn,
            refreshTimeout,
            maxRetryAttempts,
            retryDelay,
            onAttempt: (attempt) => {
              currentAttempt = attempt;
            },
          });
          refreshPromise = refresh.promise;
          refreshAbort = refresh.abort;

          void (async () => {
            const [newToken, refreshError] = await tryCatch<string | null, Error>(refresh.promise);
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
                reportHook,
                attemptCount: currentAttempt,
              });
            } finally {
              requestHold.clearParked();
              if (isRefreshing) {
                isRefreshing = false;
                refreshPromise = null;
                refreshAbort = null;
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
      requestHold.rejectParked(new Error('Refresh interceptor cleaned up'));

      if (
        (autoInjectToken || pauseRequestsWhileRefreshing) &&
        typeof axios?.interceptors?.request?.eject === 'function'
      ) {
        axios.interceptors.request.eject(requestInterceptorId as number);
      }

      if (typeof axios?.interceptors?.response?.eject === 'function') {
        axios.interceptors.response.eject(responseInterceptorId);
      }

      isRefreshing = false;
      refreshPromise = null;
      refreshAbort?.();
      refreshAbort = null;
    };
  };

  let warned = false;
  const plugin = ((axios: AxiosInstance) => {
    if (!warned && !silent) {
      warned = true;
      console.warn(
        '[axios-token-refresh] Calling the plugin as a function is deprecated. Use refreshPlugin.attach(apiClient) instead.',
      );
    }
    return install(axios);
  }) as RefreshPlugin;
  plugin.attach = install;
  return plugin;
}
