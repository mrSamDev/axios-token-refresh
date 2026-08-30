import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import {
  mockRefreshTokenFn,
  mockGetAuthToken,
  mockOnStatusChange,
  mockAuthHeaderFormatter,
  mockShouldRefreshToken,
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

  describe('Custom Options', () => {
    test('should use custom shouldRefreshToken function', async () => {
      mockShouldRefreshToken.mockReturnValue(false);

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: mockShouldRefreshToken,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);

      expect(mockShouldRefreshToken).toHaveBeenCalledWith(error, error.config);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should use custom auth header formatter', async () => {
      const customFormatter = vi.fn().mockReturnValue('Custom new-token');

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        authHeaderFormatter: customFormatter,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
          headers: {},
        },
      };

      await responseInterceptor(error);
      expect(customFormatter).toHaveBeenCalledWith('new-token');
    });

    test('should surface shouldRefreshToken errors through onStatusChange', async () => {
      const shouldRefreshError = new Error('should-refresh-exploded');
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: () => {
          throw shouldRefreshError;
        },
        onStatusChange: mockOnStatusChange,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(shouldRefreshError);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'error',
        shouldRefreshError,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('should normalize non-Error thrown values in shouldRefreshToken', async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: () => {
          throw 'bad-throw';
        },
        onStatusChange: mockOnStatusChange,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/test',
        },
      };

      await expect(responseInterceptor(error)).rejects.toMatchObject({
        message: 'Unknown error in refresh token interceptor',
      });
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: 'Unknown error in refresh token interceptor' }),
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });
  });
});
