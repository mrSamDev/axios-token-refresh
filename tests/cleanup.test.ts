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

  describe('Cleanup', () => {
    test('should return cleanup function', () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin.attach(mockAxios);

      expect(typeof cleanup).toBe('function');
    });

    test('should clean up state when cleanup is called', () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin.attach(mockAxios);

      expect(() => cleanup()).not.toThrow();
    });

    test('should reject pending queued requests on cleanup', async () => {
      const deferredRefresh = new Promise<string | null>(() => {});
      const refreshSpy = vi.fn(() => deferredRefresh);
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: refreshSpy,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/pending-cleanup',
          headers: {},
        },
      };

      const requestPromise = responseInterceptor(error);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      const settledRequest = requestPromise.then(
        (value: unknown) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );

      cleanup();

      const settled = await settledRequest;
      expect(settled.status).toBe('rejected');
      if (settled.status === 'rejected') {
        expect(settled.reason).toMatchObject({
          message: 'Token refresh failed',
          originalError: expect.objectContaining({ message: 'Refresh interceptor cleaned up' }),
        });
      }
    });

    test('does not persist the token or fire success hooks after cleanup', async () => {
      let resolveRefresh!: (token: string | null) => void;
      const deferredRefresh = new Promise<string | null>((resolve) => {
        resolveRefresh = resolve;
      });
      const setAccessToken = vi.fn();
      const clear = vi.fn();
      const onRefreshSuccess = vi.fn();

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: () => deferredRefresh,
        accessTokenStore: {
          getAccessToken: mockGetAuthToken,
          setAccessToken,
          clear,
        },
        onStatusChange: mockOnStatusChange,
        onRefreshSuccess,
      });

      const cleanup = plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
      const error = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/post-cleanup-write',
          headers: {},
        },
      };

      const requestHandled = responseInterceptor(error).catch((reason: unknown) => reason);
      await new Promise((resolve) => setTimeout(resolve, 0));

      cleanup();
      resolveRefresh('post-cleanup-token');

      await requestHandled;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(setAccessToken).not.toHaveBeenCalled();
      expect(onRefreshSuccess).not.toHaveBeenCalled();
      expect(mockOnStatusChange).not.toHaveBeenCalledWith('success');
      expect(clear).not.toHaveBeenCalled();
    });
  });
});
