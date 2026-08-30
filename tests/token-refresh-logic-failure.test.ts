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

    test('should handle refresh token failure', async () => {
      const refreshError = new Error('Refresh failed');
      mockRefreshTokenFn.mockRejectedValue(refreshError);

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          headers: {},
        },
      };

      await expect(responseInterceptor(error)).rejects.toMatchObject({
        message: 'Token refresh failed',
        originalError: refreshError,
      });
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'failed',
        refreshError,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
    });

    test('should handle refresh timeout', async () => {
      const slowRefreshFn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('token'), 200)),
        );

      const timeoutMockAxios = createMockAxios();
      timeoutMockAxios.mockImplementation = vi.fn().mockResolvedValue({ data: 'retry-success' });

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: slowRefreshFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        refreshTimeout: 50,
      });

      plugin(timeoutMockAxios);
      const interceptor = timeoutMockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          headers: {},
        },
      };

      await expect(interceptor(error)).rejects.toThrow('Token refresh failed');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'failed',
        expect.any(Error),
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
    }, 10000);
  });
});
