import { describe, expect, test, vi } from 'vitest';

import { createHookReporter } from '../src/hook-error';
import { createRefreshTokenPlugin } from '../src/index';
import { authError, createMockAxios, responseErrorHandler } from './helpers/mock-axios';

const throwingCallback = (label: string) =>
  vi.fn(() => {
    throw new Error(label);
  });

describe('createHookReporter', () => {
  test('forwards hook failures to onHookError with the hook name', () => {
    const onHookError = vi.fn();
    const reportHook = createHookReporter(onHookError);

    reportHook('onRefreshSuccess', throwingCallback('success boom'));

    expect(onHookError).toHaveBeenCalledTimes(1);
    expect(onHookError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'success boom' }),
      'onRefreshSuccess',
    );
  });

  test('does nothing when the hook succeeds', () => {
    const onHookError = vi.fn();
    const reportHook = createHookReporter(onHookError);
    const hook = vi.fn();

    reportHook('onRefreshStart', hook);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(onHookError).not.toHaveBeenCalled();
  });

  test('falls back to console.error when onHookError is omitted', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reportHook = createHookReporter();

      reportHook('onRefreshFail', throwingCallback('fail boom'));

      expect(consoleError).toHaveBeenCalledWith(
        '[axios-token-refresh]',
        'onRefreshFail',
        expect.objectContaining({ message: 'fail boom' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  test('falls back to console.error when onHookError itself throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reportHook = createHookReporter(throwingCallback('reporter boom'));

      reportHook('onRefreshFail', throwingCallback('fail boom'));

      expect(consoleError).toHaveBeenCalledWith(
        '[axios-token-refresh]',
        'onRefreshFail',
        expect.objectContaining({ message: 'fail boom' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  test('silent suppresses the console.error fallback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reportHook = createHookReporter(undefined, true);

      reportHook('onRefreshFail', throwingCallback('fail boom'));

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('plugin surfaces hook failures', () => {
  test('onRefreshSuccess throwing reaches onHookError and the queue still drains', async () => {
    const onHookError = vi.fn();
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onRefreshSuccess: throwingCallback('success boom'),
      onHookError,
    }).attach(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(onHookError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'success boom' }),
      'onRefreshSuccess',
    );
  }, 1500);

  test('onStatusChange throwing reaches onHookError', async () => {
    const onHookError = vi.fn();
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onStatusChange: throwingCallback('status boom'),
      onHookError,
    }).attach(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(onHookError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'status boom' }),
      'onStatusChange',
    );
  }, 1500);

  test('onRefreshStart throwing reaches onHookError', async () => {
    const onHookError = vi.fn();
    const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn,
      getAuthToken: () => 'current-token',
      onRefreshStart: throwingCallback('start boom'),
      onHookError,
    }).attach(axios);

    await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
      data: 'retry-success',
    });
    expect(onHookError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'start boom' }),
      'onRefreshStart',
    );
  }, 1500);

  test('silent suppresses the console.error fallback through the plugin', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const refreshTokenFn = vi.fn().mockResolvedValue('new-token');
      const axios = createMockAxios();
      axios.mockResolvedValue({ data: 'retry-success' });
      createRefreshTokenPlugin({
        refreshTokenFn,
        getAuthToken: () => 'current-token',
        onRefreshSuccess: throwingCallback('success boom'),
        silent: true,
      }).attach(axios);

      await expect(responseErrorHandler(axios)(authError('/a'))).resolves.toStrictEqual({
        data: 'retry-success',
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  }, 1500);
});
