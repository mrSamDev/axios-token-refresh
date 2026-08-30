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
    test('enqueue failure rejects only the offending request, not the queue', async () => {
      const requestKeyError = new Error('request-key-exploded-during-refresh');
      let resolveRefresh!: (token: string | null) => void;
      const deferredRefresh = new Promise<string | null>((resolve) => {
        resolveRefresh = resolve;
      });

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: () => deferredRefresh,
        getAuthToken: mockGetAuthToken,
        getRequestKey: (request) => {
          if (request.url === '/second') {
            throw requestKeyError;
          }
          return `${request.method}-${request.url}`;
        },
        onStatusChange: mockOnStatusChange,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const firstError = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/first',
          headers: {},
        },
      };
      const secondError = {
        response: { status: 401 },
        config: {
          method: 'GET',
          url: '/second',
          headers: {},
        },
      };

      const firstRequestPromise = responseInterceptor(firstError);
      const firstHandled = firstRequestPromise.catch((error: unknown) => error);

      await new Promise((resolve) => setTimeout(resolve, 0));

      // The second request's key fn throws: only IT rejects.
      await expect(responseInterceptor(secondError)).rejects.toBe(requestKeyError);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'error',
        requestKeyError,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );

      // The first request is untouched: it settles when the refresh does.
      resolveRefresh('new-token');
      await expect(firstHandled).resolves.toMatchObject({ data: 'retry-success' });
    });

    test('interceptor error during active refresh does not start a second refresh', async () => {
      let resolveRefresh!: (token: string | null) => void;
      mockRefreshTokenFn.mockImplementation(
        () =>
          new Promise<string | null>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      let shouldExplode = false;
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: () => {
          if (shouldExplode) {
            throw new Error('predicate-exploded');
          }
          return true;
        },
        onStatusChange: mockOnStatusChange,
      });

      plugin.attach(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const makeError = (url: string) => ({
        response: { status: 401 },
        config: { method: 'GET', url, headers: {} },
      });

      const firstHandled = responseInterceptor(makeError('/first')).catch(
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);

      shouldExplode = true;
      await expect(responseInterceptor(makeError('/second'))).rejects.toMatchObject({
        message: 'predicate-exploded',
      });

      // First request is untouched by the second's predicate error.
      shouldExplode = false;
      const thirdHandled = responseInterceptor(makeError('/third')).catch(
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);

      resolveRefresh('race-token');
      await expect(firstHandled).resolves.toMatchObject({ data: 'retry-success' });
      await expect(thirdHandled).resolves.toMatchObject({ data: 'retry-success' });
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        'success',
        undefined,
        expect.objectContaining({
          queueDepth: expect.any(Number),
          attemptCount: expect.any(Number),
        }),
      );
    });
  });
});
