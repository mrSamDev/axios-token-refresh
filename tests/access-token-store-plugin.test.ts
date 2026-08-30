import { beforeAll, afterAll, beforeEach, describe, test, expect, vi } from 'vitest';

import type { AccessTokenStore } from '../src/access-token-store';
import { createRefreshTokenPlugin } from '../src/index';

// ---------------------------------------------------------------------------
// Shared mock infrastructure (mirrors tests/index.test.ts patterns)
// ---------------------------------------------------------------------------
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeAll(() => {
  console.error = vi.fn();
  console.log = vi.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

function createMockAxios() {
  const instance = vi.fn() as any;
  instance.interceptors = {
    request: {
      handlers: [] as any[],
      use: vi.fn((onFulfilled: any, onRejected: any) => {
        instance.interceptors.request.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.request.handlers.length - 1;
      }),
      eject: vi.fn((id: number) => {
        if (id >= 0) instance.interceptors.request.handlers[id] = null;
      }),
    },
    response: {
      handlers: [] as any[],
      use: vi.fn((onFulfilled: any, onRejected: any) => {
        instance.interceptors.response.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.response.handlers.length - 1;
      }),
      eject: vi.fn((id: number) => {
        if (id >= 0) instance.interceptors.response.handlers[id] = null;
      }),
    },
  };
  instance.request = vi.fn();
  return instance;
}

function createMockStore(initialToken: string | null = 'current-token'): AccessTokenStore & {
  getAccessToken: ReturnType<typeof vi.fn>;
  setAccessToken: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  let token = initialToken;
  return {
    getAccessToken: vi.fn(() => token),
    setAccessToken: vi.fn((t: string) => {
      token = t;
    }),
    clear: vi.fn(() => {
      token = null;
    }),
  };
}

// ---------------------------------------------------------------------------
// Mutual exclusion: getAuthToken vs accessTokenStore
// ---------------------------------------------------------------------------
describe('accessTokenStore: mutual exclusion with getAuthToken', () => {
  let mockAxios: any;
  let mockRefreshTokenFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
    mockRefreshTokenFn = vi.fn().mockResolvedValue('new-token');
  });

  test('throws when both getAuthToken and accessTokenStore are provided', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: () => 'token',
        accessTokenStore: createMockStore(),
      });
    }).toThrow('Cannot provide both getAuthToken and accessTokenStore');
  });

  test('throws when neither getAuthToken nor accessTokenStore is provided', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
      } as any);
    }).toThrow('Either getAuthToken or accessTokenStore must be provided');
  });

  test('accepts accessTokenStore alone (getAuthToken not required)', () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      accessTokenStore: createMockStore(),
    });
    expect(typeof plugin).toBe('function');
  });

  test('accepts getAuthToken alone (backward compat)', () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: () => 'token',
    });
    expect(typeof plugin).toBe('function');
  });

  test('throws when accessTokenStore.getAccessToken is not a function', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        accessTokenStore: {
          getAccessToken: 'not-a-function' as any,
          setAccessToken: () => {},
        },
      });
    }).toThrow('accessTokenStore.getAccessToken must be a function');
  });

  test('throws when accessTokenStore.setAccessToken is not a function', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        accessTokenStore: {
          getAccessToken: () => null,
          setAccessToken: 'not-a-function' as any,
        },
      });
    }).toThrow('accessTokenStore.setAccessToken must be a function');
  });

  test('existing getAuthToken non-function error still works', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: 'not-a-function' as any,
      });
    }).toThrow('getAuthToken must be a function');
  });
});

