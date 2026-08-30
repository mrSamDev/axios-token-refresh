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

describe('accessTokenStore: token injection', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('uses accessTokenStore.getAccessToken for request interceptor', async () => {
    const store = createMockStore('injected-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);

    const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
    const config = { headers: {} };
    const result = await successHandler(config);

    expect(store.getAccessToken).toHaveBeenCalled();
    expect(result.headers.Authorization).toBe('Bearer injected-token');
  });

  test('uses accessTokenStore.getAccessToken in default shouldRefreshToken', async () => {
    const store = createMockStore(null); // no token → should not refresh
    const mockRefresh = vi.fn().mockResolvedValue('new-token');

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefresh,
      accessTokenStore: store,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toBe(error);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
