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

  describe('Plugin Creation', () => {
    test('should throw error if refreshTokenFn is not a function', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: 'not-a-function' as any,
          getAuthToken: mockGetAuthToken,
        });
      }).toThrow('refreshTokenFn must be a function');
    });

    test('should throw error if getAuthToken is not a function', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: 'not-a-function' as any,
        });
      }).toThrow('getAuthToken must be a function');
    });

    test('should create plugin with default options', () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      expect(typeof plugin).toBe('function');
    });

    test('should throw error for invalid maxRetryAttempts', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxRetryAttempts: 0,
        });
      }).toThrow('maxRetryAttempts must be an integer greater than or equal to 1');
    });

    test('should throw error for non-integer maxRetryAttempts', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxRetryAttempts: 1.5,
        });
      }).toThrow('maxRetryAttempts must be an integer greater than or equal to 1');
    });

    test('should throw error for invalid retryDelay', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          retryDelay: -1,
        });
      }).toThrow('retryDelay must be a number greater than or equal to 0');
    });

    test('should throw error for zero maxConcurrentRetries', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxConcurrentRetries: 0,
        });
      }).toThrow('maxConcurrentRetries must be an integer greater than or equal to 1');
    });

    test('should throw error for non-integer maxConcurrentRetries', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxConcurrentRetries: 2.5,
        });
      }).toThrow('maxConcurrentRetries must be an integer greater than or equal to 1');
    });

    test('should throw error for zero maxQueueSize', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxQueueSize: 0,
        });
      }).toThrow('maxQueueSize must be an integer greater than or equal to 1');
    });

    test('should throw error for non-integer maxQueueSize', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxQueueSize: 2.5,
        });
      }).toThrow('maxQueueSize must be an integer greater than or equal to 1');
    });

    test('should throw error for zero refreshTimeout', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          refreshTimeout: 0,
        });
      }).toThrow('refreshTimeout must be a number greater than 0');
    });

    test('should throw error for negative refreshTimeout', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          refreshTimeout: -5,
        });
      }).toThrow('refreshTimeout must be a number greater than 0');
    });

    test('should throw error for NaN refreshTimeout', () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          refreshTimeout: Number.NaN,
        });
      }).toThrow('refreshTimeout must be a number greater than 0');
    });
  });
});
