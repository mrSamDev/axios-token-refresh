import type { AxiosInstance } from 'axios';

import type { AccessTokenStore } from './access-token-store';
import type { HookName, ReportHook } from './hook-error';
import type { RefreshStatus, RefreshStatusContext } from './plugin-options';
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
  onStatusChange: (status: RefreshStatus, error?: Error, context?: RefreshStatusContext) => void;
  onRefreshSuccess?: (token: string) => void;
  onRefreshFail?: (error: Error) => void;
  /** Surfaced-hook runner built per install. */
  reportHook: ReportHook;
  /** Which refresh attempt settled (1-based). */
  attemptCount: number;
}

/**
 * Drain the queue for a settled refresh, guarding every user callback.
 *
 * A throwing store or hook must never strand queued requests, so each user
 * call is wrapped and the queue always resolves or rejects exactly once.
 * This function never throws.
 */
export function dispatchRefreshOutcome(deps: RefreshOutcomeDeps): void {
  const { newToken, refreshError, axiosInstance, queue, reportHook, attemptCount } = deps;
  const { accessTokenStore, onStatusChange, onRefreshSuccess, onRefreshFail } = deps;

  const safeHook = (hookName: HookName, hook: () => void): void => {
    reportHook(hookName, hook);
  };

  const safeStatus = (status: RefreshStatus, error?: Error): void => {
    const context: RefreshStatusContext = { queueDepth: queue.size(), attemptCount };
    if (error === undefined) {
      safeHook('onStatusChange', () => onStatusChange(status, undefined, context));
    } else {
      safeHook('onStatusChange', () => onStatusChange(status, error, context));
    }
  };

  const safeStorage = (operation: () => void): void => {
    const [, error] = tryCatch(operation);
    if (error) {
      safeStatus('error', error);
    }
  };

  if (refreshError) {
    // Rejected after all retries. Transient, so leave the stored token alone.
    safeStatus('failed', refreshError);
    safeHook('onRefreshFail', () => onRefreshFail?.(refreshError));
    queue.reject(refreshError);
    return;
  }

  if (newToken === null) {
    // null: auth is over.
    safeStorage(() => accessTokenStore?.clear?.());
    const authOverError = new Error('Token refresh failed: refreshTokenFn returned null');
    safeStatus('failed', authOverError);
    safeHook('onRefreshFail', () => onRefreshFail?.(authOverError));
    queue.reject(authOverError);
    return;
  }

  safeStorage(() => accessTokenStore?.setAccessToken(newToken));
  safeStatus('success');
  safeHook('onRefreshSuccess', () => onRefreshSuccess?.(newToken));
  queue.resolve(newToken, axiosInstance);
}
