import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { authError, createMockAxios, responseErrorHandler } from './helpers/mock-axios';

describe('install lifecycle', () => {
  test('cleanup then reinstall on a new instance refreshes normally', async () => {
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    });

    const firstInstance = createMockAxios();
    const cleanup = plugin.attach(firstInstance);
    cleanup();

    const secondInstance = createMockAxios();
    secondInstance.mockResolvedValue({ data: 'retry-success' });
    plugin.attach(secondInstance);

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
    plugin.attach(firstInstance);
    plugin.attach(secondInstance);

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
    const cleanupFirst = plugin.attach(firstInstance);
    plugin.attach(secondInstance);

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

  test('cleanup aborts the in-flight refresh attempt', async () => {
    const seenSignals: AbortSignal[] = [];
    const refreshTokenFn = vi.fn((signal: AbortSignal) => {
      seenSignals.push(signal);
      return new Promise<string | null>(() => {});
    });
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
    });

    const axios = createMockAxios();
    const cleanup = plugin.attach(axios);

    const retryPromise = responseErrorHandler(axios)(authError('/aborted-on-cleanup'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    cleanup();

    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0].aborted).toBe(true);
    await expect(retryPromise).rejects.toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({ message: 'Refresh interceptor cleaned up' }),
    });
  }, 1500);

  test('cleanup skips the request interceptor eject when none was installed', () => {
    const axios = createMockAxios();
    const cleanup = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      autoInjectToken: false,
      pauseRequestsWhileRefreshing: false,
    }).attach(axios);

    expect(axios.interceptors.request.use).not.toHaveBeenCalled();

    expect(() => cleanup()).not.toThrow();
    expect(axios.interceptors.request.eject).not.toHaveBeenCalled();
    expect(axios.interceptors.response.eject).toHaveBeenCalledWith(0);
  });
});
