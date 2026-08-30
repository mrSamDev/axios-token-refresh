import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';

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

describe('lifecycle hooks', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('onRefreshStart fires when refresh begins', async () => {
    const onRefreshStart = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onRefreshStart,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onRefreshStart).toHaveBeenCalledTimes(1);
  });

  test('onRefreshSuccess fires with the new token', async () => {
    const onRefreshSuccess = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('fresh-token'),
      getAuthToken: () => 'current-token',
      onRefreshSuccess,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onRefreshSuccess).toHaveBeenCalledWith('fresh-token');
  });

  test('onRefreshFail fires when refreshTokenFn throws', async () => {
    const onRefreshFail = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockRejectedValue(new Error('refresh failed')),
      getAuthToken: () => 'current-token',
      onRefreshFail,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(onRefreshFail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'refresh failed' }),
    );
  });

  test('onRefreshFail fires when refreshTokenFn returns null', async () => {
    const onRefreshFail = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      getAuthToken: () => 'current-token',
      onRefreshFail,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(onRefreshFail).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('null') }),
    );
  });
});
