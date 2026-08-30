import { describe, expect, test } from 'vitest';

import {
  createLocalStorageTokenStore,
  createRefreshTokenPlugin,
  createSessionStorageTokenStore,
  type AccessTokenStore,
  type RefreshFailedError,
  type RefreshStatus,
  type RefreshTokenPluginOptions,
  type RetryableRequestConfig,
} from '../src/index';

describe('public API surface', () => {
  test('exports runtime values', () => {
    expect(typeof createRefreshTokenPlugin).toBe('function');
    expect(typeof createLocalStorageTokenStore).toBe('function');
    expect(typeof createSessionStorageTokenStore).toBe('function');
  });

  test('exports types users need in annotations', () => {
    const store: AccessTokenStore = {
      getAccessToken: () => null,
      setAccessToken: () => {},
      clear: () => {},
    };

    const requestConfig: RetryableRequestConfig = {
      url: '/flagged',
      headers: {} as RetryableRequestConfig['headers'],
      skipAuthRefresh: true,
      _retry: false,
    };

    const refreshFailure: RefreshFailedError = Object.assign(new Error('Token refresh failed'), {
      originalError: new Error('root cause'),
    });

    const status: RefreshStatus = 'refreshing';

    const options: RefreshTokenPluginOptions = {
      refreshTokenFn: async () => 'token',
      accessTokenStore: store,
    };

    expect(requestConfig.skipAuthRefresh).toBe(true);
    expect(refreshFailure.originalError?.message).toBe('root cause');
    expect(status).toBe('refreshing');
    expect(options.refreshTokenFn).toBeInstanceOf(Function);
  });
});
