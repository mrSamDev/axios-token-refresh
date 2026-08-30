import type { AxiosError, AxiosRequestConfig } from 'axios';

import type { AccessTokenStore } from './access-token-store';
import type { RefreshTokenPluginOptions } from './plugin-options';

/** The token accessor and refresh-predicate derived from plugin options. */
export interface ResolvedOptions {
  /** Returns the current access token, or `null` if none is available. */
  tokenGetter: () => string | null;
  /** Predicate deciding whether a failed response should trigger a refresh. */
  shouldRefresh: (error: AxiosError, originalRequest: AxiosRequestConfig) => boolean;
}

interface ResolveInput {
  refreshTokenFn: () => Promise<string | null>;
  getAuthToken?: () => string | null;
  accessTokenStore?: AccessTokenStore;
  shouldRefreshToken?: RefreshTokenPluginOptions['shouldRefreshToken'];
  maxRetryAttempts: number;
  retryDelay: number;
}

/**
 * Validate plugin options and resolve the token accessor + refresh predicate.
 *
 * Throws on invalid combinations (both or neither of `getAuthToken` and
 * `accessTokenStore`, out-of-range retry settings). After validation exactly
 * one token source is defined, so `tokenGetter` is unambiguous.
 */
export function resolvePluginOptions(input: ResolveInput): ResolvedOptions {
  const {
    refreshTokenFn,
    getAuthToken,
    accessTokenStore,
    shouldRefreshToken,
    maxRetryAttempts,
    retryDelay,
  } = input;

  if (typeof refreshTokenFn !== 'function') {
    throw new Error('refreshTokenFn must be a function');
  }

  // Mutual exclusion: getAuthToken vs accessTokenStore
  if (accessTokenStore && getAuthToken !== undefined) {
    throw new Error('Cannot provide both getAuthToken and accessTokenStore. Use one or the other.');
  }

  if (!accessTokenStore && getAuthToken === undefined) {
    throw new Error('Either getAuthToken or accessTokenStore must be provided.');
  }

  if (!accessTokenStore && typeof getAuthToken !== 'function') {
    throw new Error('getAuthToken must be a function');
  }

  if (accessTokenStore) {
    if (typeof accessTokenStore.getAccessToken !== 'function') {
      throw new Error('accessTokenStore.getAccessToken must be a function');
    }
    if (typeof accessTokenStore.setAccessToken !== 'function') {
      throw new Error('accessTokenStore.setAccessToken must be a function');
    }
  }

  if (!Number.isInteger(maxRetryAttempts) || maxRetryAttempts < 1) {
    throw new Error('maxRetryAttempts must be an integer greater than or equal to 1');
  }

  if (!Number.isFinite(retryDelay) || retryDelay < 0) {
    throw new Error('retryDelay must be a number greater than or equal to 0');
  }

  // After validation, exactly one of the two is defined.
  const tokenGetter: () => string | null = accessTokenStore
    ? accessTokenStore.getAccessToken
    : (getAuthToken as () => string | null);

  const shouldRefresh =
    shouldRefreshToken ??
    ((error: AxiosError, _originalRequest: AxiosRequestConfig) => {
      if (!tokenGetter()) {
        return false;
      }

      if (!error?.response) {
        return true;
      }

      return error.response.status === 401;
    });

  return { tokenGetter, shouldRefresh };
}
