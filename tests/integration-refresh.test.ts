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
  test('retries refreshTokenFn and succeeds before maxRetryAttempts', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onGet('/protected').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      refreshAttempts += 1;
      if (refreshAttempts < 2) {
        return [500, { error: 'temporary' }];
      }
      token = 'fresh-token';
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      maxRetryAttempts: 2,
      retryDelay: 30,
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const startedAt = Date.now();
    const response = await apiClient.get('/protected');
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.data).toStrictEqual({ ok: true });
    expect(refreshAttempts).toBe(2);
    expect(elapsedMs).toBeGreaterThanOrEqual(25);
  });

  test('rejects queued request after maxRetryAttempts is exhausted', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onGet('/protected').reply(401, { code: 'expired' });

    authMock.onPost('/refresh').reply(() => {
      refreshAttempts += 1;
      return [500, { error: 'still-broken' }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      maxRetryAttempts: 2,
      retryDelay: 10,
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    await expect(apiClient.get('/protected')).rejects.toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.any(Error),
    });
    expect(refreshAttempts).toBe(2);
  });

  test('timeout retries are bounded and delayed before succeeding', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onGet('/timed').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      refreshAttempts += 1;
      if (refreshAttempts < 3) {
        return new Promise((resolve) => {
          setTimeout(() => resolve([200, { token: 'late-token' }]), 60);
        });
      }
      token = 'fresh-token';
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      refreshTimeout: 30,
      maxRetryAttempts: 3,
      retryDelay: 20,
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const startedAt = Date.now();
    const response = await apiClient.get('/timed');
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(refreshAttempts).toBe(3);
    expect(elapsedMs).toBeGreaterThanOrEqual(90);
  });
});
