import type { AxiosInstance } from 'axios';

import type { AccessTokenStore } from './access-token-store';
import type { RefreshStatus } from './plugin-options';
import type { RefreshQueue } from './refresh-queue';
import { tryCatch } from './try-catch';

/** Callbacks and state a settled refresh needs to act on. */
export interface RefreshOutcomeDeps {
  /** `[token, null]`, `[null, error]`, or `[null, null]` (refreshFn returned null). */
  newToken: string | null;
  refreshError: Error | null;
  axiosInstance: AxiosInstance;
  queue: RefreshQueue;
  accessTokenStore?: AccessTokenStore;
  onStatusChange: (status: RefreshStatus, error?: Error) => void;
  onRefreshSuccess?: (token: string) => void;
  onRefreshFail?: (error: Error) => void;
}

/**
 * Drain the queue for a settled refresh, guarding every user callback.
 *
 * A throwing store or hook must never strand queued requests, so each user
 * call is wrapped and the queue always resolves or rejects exactly once.
 * This function never throws.
 */
export function dispatchRefreshOutcome(deps: RefreshOutcomeDeps): void {
  const { newToken, refreshError, axiosInstance, queue } = deps;
  const { accessTokenStore, onStatusChange, onRefreshSuccess, onRefreshFail } = deps;

  const safeHook = (hook: () => void): void => {
    tryCatch(hook);
  };

  const safeStatus = (status: RefreshStatus, error?: Error): void => {
    // Call without the error arg when absent: hooks often assert exact arity.
    if (error === undefined) {
      safeHook(() => onStatusChange(status));
    } else {
      safeHook(() => onStatusChange(status, error));
    }
  };

  // Storage failures are reported through onStatusChange so they stay visible;
  // if that report itself throws, safeStatus swallows it.
  const safeStorage = (operation: () => void): void => {
    const [, error] = tryCatch(operation);
    if (error) {
      safeStatus('error', error);
    }
  };

  if (refreshError) {
    // Rejected after all retries. Transient, so leave the stored token alone.
    safeStatus('failed', refreshError);
    safeHook(() => onRefreshFail?.(refreshError));
    queue.reject(refreshError);
    return;
  }

  if (newToken === null) {
    // null: auth is over.
    safeStorage(() => accessTokenStore?.clear?.());
    const authOverError = new Error('Token refresh failed: refreshTokenFn returned null');
    safeStatus('failed', authOverError);
    safeHook(() => onRefreshFail?.(authOverError));
    queue.reject(authOverError);
    return;
  }

  safeStorage(() => accessTokenStore?.setAccessToken(newToken));
  safeStatus('success');
  safeHook(() => onRefreshSuccess?.(newToken));
  queue.resolve(newToken, axiosInstance);
}
