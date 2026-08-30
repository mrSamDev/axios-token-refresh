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

describe('accessTokenStore: no clear on thrown error', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('does NOT call clear when refreshTokenFn throws', async () => {
    const store = createMockStore('current-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockRejectedValue(new Error('network down')),
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).not.toHaveBeenCalled();
  });

  test('does NOT call clear when refreshTokenFn throws after all retries', async () => {
    const store = createMockStore('current-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi
        .fn()
        .mockRejectedValueOnce(new Error('attempt-1'))
        .mockRejectedValueOnce(new Error('attempt-2')),
      accessTokenStore: store,
      maxRetryAttempts: 2,
      retryDelay: 5,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).not.toHaveBeenCalled();
  });
});
