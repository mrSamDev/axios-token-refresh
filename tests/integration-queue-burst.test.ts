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
  test('retries high concurrency bursts independently without getRequestKey', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onGet('/burst').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      refreshAttempts += 1;
      token = 'fresh-token';
      return [200, { token }];
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

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => {
        return apiClient.get('/burst');
      }),
    );

    expect(refreshAttempts).toBe(1);
    expect(responses).toHaveLength(25);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(apiMock.history.get.length).toBe(50);
  });

  test('deduplicates high concurrency bursts when getRequestKey is provided', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onGet('/burst').reply((config) => {
      if (config.headers?.Authorization === 'Bearer fresh-token') {
        return [200, { ok: true }];
      }
      return [401, { code: 'expired' }];
    });

    authMock.onPost('/refresh').reply(() => {
      refreshAttempts += 1;
      token = 'fresh-token';
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        return response.data.token;
      },
      getRequestKey: (config) => `${config.method}-${config.url}`,
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => {
        return apiClient.get('/burst');
      }),
    );

    expect(refreshAttempts).toBe(1);
    expect(responses).toHaveLength(25);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(apiMock.history.get.length).toBe(26);
  });
});
