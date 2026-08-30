import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import {
  mockRefreshTokenFn,
  mockGetAuthToken,
  mockOnStatusChange,
  mockAuthHeaderFormatter,
} from './helpers/plugin-mocks';

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

describe('createRefreshTokenPlugin', () => {
  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
    mockAxios.request.mockResolvedValue({ data: 'retry-success' });
    mockRefreshTokenFn.mockResolvedValue('new-token');
    mockGetAuthToken.mockReturnValue('current-token');
    mockOnStatusChange.mockImplementation(() => {});
    mockAuthHeaderFormatter.mockImplementation((token) => `Bearer ${token}`);
  });

  describe('Token Refresh Logic', () => {
    let responseInterceptor: any;

    beforeEach(() => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        authHeaderFormatter: mockAuthHeaderFormatter,
      });

      plugin.attach(mockAxios);
      responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
    });

    test('retries refresh and succeeds before maxRetryAttempts', async () => {
      const retryingRefreshTokenFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary refresh failure'))
        .mockResolvedValueOnce('retried-token');

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: retryingRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        maxRetryAttempts: 2,
        retryDelay: 5,
      });

      plugin.attach(mockAxios);
      const responseInterceptorCalls = mockAxios.interceptors.response.use.mock.calls;
      const interceptor = responseInterceptorCalls[responseInterceptorCalls.length - 1][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/retry-success',
          headers: {},
        },
      };

      await interceptor(error);

      expect(retryingRefreshTokenFn).toHaveBeenCalledTimes(2);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'success',
        undefined,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
    });

    test('fails after reaching maxRetryAttempts', async () => {
      const alwaysFailRefreshTokenFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('attempt-1'))
        .mockRejectedValueOnce(new Error('attempt-2'));

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: alwaysFailRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        maxRetryAttempts: 2,
        retryDelay: 5,
      });

      plugin.attach(mockAxios);
      const responseInterceptorCalls = mockAxios.interceptors.response.use.mock.calls;
      const interceptor = responseInterceptorCalls[responseInterceptorCalls.length - 1][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/retry-fail',
          headers: {},
        },
      };

      await expect(interceptor(error)).rejects.toMatchObject({
        message: 'Token refresh failed',
        originalError: expect.objectContaining({ message: 'attempt-2' }),
      });

      expect(alwaysFailRefreshTokenFn).toHaveBeenCalledTimes(2);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'failed',
        expect.objectContaining({ message: 'attempt-2' }),
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
    });

    test('default onStatusChange stays silent (no console.log)', async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin.attach(mockAxios);
      const interceptorCalls = mockAxios.interceptors.response.use.mock.calls;
      const responseInterceptor = interceptorCalls[interceptorCalls.length - 1][1];
      const error = {
        response: { status: 401 },
        config: { method: 'GET', url: '/silent-default', headers: {} },
      };

      await responseInterceptor(error);

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
