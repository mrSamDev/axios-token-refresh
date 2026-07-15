import type { AxiosError, AxiosRequestConfig } from 'axios';

import type { AccessTokenStore } from './access-token-store';

export type RefreshStatus = 'refreshing' | 'success' | 'failed' | 'error';

export interface RefreshTokenPluginOptions {
  /**
   * Performs the token refresh. The return value drives the token lifecycle:
   *
   * - `string`: success. Persisted via `accessTokenStore` (if provided); queued
   *   requests retry with it.
   * - `null`: auth is over (e.g. the refresh token is dead). The library calls
   *   `accessTokenStore.clear?.()` and rejects queued requests.
   * - rejects: transient failure. Retried up to `maxRetryAttempts`; the stored
   *   token is not cleared.
   */
  refreshTokenFn: () => Promise<string | null>;

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

  /** Called on every status change. Use for UI state; the `onRefresh*` hooks carry the token/error for side effects. */
  onStatusChange?: (status: RefreshStatus, error?: Error) => void;

  onRefreshStart?: () => void;

  onRefreshSuccess?: (token: string) => void;

  onRefreshFail?: (error: Error) => void;

  /** Formats the token into the `Authorization` header value. Defaults to `(token) => \`Bearer ${token}\``. */
  authHeaderFormatter?: (token: string) => string;

  /** Dedupe key for queued requests; same key shares one retry. Defaults to `${method}-${url}-${JSON.stringify(params)}`. */
  getRequestKey?: (request: AxiosRequestConfig) => string;

  /** Timeout in ms for a single refresh attempt. Defaults to `10000`. */
  refreshTimeout?: number;

  /** Max refresh attempts (including the first). Integer `>= 1`. Defaults to `1`. */
  maxRetryAttempts?: number;

  /** Delay in ms between retry attempts. `>= 0`. Defaults to `0`. */
  retryDelay?: number;

  /** When `true` (default), a request interceptor injects the token into outgoing requests. Set `false` to handle auth headers yourself. */
  autoInjectToken?: boolean;
}
