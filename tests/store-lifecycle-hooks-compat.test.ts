import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';

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

describe('lifecycle hooks', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
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

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

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
  });

  test('onStatusChange still works without lifecycle hooks (backward compat)', async () => {
    const onStatusChange = vi.fn();
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('new-token'),
      getAuthToken: () => 'current-token',
      onStatusChange,
    });

    plugin.attach(mockAxios);
    const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onStatusChange).toHaveBeenCalledWith(
      'refreshing',
      undefined,
      expect.objectContaining({ queueDepth: expect.any(Number), attemptCount: expect.any(Number) }),
    );
    expect(onStatusChange).toHaveBeenCalledWith(
      'success',
      undefined,
      expect.objectContaining({ queueDepth: expect.any(Number), attemptCount: expect.any(Number) }),
    );
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

    plugin.attach(mockAxios);
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
