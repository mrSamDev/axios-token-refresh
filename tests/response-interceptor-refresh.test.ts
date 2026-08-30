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

  describe('Response Interceptor', () => {
    let responseInterceptor: any;

    beforeEach(() => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
      });

      plugin.attach(mockAxios);
      responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
    });

    test('should handle successful response', () => {
      const response = { data: 'test' };
      const successHandler = mockAxios.interceptors.response.use.mock.calls[0][0];

      const result = successHandler(response);

      expect(result).toBe(response);
    });

    test('should refresh token on 401 error', async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          headers: {},
        },
      };

      const promise = responseInterceptor(error);

      // Wait for refresh to start
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRefreshTokenFn).toHaveBeenCalled();
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'refreshing',
        undefined,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );

      // Don't await the promise to avoid hanging
      expect(promise).toBeInstanceOf(Promise);
    });

    test('should not refresh token if no auth token exists', async () => {
      mockGetAuthToken.mockReturnValue(null);

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should not refresh token on non-401 response errors', async () => {
      const error = {
        response: { status: 403 },
        config: {
          method: 'GET',
          url: '/forbidden',
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should refresh on network error when token exists (default shouldRefreshToken)', async () => {
      const error = {
        message: 'Network Error',
        config: {
          method: 'GET',
          url: '/network',
          headers: {},
        },
      };

      const promise = responseInterceptor(error);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
      expect(promise).toBeInstanceOf(Promise);
    });
  });
});
