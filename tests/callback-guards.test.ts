import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { authError, createMockAxios, responseErrorHandler } from './helpers/mock-axios';

const throwingCallback = (label: string) =>
  vi.fn(() => {
    throw new Error(label);
  });

describe('user callbacks never strand queued requests', () => {
  test('setAccessToken throwing still resolves the queue and resets the refresh state', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const store = {
      getAccessToken: () => 'current-token',
      setAccessToken: throwingCallback('quota exceeded'),
    };
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({ refreshTokenFn, accessTokenStore: store })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });

    // A second 401 proves isRefreshing was reset; if it were stuck true the
    // request would hang waiting for a refresh that never starts.
    await expect(responseErrorHandler(axios)(authError('/b'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(refreshTokenFn).toHaveBeenCalledTimes(2);
    expect(store.setAccessToken).toHaveBeenCalledTimes(2);
  }, 1500);

  test('clear throwing on the null path still rejects the queue', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue(null);
    const store = {
      getAccessToken: () => 'current-token',
      setAccessToken: () => {},
      clear: throwingCallback('clear failed'),
    };
    const axios = createMockAxios();
    createRefreshTokenPlugin({ refreshTokenFn, accessTokenStore: store })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).rejects.toMatchObject({
      originalError: expect.objectContaining({
        message: 'Token refresh failed: refreshTokenFn returned null',
      }),
    });
  }, 1500);

  test('onStatusChange throwing while refreshing still resolves the queue', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onStatusChange: throwingCallback('status boom'),
    })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    await expect(responseErrorHandler(axios)(authError('/b'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(refreshTokenFn).toHaveBeenCalledTimes(2);
  }, 1500);

  test('onRefreshStart throwing still runs the refresh and resolves the queue', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onRefreshStart: throwingCallback('start boom'),
    })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(refreshTokenFn).toHaveBeenCalledTimes(1);
  }, 1500);

  test('onRefreshSuccess throwing still resolves the queue', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onRefreshSuccess: throwingCallback('success boom'),
    })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
  }, 1500);

  test('onRefreshFail throwing still rejects the queue', async () => {
    const refreshTokenFn = vi.fn().mockRejectedValue(new Error('refresh down'));
    const axios = createMockAxios();
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onRefreshFail: throwingCallback('fail boom'),
    })(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).rejects.toThrow(
      'Token refresh failed',
    );
  }, 1500);

  test('authHeaderFormatter throwing rejects only the poisoned retry, not the queue drain', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    let formatterCalls = 0;
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      authHeaderFormatter: () => {
        formatterCalls += 1;
        // First formatting (request injection) is fine; the retry re-format
        // throws, as if the formatter only chokes on this token.
        if (formatterCalls > 1) {
          throw new Error('formatter boom');
        }
        return 'Bearer current-token';
      },
    })(axios);

    const first = responseErrorHandler(axios)(authError('/a'));
    const second = responseErrorHandler(axios)(authError('/b'));
    // Attach handlers before the refresh settles: a queued rejection must
    // never fire into an unhandled-rejection slot.
    const settled = Promise.allSettled([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [firstOutcome, secondOutcome] = await settled;
    expect(firstOutcome.status).toBe('fulfilled');
    expect(secondOutcome.status).toBe('rejected');
    const secondRejection = secondOutcome as PromiseRejectedResult;
    expect(secondRejection.reason).toMatchObject({ message: 'formatter boom' });
  }, 1500);
});
