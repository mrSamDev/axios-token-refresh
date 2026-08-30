import { describe, expect, test, vi } from 'vitest';

import { createRefreshPromise } from '../src/refresh-attempts';

describe('createRefreshPromise attempt timers', () => {
  test('clears the attempt timeout after a fast successful refresh', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    try {
      await createRefreshPromise({
        refreshTokenFn: () => Promise.resolve('token'),
        refreshTimeout: 60000,
        maxRetryAttempts: 1,
        retryDelay: 0,
      });

      const scheduledIds = setTimeoutSpy.mock.results.map((result) => result.value);
      expect(scheduledIds).toHaveLength(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(scheduledIds[0]);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  test('clears an attempt timeout per retry', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    try {
      const attempt = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('token');

      await createRefreshPromise({
        refreshTokenFn: attempt,
        refreshTimeout: 60000,
        maxRetryAttempts: 2,
        retryDelay: 0,
      });

      expect(attempt).toHaveBeenCalledTimes(2);
      const scheduledIds = setTimeoutSpy.mock.results.map((result) => result.value);
      expect(scheduledIds).toHaveLength(2);
      for (const timerId of scheduledIds) {
        expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
      }
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });
});
