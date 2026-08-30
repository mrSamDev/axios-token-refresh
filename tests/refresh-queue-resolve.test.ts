import { describe, expect, test, vi } from 'vitest';

import { createRefreshQueue, type RetryableRequestConfig } from '../src/refresh-queue';

describe('refresh queue internals', () => {
  const trackPeakConcurrency = () => {
    const state = { active: 0, peak: 0 };
    const request = vi.fn(async () => {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.active -= 1;
      return { data: 'ok' };
    });
    return { state, request };
  };
  test('enqueue rejects with a distinct error once maxQueueSize is reached', async () => {
    const queue = createRefreshQueue(
      (token) => `Bearer ${token}`,
      undefined,
      Number.POSITIVE_INFINITY,
      2,
    );
    const first = queue.enqueue({ headers: {} } as RetryableRequestConfig);
    const second = queue.enqueue({ headers: {} } as RetryableRequestConfig);
    const third = queue.enqueue({ headers: {} } as RetryableRequestConfig);

    await expect(third).rejects.toThrow('Token refresh queue is full');

    // Earlier queued requests still drain normally.
    const axiosLike = { request: vi.fn().mockResolvedValue({ data: 'ok' }) } as any;
    queue.resolve('new-token', axiosLike);
    await Promise.all([first, second]);
    expect(axiosLike.request).toHaveBeenCalledTimes(2);
  });

  test('resolve retries with the fresh token without mutating the original request headers', async () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const originalHeaders = { Authorization: 'Bearer stale-token' };
    const request = {
      method: 'GET',
      url: '/aliasing',
      headers: originalHeaders,
    } as RetryableRequestConfig;

    const retryPromise = queue.enqueue(request);
    const axiosLike = { request: vi.fn().mockResolvedValue({ data: 'ok' }) } as any;

    queue.resolve('new-token', axiosLike);
    await retryPromise;

    expect(axiosLike.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
    expect(originalHeaders.Authorization).toBe('Bearer stale-token');
  });

  test('normalizes non-Error values passed to reject', async () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const request = {
      method: 'GET',
      url: '/reject',
      headers: {},
    } as RetryableRequestConfig;

    const retryPromise = queue.enqueue(request);
    queue.reject('not-an-error');

    await expect(retryPromise).rejects.toMatchObject({
      message: 'Token refresh failed',
      originalError: expect.objectContaining({ message: 'Token refresh failed' }),
    });
  });

  test('reset clears queued request dedupe map', () => {
    const queue = createRefreshQueue(
      (token) => `Bearer ${token}`,
      () => 'same-key',
    );
    const request = {
      method: 'GET',
      url: '/reset',
      headers: {},
    } as RetryableRequestConfig;

    const first = queue.enqueue(request);
    queue.reset();
    const second = queue.enqueue(request);

    expect(first).not.toBe(second);
  });

  test('falls back to axiosInstance.request when instance is not callable', async () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const request = {
      method: 'GET',
      url: '/fallback',
      headers: {},
    } as RetryableRequestConfig;

    const retryPromise = queue.enqueue(request);
    const axiosLike = {
      request: vi.fn().mockResolvedValue({ data: 'ok' }),
    } as any;

    queue.resolve('new-token', axiosLike);
    const result = await retryPromise;

    expect(axiosLike.request).toHaveBeenCalledTimes(1);
    expect(axiosLike.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
    expect(result).toStrictEqual({ data: 'ok' });
  });

  test('caps in-flight retries at maxConcurrentRetries', async () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`, undefined, 2);
    const { state, request } = trackPeakConcurrency();
    const axiosLike = { request } as any;

    const retryPromises = Array.from({ length: 6 }, (_, index) =>
      queue.enqueue({
        method: 'GET',
        url: `/capped-${index}`,
        headers: {},
      } as RetryableRequestConfig),
    );

    queue.resolve('new-token', axiosLike);
    await Promise.all(retryPromises);

    expect(request).toHaveBeenCalledTimes(6);
    expect(state.peak).toBeLessThanOrEqual(2);
  });

  test('fires all retries at once by default (no concurrency cap)', async () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const { state, request } = trackPeakConcurrency();
    const axiosLike = { request } as any;

    const retryPromises = Array.from({ length: 6 }, (_, index) =>
      queue.enqueue({
        method: 'GET',
        url: `/burst-${index}`,
        headers: {},
      } as RetryableRequestConfig),
    );

    queue.resolve('new-token', axiosLike);
    await Promise.all(retryPromises);

    expect(request).toHaveBeenCalledTimes(6);
    expect(state.peak).toBe(6);
  });
});
