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
      }).promise;

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
      }).promise;

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

describe('createRefreshPromise abort signal', () => {
  const neverSettles = () => new Promise<string | null>(() => {});

  test('timeout aborts the signal passed to refreshTokenFn', async () => {
    const seenSignals: AbortSignal[] = [];
    const refreshTokenFn = vi.fn((signal: AbortSignal) => {
      seenSignals.push(signal);
      return neverSettles();
    });

    await expect(
      createRefreshPromise({
        refreshTokenFn,
        refreshTimeout: 10,
        maxRetryAttempts: 1,
        retryDelay: 0,
      }).promise,
    ).rejects.toThrow('Token refresh timeout');

    expect(seenSignals[0].aborted).toBe(true);
  });

  test('a successful attempt leaves the signal un-aborted', async () => {
    const seenSignals: AbortSignal[] = [];
    const refreshTokenFn = vi.fn((signal: AbortSignal) => {
      seenSignals.push(signal);
      return Promise.resolve('token');
    });

    const token = await createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 60000,
      maxRetryAttempts: 1,
      retryDelay: 0,
    }).promise;

    expect(token).toBe('token');
    expect(seenSignals[0].aborted).toBe(false);
  });

  test('each retry attempt receives a fresh, un-aborted signal', async () => {
    const seenSignals: AbortSignal[] = [];
    const refreshTokenFn = vi.fn((signal: AbortSignal) => {
      seenSignals.push(signal);
      // First attempt hangs until its timeout; the second succeeds.
      if (seenSignals.length === 1) {
        return neverSettles();
      }
      return Promise.resolve('token');
    });

    const token = await createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 10,
      maxRetryAttempts: 2,
      retryDelay: 0,
    }).promise;

    expect(token).toBe('token');
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[0].aborted).toBe(true);
    expect(seenSignals[1].aborted).toBe(false);
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
  });

  test('abort() rejects the refresh and aborts the in-flight attempt', async () => {
    const seenSignals: AbortSignal[] = [];
    const refreshTokenFn = vi.fn((signal: AbortSignal) => {
      seenSignals.push(signal);
      return neverSettles();
    });

    const handle = createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 60000,
      maxRetryAttempts: 1,
      retryDelay: 0,
    });

    handle.abort();
    await expect(handle.promise).rejects.toThrow('Token refresh aborted');
    expect(seenSignals[0].aborted).toBe(true);
  });

  test('abort() during retryDelay stops the loop before the next attempt', async () => {
    const refreshTokenFn = vi
      .fn<(signal: AbortSignal) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('token');

    const handle = createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 60000,
      maxRetryAttempts: 2,
      retryDelay: 500,
    });

    // Wait for the first attempt to fail and the delay to start.
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.abort();

    await expect(handle.promise).rejects.toThrow('Token refresh aborted');
    expect(refreshTokenFn).toHaveBeenCalledTimes(1);
  });

  test('a non-Error rejection normalizes to an Error before leaving the loop', async () => {
    const refreshTokenFn = vi.fn().mockRejectedValue('backend on fire');

    const handle = createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 60000,
      maxRetryAttempts: 1,
      retryDelay: 0,
    });

    const rejection = await handle.promise.then(
      () => {
        throw new Error('expected a rejection');
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('backend on fire');
  });

  test('a second abort() is a no-op and the promise settles once', async () => {
    const refreshTokenFn = vi.fn((_signal: AbortSignal) => neverSettles());

    const handle = createRefreshPromise({
      refreshTokenFn,
      refreshTimeout: 60000,
      maxRetryAttempts: 1,
      retryDelay: 0,
    });

    handle.abort();
    handle.abort();

    await expect(handle.promise).rejects.toThrow('Token refresh aborted');
  });
});
