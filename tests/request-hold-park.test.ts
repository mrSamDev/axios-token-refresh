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
  test('request fired mid-refresh waits and carries the fresh token', async () => {
    const refreshTokenFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('new-token'), 30)),
      );
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-ok' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first'));
    const parked = requestHandler(axios)(config('/parked'));

    let parkedSettled = false;
    void parked.then(() => {
      parkedSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parkedSettled).toBe(false);

    const settledConfig = await parked;
    expect(settledConfig.headers.Authorization).toBe('Bearer new-token');
    await retryPromise;
  }, 1500);

  test('refresh failure rejects the parked request like a queued one', async () => {
    const refreshTokenFn = vi.fn().mockRejectedValue(new Error('refresh down'));
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first'));
    const settled = Promise.allSettled([retryPromise, requestHandler(axios)(config('/parked'))]);

    const [, parkedOutcome] = await settled;
    expect(parkedOutcome.status).toBe('rejected');
    expect((parkedOutcome as PromiseRejectedResult).reason).toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({ message: 'refresh down' }),
    });
  }, 1500);

  test('null refresh token rejects the parked request (auth is over)', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue(null);
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first'));
    const settled = Promise.allSettled([retryPromise, requestHandler(axios)(config('/parked'))]);

    const [, parkedOutcome] = await settled;
    expect(parkedOutcome.status).toBe('rejected');
    expect((parkedOutcome as PromiseRejectedResult).reason).toMatchObject({
      originalError: expect.objectContaining({
        message: 'Token refresh failed: refreshTokenFn returned null',
      }),
    });
  }, 1500);

  test('a non-Error refresh rejection is normalized for parked requests', async () => {
    const refreshTokenFn = vi.fn().mockRejectedValue('not-an-error' as unknown as never);
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first'));
    const settled = Promise.allSettled([retryPromise, requestHandler(axios)(config('/parked'))]);

    const [, parkedOutcome] = await settled;
    expect(parkedOutcome.status).toBe('rejected');
    expect((parkedOutcome as PromiseRejectedResult).reason).toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({
        message: 'Token refresh failed: not-an-error',
      }),
    });
  }, 1500);

  test('cleanup rejects parked requests immediately', async () => {
    const refreshTokenFn = vi.fn(
      () => new Promise<string | null>(() => {}), // hangs until aborted
    );
    const axios = createMockAxios();
    const cleanup = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    }).attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/first'));
    const parked = requestHandler(axios)(config('/parked'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    cleanup();

    await expect(parked).rejects.toMatchObject({
      message: 'Refresh interceptor cleaned up',
    });
    await expect(retryPromise).rejects.toMatchObject({
      message: 'Token refresh failed',
    });
  }, 1500);
});
