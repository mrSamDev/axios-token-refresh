import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';

const makePlugin = (extra: Record<string, unknown> = {}) =>
  createRefreshTokenPlugin({
    refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
    getAuthToken: () => 'current-token',
    ...extra,
  });

describe('refreshPlugin.attach API', () => {
  test('attach installs interceptors and returns a cleanup function', () => {
    const plugin = makePlugin();
    const axios = createMockAxios();

    const cleanup = plugin.attach(axios);

    expect(axios.interceptors.request.use).toHaveBeenCalled();
    expect(axios.interceptors.response.use).toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
  });

  test('callable form still works (backward compat)', () => {
    const plugin = makePlugin();
    const axios = createMockAxios();

    const cleanup = plugin.attach(axios);

    expect(axios.interceptors.request.use).toHaveBeenCalled();
    expect(axios.interceptors.response.use).toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
  });

  test('callable form emits a deprecation warning exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const plugin = makePlugin();
      const first = createMockAxios();
      const second = createMockAxios();

      plugin(first);
      plugin(second);

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('silent: true suppresses the deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const plugin = makePlugin({ silent: true });
      const axios = createMockAxios();

      plugin.attach(axios);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('attach does not emit the deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const plugin = makePlugin();
      const axios = createMockAxios();

      plugin.attach(axios);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
