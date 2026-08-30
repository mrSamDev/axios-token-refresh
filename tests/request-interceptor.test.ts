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

  describe('Request Interceptor', () => {
    test('should add request interceptor when autoInjectToken is true', () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        autoInjectToken: true,
      });

      plugin.attach(mockAxios);

      expect(mockAxios.interceptors.request.use).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
      );
    });

    test('should not add request interceptor when autoInjectToken and pauseRequestsWhileRefreshing are false', () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        autoInjectToken: false,
        pauseRequestsWhileRefreshing: false,
      });

      plugin.attach(mockAxios);

      expect(mockAxios.interceptors.request.use).not.toHaveBeenCalled();
    });

    test('should inject token in request headers', async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin.attach(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = { headers: {} };

      const result = await successHandler(config);

      expect(result.headers.Authorization).toBe('Bearer current-token');
    });

    test('should not override existing Authorization header', async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin.attach(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = {
        headers: {
          Authorization: 'Bearer existing-token',
        },
      };

      const result = await successHandler(config);

      expect(result.headers.Authorization).toBe('Bearer existing-token');
    });

    test('should handle missing headers object', async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin.attach(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = {}; // No headers

      const result = await successHandler(config);

      expect(result.headers.Authorization).toBe('Bearer current-token');
    });
  });
});
