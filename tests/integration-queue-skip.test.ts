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
  test('skipAuthRefresh bypasses refresh flow for a request', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    apiMock.onGet('/public').reply(401, { code: 'auth-required' });
    authMock.onPost('/refresh').reply(200, { token: 'fresh-token' });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post('/refresh');
        token = response.data.token;
        return token;
      },
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    await expect(
      apiClient.get('/public', {
        skipAuthRefresh: true,
      } as any),
    ).rejects.toMatchObject({
      response: {
        status: 401,
      },
    });

    expect(authMock.history.post.length).toBe(0);
  });

  test('getRequestKey can avoid dedupe collisions for same endpoint with different payloads', async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = 'stale-token';
    let refreshAttempts = 0;

    apiMock.onPost('/items').reply((config) => {
      if (config.headers?.Authorization !== 'Bearer fresh-token') {
        return [401, { code: 'expired' }];
      }
      return [200, { echoed: JSON.parse(config.data) }];
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
      getRequestKey: (request) => {
        return `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`;
      },
      onStatusChange: () => {},
    }).attach(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const [first, second] = await Promise.all([
      apiClient.post('/items', { id: 1 }),
      apiClient.post('/items', { id: 2 }),
    ]);

    expect(first.data).toStrictEqual({ echoed: { id: 1 } });
    expect(second.data).toStrictEqual({ echoed: { id: 2 } });
    expect(refreshAttempts).toBe(1);
    expect(apiMock.history.post.length).toBe(4);
  });
});
