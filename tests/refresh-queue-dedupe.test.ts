import { describe, expect, test, vi } from 'vitest';

import { createRefreshQueue, type RetryableRequestConfig } from '../src/refresh-queue';

describe('refresh queue internals', () => {
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

  test('applyAuthHeader leaves config untouched when token is null', () => {
    const queue = createRefreshQueue((token) => `Bearer ${token}`);
    const request = {
      method: 'GET',
      url: '/null-token',
      headers: {},
    } as RetryableRequestConfig;

    const result = queue.applyAuthHeader(request, null, true);

    expect(result).toBe(request);
    expect(result.headers.Authorization).toBeUndefined();

    const bare = {} as RetryableRequestConfig;
    queue.applyAuthHeader(bare, null);
    expect(bare.headers).toBeUndefined();
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
});