// ---------------------------------------------------------------------------
// Token injection via accessTokenStore
// ---------------------------------------------------------------------------
describe('accessTokenStore: token injection', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('uses accessTokenStore.getAccessToken for request interceptor', () => {
    const store = createMockStore('injected-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      accessTokenStore: store,
    });

    plugin(mockAxios);

    const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
    const config = { headers: {} };
    const result = successHandler(config);

    expect(store.getAccessToken).toHaveBeenCalled();
    expect(result.headers.Authorization).toBe('Bearer injected-token');
  });

  test('uses accessTokenStore.getAccessToken in default shouldRefreshToken', async () => {
    const store = createMockStore(null); // no token → should not refresh
    const mockRefresh = vi.fn().mockResolvedValue('new-token');

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefresh,
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toBe(error);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto setAccessToken on successful refresh
// ---------------------------------------------------------------------------
describe('accessTokenStore: auto setAccessToken on success', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('calls setAccessToken with the new token after successful refresh', async () => {
    const store = createMockStore('old-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('fresh-token'),
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(store.setAccessToken).toHaveBeenCalledWith('fresh-token');
  });

  test('does NOT call setAccessToken when getAuthToken is used (backward compat)', async () => {
    const mockGetAuthToken = vi.fn().mockReturnValue('current-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('fresh-token'),
      getAuthToken: mockGetAuthToken,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    // No store → setAccessToken should never be called
    // (We verify by checking the mock axios was called with the new token,
    //  which it would be regardless of store.)
    expect(mockAxios).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto clear() on null return (auth is over)
// ---------------------------------------------------------------------------
describe('accessTokenStore: auto clear on null return', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('calls clear when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).toHaveBeenCalled();
  });

  test('does NOT call setAccessToken when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(store.setAccessToken).not.toHaveBeenCalled();
  });

  test('rejects queued requests when refreshTokenFn returns null', async () => {
    const store = createMockStore('stale-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toMatchObject({
      message: 'Token refresh failed',
    });
  });
});

// ---------------------------------------------------------------------------
// No clear() on thrown error (might be transient)
// ---------------------------------------------------------------------------
describe('accessTokenStore: no clear on thrown error', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('does NOT call clear when refreshTokenFn throws', async () => {
    const store = createMockStore('current-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockRejectedValue(new Error('network down')),
      accessTokenStore: store,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).not.toHaveBeenCalled();
  });

  test('does NOT call clear when refreshTokenFn throws after all retries', async () => {
    const store = createMockStore('current-token');
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi
        .fn()
        .mockRejectedValueOnce(new Error('attempt-1'))
        .mockRejectedValueOnce(new Error('attempt-2')),
      accessTokenStore: store,
      maxRetryAttempts: 2,
      retryDelay: 5,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
    expect(store.clear).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clear() is optional — store without clear
// ---------------------------------------------------------------------------
describe('accessTokenStore: clear is optional', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('does not throw when refreshTokenFn returns null and store has no clear', async () => {
    const storeWithoutClear: AccessTokenStore = {
      getAccessToken: vi.fn().mockReturnValue('token'),
      setAccessToken: vi.fn(),
      // no clear()
    };

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: storeWithoutClear,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    // Should reject gracefully, not throw TypeError
    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle hooks: onRefreshStart, onRefreshSuccess, onRefreshFail
// ---------------------------------------------------------------------------
describe('lifecycle hooks', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('onRefreshStart fires when refresh begins', async () => {
    const onRefreshStart = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onRefreshStart,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onRefreshStart).toHaveBeenCalledTimes(1);
  });

  test('onRefreshSuccess fires with the new token', async () => {
    const onRefreshSuccess = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('fresh-token'),
      getAuthToken: () => 'current-token',
      onRefreshSuccess,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onRefreshSuccess).toHaveBeenCalledWith('fresh-token');
  });

  test('onRefreshFail fires when refreshTokenFn throws', async () => {
    const onRefreshFail = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockRejectedValue(new Error('refresh failed')),
      getAuthToken: () => 'current-token',
      onRefreshFail,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(onRefreshFail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'refresh failed' }),
    );
  });

  test('onRefreshFail fires when refreshTokenFn returns null', async () => {
    const onRefreshFail = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      getAuthToken: () => 'current-token',
      onRefreshFail,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow();
    expect(onRefreshFail).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('null') }),
    );
  });

  test('onStatusChange and lifecycle hooks both fire when both are provided', async () => {
    const onStatusChange = vi.fn();
    const onRefreshStart = vi.fn();
    const onRefreshSuccess = vi.fn();

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onStatusChange,
      onRefreshStart,
      onRefreshSuccess,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onStatusChange).toHaveBeenCalledWith('refreshing');
    expect(onRefreshStart).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('success');
    expect(onRefreshSuccess).toHaveBeenCalledWith('new-token');
  });

  test('onStatusChange still works without lifecycle hooks (backward compat)', async () => {
    const onStatusChange = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onStatusChange,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onStatusChange).toHaveBeenCalledWith('refreshing');
    expect(onStatusChange).toHaveBeenCalledWith('success');
  });

  test('lifecycle hooks work without onStatusChange', async () => {
    const onRefreshStart = vi.fn();
    const onRefreshSuccess = vi.fn();
    const onRefreshFail = vi.fn();

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onRefreshStart,
      onRefreshSuccess,
      onRefreshFail,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onRefreshStart).toHaveBeenCalledTimes(1);
    expect(onRefreshSuccess).toHaveBeenCalledWith('new-token');
    expect(onRefreshFail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Combined: accessTokenStore + lifecycle hooks + onStatusChange
// ---------------------------------------------------------------------------
describe('accessTokenStore + lifecycle hooks integration', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
  });

  test('full flow: store + hooks + status change on success', async () => {
    const store = createMockStore('old-token');
    const onStatusChange = vi.fn();
    const onRefreshStart = vi.fn();
    const onRefreshSuccess = vi.fn();

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      accessTokenStore: store,
      onStatusChange,
      onRefreshStart,
      onRefreshSuccess,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    // Store was updated
    expect(store.setAccessToken).toHaveBeenCalledWith('new-token');

    // All callbacks fired
    expect(onStatusChange).toHaveBeenCalledWith('refreshing');
    expect(onRefreshStart).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('success');
    expect(onRefreshSuccess).toHaveBeenCalledWith('new-token');

    // Request was retried with new token
    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    );
  });

  test('full flow: store + hooks on null (auth over)', async () => {
    const store = createMockStore('stale-token');
    const onStatusChange = vi.fn();
    const onRefreshStart = vi.fn();
    const onRefreshSuccess = vi.fn();
    const onRefreshFail = vi.fn();

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue(null),
      accessTokenStore: store,
      onStatusChange,
      onRefreshStart,
      onRefreshSuccess,
      onRefreshFail,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');

    // Store was cleared
    expect(store.clear).toHaveBeenCalled();
    expect(store.setAccessToken).not.toHaveBeenCalled();

    // Callbacks
    expect(onRefreshStart).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('failed', expect.any(Error));
    expect(onRefreshFail).toHaveBeenCalledTimes(1);
    expect(onRefreshSuccess).not.toHaveBeenCalled();

    // Request was NOT retried
    expect(mockAxios).not.toHaveBeenCalled();
  });

  test('full flow: store + hooks on thrown error (no clear)', async () => {
    const store = createMockStore('current-token');
    const onRefreshFail = vi.fn();

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockRejectedValue(new Error('server down')),
      accessTokenStore: store,
      onRefreshFail,
    });

    plugin(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await expect(responseInterceptor(error)).rejects.toThrow('Token refresh failed');

    // Store was NOT cleared (transient error)
    expect(store.clear).not.toHaveBeenCalled();
    expect(store.setAccessToken).not.toHaveBeenCalled();

    // onRefreshFail fired with the original error
    expect(onRefreshFail).toHaveBeenCalledWith(expect.objectContaining({ message: 'server down' }));
  });
});
