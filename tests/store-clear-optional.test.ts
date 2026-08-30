import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AccessTokenStore } from '../src/access-token-store';
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

describe('accessTokenStore: clear is optional', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('does not throw when refreshTokenFn returns null and store has no clear', async () => {
    const storeWithoutClear: AccessTokenStore = {
      getAccessToken: vi.fn().mockReturnValue('token'),
      setAccessToken: vi.fn(),
      // no clear()
    };

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: storeWithoutClear,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    // Should reject gracefully, not throw TypeError
    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
  });
});
