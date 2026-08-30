import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import { createMockStore } from './helpers/store-mocks';

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

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    // Store was updated
    expect(store.setAccessToken).toHaveBeenCalledWith('new-token');

    // All callbacks fired
    expect(onStatusChange).toHaveBeenCalledWith(
      'refreshing',
      undefined,
      expect.objectContaining({ queueDepth: expect.any(Number), attemptCount: expect.any(Number) }),
    );
    expect(onRefreshStart).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith(
      'success',
      undefined,
      expect.objectContaining({ queueDepth: expect.any(Number), attemptCount: expect.any(Number) }),
    );
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

    plugin.attach(mockAxios);
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
    expect(onStatusChange).toHaveBeenCalledWith(
      'failed',
      expect.any(Error),
      expect.objectContaining({ queueDepth: expect.any(Number), attemptCount: expect.any(Number) }),
    );
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

    plugin.attach(mockAxios);
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
