import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

type RefreshFailedError = Error & {
  originalError?: Error;
};

export type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  skipAuthRefresh?: boolean;
};

type QueueItem = {
  request: RetryableRequestConfig;
  requestKey: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const getDefaultRequestKey = (config?: RetryableRequestConfig): string => {
  const method = (config?.method || 'get').toLowerCase();
  const url = config?.url || '';
  const params = JSON.stringify(config?.params || {});
  return `${method}-${url}-${params}`;
};

export function createRefreshQueue(
  authHeaderFormatter: (token: string) => string,
  getRequestKey?: (config: AxiosRequestConfig) => string
) {
  const pendingRequests: QueueItem[] = [];
  const requestPromiseMap = new Map<string, Promise<unknown>>();

  const applyAuthHeader = (
    config: RetryableRequestConfig,
    token: string | null,
    force = false
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

    let resolveFn: (value: unknown) => void = () => {};
    let rejectFn: (reason?: unknown) => void = () => {};
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
    request: RetryableRequestConfig
  ): Promise<unknown> => {
    const callableInstance = axiosInstance as unknown as (
      config: RetryableRequestConfig
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
    const error =
      refreshError instanceof Error ? refreshError : new Error('Token refresh failed');
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
