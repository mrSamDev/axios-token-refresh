import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import { createMockStore } from './helpers/store-mocks';

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

describe('accessTokenStore: mutual exclusion with getAuthToken', () => {
  let mockAxios: any;
  let mockRefreshTokenFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: 'retry-success' });
    mockRefreshTokenFn = vi.fn().mockResolvedValue('new-token');
  });

  test('throws when both getAuthToken and accessTokenStore are provided', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: () => 'token',
        accessTokenStore: createMockStore(),
      });
    }).toThrow('Cannot provide both getAuthToken and accessTokenStore');
  });

  test('throws when neither getAuthToken nor accessTokenStore is provided', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
      } as any);
    }).toThrow('Either getAuthToken or accessTokenStore must be provided');
  });

  test('accepts accessTokenStore alone (getAuthToken not required)', () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      accessTokenStore: createMockStore(),
    });
    expect(typeof plugin).toBe('function');
  });

  test('accepts getAuthToken alone (backward compat)', () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: () => 'token',
    });
    expect(typeof plugin).toBe('function');
  });

  test('throws when accessTokenStore.getAccessToken is not a function', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        accessTokenStore: {
          getAccessToken: 'not-a-function' as any,
          setAccessToken: () => {},
        },
      });
    }).toThrow('accessTokenStore.getAccessToken must be a function');
  });

  test('throws when accessTokenStore.setAccessToken is not a function', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        accessTokenStore: {
          getAccessToken: () => null,
          setAccessToken: 'not-a-function' as any,
        },
      });
    }).toThrow('accessTokenStore.setAccessToken must be a function');
  });

  test('existing getAuthToken non-function error still works', () => {
    expect(() => {
      createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: 'not-a-function' as any,
      });
    }).toThrow('getAuthToken must be a function');
  });
});
