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

    test('does not mutate the original request config with _retry', async () => {
      const config = {
        method: 'GET',
        url: '/test',
        headers: {},
      };
      const error = { response: { status: 401 }, config };

      await responseInterceptor(error);

      expect(config).not.toHaveProperty('_retry');
    });

    test('retried request carries _retry to prevent a second refresh', async () => {
      const config = {
        method: 'GET',
        url: '/test',
        headers: {},
      };
      const error = { response: { status: 401 }, config };

      await responseInterceptor(error);

      const retriedConfig = mockAxios.mock.calls[0][0];
      expect(retriedConfig._retry).toBe(true);
    });

    test('should not retry request twice', async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          headers: {},
          _retry: true, // Request already retried
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should skip refresh when skipAuthRefresh is true', async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          skipAuthRefresh: true,
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should handle missing config', async () => {
      const error = {
        response: { status: 401 },
        // No config
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });
  });
});
