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

  describe('Custom Options', () => {
    test('should surface getRequestKey errors through onStatusChange', async () => {
      const requestKeyError = new Error('request-key-exploded');
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        getRequestKey: () => {
          throw requestKeyError;
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

      await expect(responseInterceptor(error)).rejects.toBe(requestKeyError);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'error',
        requestKeyError,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test('getRequestKey sees the original config, not the _retry clone', async () => {
      const seenRetryValues: unknown[] = [];
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        getRequestKey: (config) => {
          seenRetryValues.push((config as { _retry?: unknown })._retry);
          return `${config.method}-${config.url}`;
        },
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: { method: 'GET', url: '/test', headers: {} },
      };

      await responseInterceptor(error);

      // The key fn must see the caller's config (no _retry), not the clone.
      expect(seenRetryValues).toEqual([undefined]);
    });
  });
});
