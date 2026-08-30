import type { AxiosInstance } from 'axios';

import { applyAuthHeader } from './auth-header';
import type { RetryableRequestConfig } from './refresh-queue';

/** A queued request and the deferred promise its caller is awaiting. */
export interface QueuedRequest {
  request: RetryableRequestConfig;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface LaunchRetriesOptions {
  requests: QueuedRequest[];
  newToken: string | null;
  axiosInstance: AxiosInstance;
  maxConcurrentRetries: number;
  authHeaderFormatter: (token: string) => string;
}

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

/**
 * Fire queued retries with the fresh token, capping how many are in flight at
 * once. A request whose setup throws (formatter, instance callable) fails
 * alone: the rest of the queue still drains.
 */
export const launchRetries = (options: LaunchRetriesOptions): void => {
  const { requests, newToken, axiosInstance, maxConcurrentRetries, authHeaderFormatter } = options;

  let cursor = 0;
  let inFlight = 0;

  const launchNext = (): void => {
    while (inFlight < maxConcurrentRetries && cursor < requests.length) {
      const { request, resolve: resolveRequest, reject: rejectRequest } = requests[cursor];
      cursor += 1;

      let attempt: Promise<unknown>;
      try {
        const requestConfig: RetryableRequestConfig = { ...request };
        applyAuthHeader(requestConfig, newToken, authHeaderFormatter, true);
        attempt = executeRequest(axiosInstance, requestConfig);
      } catch (setupError) {
        rejectRequest(setupError);
        continue;
      }

      inFlight += 1;
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
