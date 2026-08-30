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

describe('Queue handling', () => {
  const mockRefreshTokenFn = vi.fn();
  const mockGetAuthToken = vi.fn();

  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
    mockAxios.request.mockResolvedValue({ data: 'retry-success' });
    mockRefreshTokenFn.mockResolvedValue('queue-token');
    mockGetAuthToken.mockReturnValue('current-token');
  });
  test('retries simultaneous requests independently when no getRequestKey is given', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: 'GET', url: '/same' },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: 'GET', url: '/same' },
    };

    const [result1, result2] = await Promise.all([
      responseInterceptor(error1),
      responseInterceptor(error2),
    ]);

    expect(result1).toStrictEqual({ data: 'retry-success' });
    expect(result2).toStrictEqual({ data: 'retry-success' });
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(2);
  });

  test('retries same-key requests with different bodies independently (regression)', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: 'POST', url: '/submit', data: { payload: 1 } },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: 'POST', url: '/submit', data: { payload: 2 } },
    };

    const [result1, result2] = await Promise.all([
      responseInterceptor(error1),
      responseInterceptor(error2),
    ]);

    expect(result1).toStrictEqual({ data: 'retry-success' });
    expect(result2).toStrictEqual({ data: 'retry-success' });
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(2);
  });

  test('resolves queued requests with new token', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/queue', headers: {} },
    };

    const promise = responseInterceptor(error);

    await promise;

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer queue-token' }),
      }),
    );
  });

  test('uses custom getRequestKey for dedupe', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      getRequestKey: () => 'same-custom-key',
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: 'GET', url: '/first', params: { a: 1 } },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: 'GET', url: '/second', params: { b: 2 } },
    };

    const [result1, result2] = await Promise.all([
      responseInterceptor(error1),
      responseInterceptor(error2),
    ]);

    expect(result1).toStrictEqual(result2);
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(1);
  });

  test('custom getRequestKey can prevent dedupe collisions', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      getRequestKey: (request) =>
        `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: 'POST', url: '/same', data: { payload: 1 } },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: 'POST', url: '/same', data: { payload: 2 } },
    };

    await Promise.all([responseInterceptor(error1), responseInterceptor(error2)]);

    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(2);
  });
});
