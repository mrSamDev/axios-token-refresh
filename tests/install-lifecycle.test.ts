import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';

// Minimal axios-like mock, mirrors the one in index.test.ts but scoped here so
// lifecycle tests stay independent of that file's suite state.
const createMockAxios = () => {
  const instance = vi.fn() as any;

  instance.interceptors = {
    request: {
      handlers: [],
      use: vi.fn((onFulfilled, onRejected) => {
        instance.interceptors.request.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.request.handlers.length - 1;
      }),
      eject: vi.fn((id) => {
        if (id >= 0) instance.interceptors.request.handlers[id] = null;
      }),
    },
    response: {
      handlers: [],
      use: vi.fn((onFulfilled, onRejected) => {
        instance.interceptors.response.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.response.handlers.length - 1;
      }),
      eject: vi.fn((id) => {
        if (id >= 0) instance.interceptors.response.handlers[id] = null;
      }),
    },
  };

  instance.request = vi.fn();
  return instance;
};

const authError = (url: string) => ({
  response: { status: 401 },
  config: {
    method: 'GET',
    url,
    headers: {},
  },
});

const responseErrorHandler = (instance: any) => instance.interceptors.response.use.mock.calls[0][1];

describe('install lifecycle', () => {
  test('cleanup then reinstall on a new instance refreshes normally', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    });

    const firstInstance = createMockAxios();
    const cleanup = plugin(firstInstance);
    cleanup();

    const secondInstance = createMockAxios();
    secondInstance.mockResolvedValue({ data: 'retry-success' });
    plugin(secondInstance);

    const retryPromise = responseErrorHandler(secondInstance)(authError('/after-reinstall'));

    const result = await retryPromise;
    expect(result).toStrictEqual({ data: 'retry-success' });
    expect(refreshTokenFn).toHaveBeenCalledTimes(1);
    expect(secondInstance).toHaveBeenCalledTimes(1);
  }, 1500);

  test('two installs refresh independently and retry through their own instance', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    });

    const firstInstance = createMockAxios();
    const secondInstance = createMockAxios();
    firstInstance.mockResolvedValue({ data: 'retry-first' });
    secondInstance.mockResolvedValue({ data: 'retry-second' });
    plugin(firstInstance);
    plugin(secondInstance);

    const firstRetry = responseErrorHandler(firstInstance)(authError('/first'));
    const secondRetry = responseErrorHandler(secondInstance)(authError('/second'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshTokenFn).toHaveBeenCalledTimes(2);

    const [firstResult, secondResult] = await Promise.all([firstRetry, secondRetry]);
    expect(firstResult).toStrictEqual({ data: 'retry-first' });
    expect(secondResult).toStrictEqual({ data: 'retry-second' });

    expect(firstInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/first',
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
    expect(secondInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/second',
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
  }, 1500);

  test('cleanup rejects only the cleaned-up install queue', async () => {
    const refreshTokenFn = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('new-token'), 50)),
    );
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    });

    const firstInstance = createMockAxios();
    const secondInstance = createMockAxios();
    secondInstance.mockResolvedValue({ data: 'retry-second' });
    const cleanupFirst = plugin(firstInstance);
    plugin(secondInstance);

    const firstRetry = responseErrorHandler(firstInstance)(authError('/first'));
    const secondRetry = responseErrorHandler(secondInstance)(authError('/second'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    cleanupFirst();

    await expect(firstRetry).rejects.toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({ message: 'Refresh interceptor cleaned up' }),
    });
    await expect(secondRetry).resolves.toStrictEqual({ data: 'retry-second' });
    expect(refreshTokenFn).toHaveBeenCalledTimes(2);
  }, 1500);
});
