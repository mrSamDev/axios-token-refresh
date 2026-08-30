import type { InternalAxiosRequestConfig } from 'axios';

import { applyAuthHeader } from './auth-header';
import type { RefreshFailedError, RetryableRequestConfig } from './refresh-queue';
import { tryCatch } from './try-catch';

/** State accessors the request hold reads from the owning plugin install. */
export interface RequestHoldOptions {
  /** The in-flight refresh promise, or `null` when no refresh is running. */
  getRefreshPromise: () => Promise<string | null> | null;
  /** Returns the current access token, or `null` if none is available. */
  tokenGetter: () => string | null;
  /** Formats a token into the `Authorization` header value. */
  authHeaderFormatter: (token: string) => string;
  autoInjectToken: boolean;
  pauseRequestsWhileRefreshing: boolean;
}

/** The request interceptor plus parked-request lifecycle controls. */
export interface RequestHold {
  interceptor: (config: InternalAxiosRequestConfig) => Promise<InternalAxiosRequestConfig>;
  /** Reject every still-waiting parked request, e.g. on cleanup. */
  rejectParked: (error: Error) => void;
  /** Drop the waiter list once the refresh settles (all waiters settle via it). */
  clearParked: () => void;
}

const authOverFailure = (): RefreshFailedError => {
  const failure: RefreshFailedError = new Error('Token refresh failed');
  failure.originalError = new Error('Token refresh failed: refreshTokenFn returned null');
  return failure;
};

/**
 * Build the request interceptor that parks outgoing requests while a refresh
 * is in flight and releases them with the fresh token, mirroring the
 * queue's rejection shape when the refresh fails.
 *
 * Requests with `_retry` (queue retries) or `skipAuthRefresh` are never
 * parked; injection still follows `autoInjectToken`.
 */
export const createRequestHold = (options: RequestHoldOptions): RequestHold => {
  const { getRefreshPromise, tokenGetter, authHeaderFormatter } = options;
  const { autoInjectToken, pauseRequestsWhileRefreshing } = options;

  const parkedRejects: Array<(error: Error) => void> = [];

  const park = (refreshPromise: Promise<string | null>): Promise<string | null> =>
    new Promise((resolve, reject) => {
      parkedRejects.push(reject);
      refreshPromise.then(
        (token) => resolve(token),
        (refreshError) => {
          const failure: RefreshFailedError = new Error('Token refresh failed');
          failure.originalError =
            refreshError instanceof Error ? refreshError : new Error('Token refresh failed');
          reject(failure);
        },
      );
    });

  const interceptor = async (axiosConfig: InternalAxiosRequestConfig) => {
    const request = axiosConfig as RetryableRequestConfig;
    const refreshPromise = getRefreshPromise();

    const shouldPark =
      pauseRequestsWhileRefreshing &&
      refreshPromise !== null &&
      !request._retry &&
      !request.skipAuthRefresh;

    if (shouldPark) {
      // Tokenless requests carry no stale-token risk: don't park them.
      const hasToken = tokenGetter() !== null;
      if (!hasToken) {
        return axiosConfig;
      }

      // Use the refresh result directly, not the store (store update races this).
      const [token, parkError] = await tryCatch<string | null, Error>(park(refreshPromise));
      if (parkError) {
        throw parkError;
      }
      if (token === null) {
        throw authOverFailure();
      }
      if (autoInjectToken) {
        applyAuthHeader(request, token, authHeaderFormatter);
      }
      return axiosConfig;
    }

    if (autoInjectToken) {
      const token = tokenGetter();
      if (token) {
        applyAuthHeader(request, token, authHeaderFormatter);
      }
    }
    return axiosConfig;
  };

  const rejectParked = (error: Error): void => {
    const toReject = [...parkedRejects];
    parkedRejects.length = 0;
    toReject.forEach((reject) => reject(error));
  };

  const clearParked = (): void => {
    parkedRejects.length = 0;
  };

  return { interceptor, rejectParked, clearParked };
};
