import { describe, expect, test } from 'vitest';

import { tryCatch } from '../src/try-catch';

describe('tryCatch', () => {
  test('returns success tuple for synchronous operations', () => {
    const result = tryCatch(() => 42);

    expect(result).toStrictEqual([42, null]);
  });

  test('returns failure tuple for synchronous errors', () => {
    const result = tryCatch(() => {
      throw new Error('sync-fail');
    });

    expect(result[0]).toBeNull();
    expect((result[1] as Error)?.message).toBe('sync-fail');
  });

  test('returns success tuple for promise operations', async () => {
    const result = await tryCatch(Promise.resolve('ok'));

    expect(result).toStrictEqual(['ok', null]);
  });

  test('returns failure tuple for rejected promises', async () => {
    const result = await tryCatch(Promise.reject(new Error('async-fail')));

    expect(result[0]).toBeNull();
    expect((result[1] as Error)?.message).toBe('async-fail');
  });
});
