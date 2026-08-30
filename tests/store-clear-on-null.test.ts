import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import { createMockStore } from './helpers/store-mocks';

const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeAll(() => {
  console.error = vi.fn();
  console.log = vi.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

describe('accessTokenStore: auto clear on null return', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('calls clear when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).toHaveBeenCalled();
  });

  test('does NOT call setAccessToken when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(store.setAccessToken).not.toHaveBeenCalled();
  });

  test('rejects queued requests when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toMatchObject({
      message: 'Token refresh failed',
    });
  });
});
