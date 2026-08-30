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
  test('does not dedupe when getRequestKey is not provided', () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const request = {
      headers: {},
    } as RetryableRequestConfig;

    const first = queue.enqueue(request);
    const second = queue.enqueue({
      headers: {},
    } as RetryableRequestConfig);

    expect(first).not.toBe(second);
  });

  test('dedupes when getRequestKey returns the same key', () => {
    const queue = createRefreshQueue(
      (token) => `Bearer ${token}`,
      () => 'same-key',
    );
    const request = {
      method: 'GET',
      url: '/dedupe',
      headers: {},
    } as RetryableRequestConfig;

    const first = queue.enqueue(request);
    const second = queue.enqueue({
      method: 'GET',
      url: '/other',
      headers: {},
    } as RetryableRequestConfig);

    expect(first).toBe(second);
  });

  test('respects empty-string key from getRequestKey', () => {
    const queue = createRefreshQueue(
      (token) => `Bearer ${token}`,
      () => '',
    );
    const request = {
      headers: {},
    } as RetryableRequestConfig;

    const first = queue.enqueue(request);
    const second = queue.enqueue({ headers: {} } as RetryableRequestConfig);

    expect(first).toBe(second);
  });

  test('does not overwrite existing authorization header unless forced', () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const request = {
      headers: {
        Authorization: 'Bearer existing-token',
      },
    } as RetryableRequestConfig;

    const updated = queue.applyAuthHeader(request, 'new-token');
    expect(updated.headers.Authorization).toBe('Bearer existing-token');
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
