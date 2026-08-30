import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  createLocalStorageTokenStore,
  createRefreshTokenPlugin,
  createSessionStorageTokenStore,
  type AccessTokenStore,
  type RefreshFailedError,
  type RefreshPlugin,
  type RefreshStatus,
  type RefreshStatusContext,
  type RefreshTokenPluginOptions,
  type RetryableRequestConfig,
} from '../src/index';

describe('public API surface', () => {
  test('declares a peer dependency range the code actually supports', () => {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const { peerDependencies } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    // The source imports InternalAxiosRequestConfig, which exists only in
    // axios v1; a range below 1.0.0 promises types we cannot deliver, and an
    // unbounded upper range would silently break on axios 2.x.
    expect(peerDependencies.axios).toBe('>=1.0.0 <2.0.0');
  });

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
