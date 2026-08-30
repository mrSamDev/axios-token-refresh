import { describe, expect, test } from 'vitest';

import { createRequestHold } from '../src/request-hold';

describe('createRequestHold unit', () => {
  test('park wraps a non-Error refresh rejection as RefreshFailedError', async () => {
    const hold = createRequestHold({
      getRefreshPromise: () => Promise.reject('boom') as Promise<string | null>,
      tokenGetter: () => 'token',
      authHeaderFormatter: (token) => `Bearer ${token}`,
      autoInjectToken: true,
      pauseRequestsWhileRefreshing: true,
    });

    const error = await hold.interceptor({ headers: {} } as never).catch((e: unknown) => e);
    expect(error).toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({ message: 'Token refresh failed' }),
    });
  });
});
