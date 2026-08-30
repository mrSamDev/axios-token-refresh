import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, describe, expect, test } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';

type CleanupContext = {
  cleanup: () => void;
  apiMock: MockAdapter;
  authMock: MockAdapter;
};

const contexts: CleanupContext[] = [];

afterEach(() => {
  while (contexts.length > 0) {
    const ctx = contexts.pop();
    if (!ctx) {
      continue;
    }
    ctx.cleanup();
    ctx.apiMock.restore();
    ctx.authMock.restore();
  }
});

describe('integration: real axios interceptors', () => {
  test('refresh returning null rejects queued requests without retrying', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token: string | null = 'stale-token';

    apiMock.onGet('/nullable').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      token = null;
      return [200, { token: null }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    // null return means auth is over: queue is rejected, no retry.
    await expect(apiClient.get('/nullable')).rejects.toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({
        message: 'Token refresh failed: refreshTokenFn returned null',
      }),
    });
    expect(authMock.history.post.length).toBe(1);
    expect(apiMock.history.get.length).toBe(1);
  });

  test('parks a mid-refresh request and releases it with the fresh token', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';

    apiMock.onGet('/protected').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      token = 'fresh-token';
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        // Slow refresh so a second request lands mid-flight.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    // First request 401s and starts the refresh.
    const first = apiClient.get('/protected');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second request lands mid-refresh: it must be parked, not sent stale.
    const second = apiClient.get('/protected');

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe(200);
    expect(secondResult.status).toBe(200);
    expect(secondResult.data).toStrictEqual({ ok: true });

    // /protected hit exactly 3 times (first 401, its retry, parked release),
    // proving the mid-refresh request was never sent with the stale token.
    // Without the hold it would be 4 (both requests 401 then both retry).
    expect(apiMock.history.get.length).toBe(3);
    expect(authMock.history.post.length).toBe(1);
  });
});
