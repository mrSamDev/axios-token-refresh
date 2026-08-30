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
