import type { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

import type { AccessTokenStore } from './access-token-store';
import type { OnHookError } from './hook-error';

/** The plugin returned by {@link createRefreshTokenPlugin}. */
export interface RefreshPlugin {
  /** @deprecated Use {@link RefreshPlugin.attach} instead. */
  (axios: AxiosInstance): () => void;
  /** Install the plugin on an Axios instance and return a cleanup function. */
  attach: (axios: AxiosInstance) => () => void;
}

export type RefreshStatus = 'refreshing' | 'success' | 'failed' | 'error';

/** Context passed to `onStatusChange` alongside the status. */
export interface RefreshStatusContext {
  /** Requests waiting in the retry queue at the moment the status fired. */
  queueDepth: number;
  /** Which refresh attempt is running (1-based). */
  attemptCount: number;
}

export interface RefreshTokenPluginOptions {
  /**
   * Performs the refresh. The return value drives the token lifecycle:
   *
   * - `string`: success. Persisted via `accessTokenStore` (if provided); queued
   *   requests retry with it.
   * - `null`: auth is over (e.g. the refresh token is dead). The library calls
   *   `accessTokenStore.clear?.()` and rejects queued requests.
   * - rejects: transient failure. Retried up to `maxRetryAttempts`; the stored
   *   token is not cleared.
   *
   * The attempt's `AbortSignal` aborts on attempt timeout or plugin cleanup —
   * forward it into fetch/axios to stop overlapped refresh calls. Ignoring the
   * signal is fine; the refresh still settles.
   */
  refreshTokenFn: (signal: AbortSignal) => Promise<string | null>;

  /** Returns the current token, or `null`. Mutually exclusive with `accessTokenStore`. */
  getAuthToken?: () => string | null;

  /**
   * Storage for the access token. On a successful refresh the new token is
   * persisted via `setAccessToken`; on `null` it is cleared via `clear` (if
   * defined). Mutually exclusive with `getAuthToken`.
   */
  accessTokenStore?: AccessTokenStore;

  /**
   * Decides whether a failed response triggers a refresh. The default returns
   * `false` when no token is present, `true` for network errors, and `true`
   * for HTTP 401.
   */
  shouldRefreshToken?: (error: AxiosError, originalRequest: AxiosRequestConfig) => boolean;

  /**
   * Called on every status change. Use for UI state; the `onRefresh*` hooks
   * carry the token/error for side effects. Defaults to a no-op.
   *
   * The third argument carries `queueDepth` (requests waiting) and
   * `attemptCount` (1-based refresh attempt).
   */
  onStatusChange?: (status: RefreshStatus, error?: Error, context?: RefreshStatusContext) => void;

  onRefreshStart?: () => void;

  onRefreshSuccess?: (token: string) => void;

  onRefreshFail?: (error: Error) => void;

  /**
   * Called when a lifecycle hook (`onStatusChange`, `onRefreshStart`,
   * `onRefreshSuccess`, `onRefreshFail`) throws. When omitted, or when the
   * handler itself throws, the failure falls back to `console.error`.
   */
  onHookError?: OnHookError;

  /**
   * When `true`, suppress the `console.error` fallback for hook failures
   * (e.g. serverless/edge where stderr is alarming). Defaults to `false`.
   */
  silent?: boolean;

  /** Formats the token into the `Authorization` header value. Defaults to `(token) => \`Bearer ${token}\``. */
  authHeaderFormatter?: (token: string) => string;

  /** Dedupe key for queued requests; requests with the same key share one retry. Omit to retry every failed request independently. */
  getRequestKey?: (request: AxiosRequestConfig) => string;

  /**
   * Max requests held in the retry queue. Defaults to unlimited. When the
   * queue is full, the newest refreshable request is rejected with
   * `Token refresh queue is full` so the caller can back off instead of
   * piling up unbounded memory.
   */
  maxQueueSize?: number;

  /**
   * Timeout in ms for a single refresh attempt. Defaults to `10000`.
   *
   * On timeout the attempt's `AbortSignal` aborts (forward it in
   * `refreshTokenFn` to stop the work) and the next retry starts immediately;
   * a fn that ignores the signal keeps running in the background.
   */
  refreshTimeout?: number;

  /** Max refresh attempts (including the first). Integer `>= 1`. Defaults to `1`. */
  maxRetryAttempts?: number;

  /** Delay in ms between retry attempts. `>= 0`. Defaults to `0`. */
  retryDelay?: number;

  /**
   * Max simultaneous retried requests after a successful refresh. `>= 1`.
   * Defaults to unlimited (all queued retries fire at once). Set to avoid
   * retry bursts hitting your API when many requests fail together.
   */
  maxConcurrentRetries?: number;

  /**
   * When `true` (default), requests fired while a refresh is in flight are
   * parked in the request interceptor and released with the fresh token,
   * instead of racing out with the stale token and 401-ing into the queue.
   * Parked requests are rejected when the refresh fails or the plugin is
   * cleaned up. `skipAuthRefresh` requests are never parked.
   */
  pauseRequestsWhileRefreshing?: boolean;

  /** When `true` (default), a request interceptor injects the token into outgoing requests. Set `false` to handle auth headers yourself. */
  autoInjectToken?: boolean;
}
