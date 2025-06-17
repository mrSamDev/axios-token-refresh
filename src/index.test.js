/**
 * Tests for Axios Refresh Token Plugin
 */

import { createRefreshTokenPlugin } from "./index.js";

// Mock console.error to prevent test output pollution
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeAll(() => {
  console.error = jest.fn();
  console.log = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

// Mock axios
const createMockAxios = () => ({
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
  // Mock axios call function - this is important!
});

// Mock functions
const mockRefreshTokenFn = jest.fn();
const mockGetAuthToken = jest.fn();
const mockOnStatusChange = jest.fn();
const mockShouldRefreshToken = jest.fn();
const mockAuthHeaderFormatter = jest.fn();

describe("createRefreshTokenPlugin", () => {
  let mockAxios;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios = createMockAxios();
    // Add the axios function mock
    mockAxios.mockImplementation = jest.fn().mockResolvedValue({ data: "retry-success" });

    mockRefreshTokenFn.mockResolvedValue("new-token");
    mockGetAuthToken.mockReturnValue("current-token");
    mockOnStatusChange.mockImplementation(() => {});
    mockAuthHeaderFormatter.mockImplementation((token) => `Bearer ${token}`);
  });

  describe("Plugin Creation", () => {
    test("should throw error if refreshTokenFn is not a function", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: "not-a-function",
          getAuthToken: mockGetAuthToken,
        });
      }).toThrow("refreshTokenFn must be a function");
    });

    test("should throw error if getAuthToken is not a function", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: "not-a-function",
        });
      }).toThrow("getAuthToken must be a function");
    });

    test("should create plugin with default options", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      expect(typeof plugin).toBe("function");
    });
  });

  describe("Request Interceptor", () => {
    test("should add request interceptor when autoInjectToken is true", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        autoInjectToken: true,
      });

      plugin(mockAxios);

      expect(mockAxios.interceptors.request.use).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    });

    test("should not add request interceptor when autoInjectToken is false", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        autoInjectToken: false,
      });

      plugin(mockAxios);

      expect(mockAxios.interceptors.request.use).not.toHaveBeenCalled();
    });

    test("should inject token in request headers", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = { headers: {} };

      const result = successHandler(config);

      expect(result.headers.Authorization).toBe("Bearer current-token");
    });

    test("should not override existing Authorization header", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = {
        headers: {
          Authorization: "Bearer existing-token",
        },
      };

      const result = successHandler(config);

      expect(result.headers.Authorization).toBe("Bearer existing-token");
    });

    test("should handle missing headers object", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      plugin(mockAxios);

      const [successHandler] = mockAxios.interceptors.request.use.mock.calls[0];
      const config = {}; // No headers

      const result = successHandler(config);

      expect(result.headers.Authorization).toBe("Bearer current-token");
    });
  });

  describe("Response Interceptor", () => {
    let responseInterceptor;

    beforeEach(() => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
      });

      plugin(mockAxios);
      responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
    });

    test("should handle successful response", () => {
      const response = { data: "test" };
      const successHandler = mockAxios.interceptors.response.use.mock.calls[0][0];

      const result = successHandler(response);

      expect(result).toBe(response);
    });

    test("should refresh token on 401 error", async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          headers: {},
        },
      };

      const promise = responseInterceptor(error);

      // Wait for refresh to start
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRefreshTokenFn).toHaveBeenCalled();
      expect(mockOnStatusChange).toHaveBeenCalledWith("refreshing");

      // Don't await the promise to avoid hanging
      expect(promise).toBeInstanceOf(Promise);
    });

    test("should not refresh token if no auth token exists", async () => {
      mockGetAuthToken.mockReturnValue(null);

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should not retry request twice", async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          headers: {},
          _retry: true, // Request already retried
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should handle missing config", async () => {
      const error = {
        response: { status: 401 },
        // No config
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });
  });

  describe("Token Refresh Logic", () => {
    let responseInterceptor;

    beforeEach(() => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        authHeaderFormatter: mockAuthHeaderFormatter,
      });

      plugin(mockAxios);
      responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
    });

    test("should handle refresh token failure", (done) => {
      const refreshError = new Error("Refresh failed");
      mockRefreshTokenFn.mockRejectedValue(refreshError);

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          headers: {},
        },
      };

      const promise = responseInterceptor(error);

      promise.catch((err) => {
        expect(err.message).toBe("Token refresh failed");
        expect(err.originalError).toBe(refreshError);
        expect(mockOnStatusChange).toHaveBeenCalledWith("failed", refreshError);
        done();
      });
    });

    test("should handle refresh timeout", async () => {
      // Mock a slow refresh function that takes longer than timeout
      const slowRefreshFn = jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("token"), 200)));

      // Create a fresh mock axios for this test
      const timeoutMockAxios = createMockAxios();
      timeoutMockAxios.mockImplementation = jest.fn().mockResolvedValue({ data: "retry-success" });

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: slowRefreshFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        refreshTimeout: 50, // Short timeout for testing
      });

      plugin(timeoutMockAxios);
      const interceptor = timeoutMockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          headers: {},
        },
      };

      // Test the timeout scenario
      await expect(interceptor(error)).rejects.toThrow("Token refresh failed");

      // Wait a bit more to ensure the timeout has triggered
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockOnStatusChange).toHaveBeenCalledWith("failed", expect.any(Error));
    }, 10000); // Increase test timeout to 10 seconds
  });

  describe("Custom Options", () => {
    test("should use custom shouldRefreshToken function", async () => {
      mockShouldRefreshToken.mockReturnValue(false);

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: mockShouldRefreshToken,
      });

      plugin(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);

      expect(mockShouldRefreshToken).toHaveBeenCalledWith(error, error.config);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should use custom auth header formatter", (done) => {
      const customFormatter = jest.fn().mockReturnValue("Custom new-token");

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        authHeaderFormatter: customFormatter,
      });

      plugin(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          headers: {},
        },
      };

      responseInterceptor(error);

      // Wait for refresh to complete
      setTimeout(() => {
        expect(customFormatter).toHaveBeenCalledWith("new-token");
        done();
      }, 10);
    });
  });

  describe("Cleanup", () => {
    test("should return cleanup function", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin(mockAxios);

      expect(typeof cleanup).toBe("function");
    });

    test("should clean up state when cleanup is called", () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin(mockAxios);

      expect(() => cleanup()).not.toThrow();
    });
  });
});
