import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import {
  authError,
  createMockAxios,
  requestHandler,
  responseErrorHandler,
} from './helpers/mock-axios';

const config = (url: string) => ({
  method: 'GET',
  url,
  headers: {},
});

describe('request hold while refreshing', () => {
  test('skipAuthRefresh requests are never parked', async () => {
    const refreshTokenFn = vi.fn(() => new Promise<string | null>(() => {}));
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    void responseErrorHandler(axios)(authError('/first')).catch(() => {});

    const skipConfig = { ...config('/login'), skipAuthRefresh: true };
    const result = await requestHandler(axios)(skipConfig);
    expect(result.headers.Authorization).toBe('Bearer current-token');
  }, 1500);

  test('autoInjectToken false still parks but never injects', async () => {
    const refreshTokenFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('new-token'), 20)),
      );
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      autoInjectToken: false,
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first')).catch(() => {});
    const parked = requestHandler(axios)(config('/parked'));

    let parkedSettled = false;
    void parked.then(() => {
      parkedSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parkedSettled).toBe(false);

    const settledConfig = await parked;
    expect(settledConfig.headers.Authorization).toBeUndefined();
    await retryPromise;
  }, 1500);

  test('tokenless requests are never parked', async () => {
    const refreshTokenFn = vi.fn(() => new Promise<string | null>(() => {}));
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => null,
      // Custom predicate keeps a refresh in flight even without a token,
      // the scenario where a tokenless public request would get parked.
      shouldRefreshToken: () => true,
    }).attach(axios);

    void responseErrorHandler(axios)(authError('/first')).catch(() => {});

    // A public request during an unrelated refresh must not be held hostage.
    const result = await requestHandler(axios)(config('/public'));
    expect(result.headers.Authorization).toBeUndefined();
  }, 1500);

  test('pauseRequestsWhileRefreshing false sends immediately with the current token', async () => {
    const refreshTokenFn = vi.fn(() => new Promise<string | null>(() => {}));
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      pauseRequestsWhileRefreshing: false,
    }).attach(axios);

    void responseErrorHandler(axios)(authError('/first')).catch(() => {});

    const result = await requestHandler(axios)(config('/immediate'));
    expect(result.headers.Authorization).toBe('Bearer current-token');
  }, 1500);
});
