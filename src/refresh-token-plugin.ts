import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { createRefreshQueue, type RetryableRequestConfig } from './refresh-queue';
import { tryCatch } from './try-catch';

type RefreshStatus = 'refreshing' | 'success' | 'failed' | 'error';

export interface RefreshTokenPluginOptions {
  refreshTokenFn: () => Promise<string | null>;
  getAuthToken: () => string | null;
  shouldRefreshToken?: (error: AxiosError, originalRequest: AxiosRequestConfig) => boolean;
  onStatusChange?: (status: RefreshStatus, error?: Error) => void;
  authHeaderFormatter?: (token: string) => string;
  getRequestKey?: (request: AxiosRequestConfig) => string;
  refreshTimeout?: number;
  maxRetryAttempts?: number;
  retryDelay?: number;
  autoInjectToken?: boolean;
}

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
      const [token, refreshError] = await tryCatch<string | null, Error>(createSingleRefreshAttempt());
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
          (error) => Promise.reject(error)
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
          shouldRefreshToken(error, originalRequest)
        );
        if (shouldRefreshError) {
          return handleInterceptorError(shouldRefreshError);
        }
        if (!shouldRefresh) {
          return Promise.reject(error);
        }

        originalRequest._retry = true;
        const [retryPromise, enqueueError] = tryCatch<Promise<unknown>, Error>(() =>
          queue.enqueue(originalRequest)
        );
        if (enqueueError) {
          return handleInterceptorError(enqueueError);
        }

        if (!isRefreshing) {
          isRefreshing = true;
          onStatusChange('refreshing');

          refreshPromise = createRefreshPromise();
          const [newToken, refreshError] = await tryCatch<string | null, Error>(refreshPromise);
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
        }

        return retryPromise;
      }
    );

    return () => {
      if (autoInjectToken && typeof axios?.interceptors?.request?.eject === 'function') {
        axios.interceptors.request.eject(requestInterceptorId as number);
      }

      if (typeof axios?.interceptors?.response?.eject === 'function') {
        axios.interceptors.response.eject(responseInterceptorId);
      }

      queue.reset();
      isRefreshing = false;
      refreshPromise = null;
    };
  };
}
