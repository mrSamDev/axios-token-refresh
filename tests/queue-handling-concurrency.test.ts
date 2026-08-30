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

describe('Queue handling', () => {
  const mockRefreshTokenFn = vi.fn();
  const mockGetAuthToken = vi.fn();

  let mockAxios: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
    mockAxios.request.mockResolvedValue({ data: 'retry-success' });
    mockRefreshTokenFn.mockResolvedValue('queue-token');
    mockGetAuthToken.mockReturnValue('current-token');
  });
  test('maxConcurrentRetries caps simultaneous retries', async () => {
    let activeRetries = 0;
    let peakRetries = 0;
    mockAxios.mockImplementation(async () => {
      activeRetries += 1;
      peakRetries = Math.max(peakRetries, activeRetries);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRetries -= 1;
      return { data: 'retry-success' };
    });

    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      maxConcurrentRetries: 2,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const errors = Array.from({ length: 5 }, (_, index) => ({
      response: { status: 401 },
      config: { method: 'GET', url: `/capped-${index}` },
    }));

    await Promise.all(errors.map((error) => responseInterceptor(error)));

    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(5);
    expect(peakRetries).toBe(2);
  });

  test('rejects requests beyond maxQueueSize while earlier ones still retry', async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      maxQueueSize: 2,
    });

    plugin.attach(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const authError = (url: string) => ({
      response: { status: 401 },
      config: { method: 'GET', url, headers: {} },
    });

    const first = responseInterceptor(authError('/first'));
    const second = responseInterceptor(authError('/second'));
    const third = responseInterceptor(authError('/third'));

    await expect(third).rejects.toThrow('Token refresh queue is full');
    await Promise.all([first, second]);
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(2);
  });
});
