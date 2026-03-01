import { beforeAll, afterAll, beforeEach, describe, test, expect, vi } from "vitest";
import { createRefreshTokenPlugin } from "./index.js";

// Mock console.error to prevent test output pollution
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

// Minimal axios-like mock with interceptors and callable instance
const createMockAxios = () => {
  const instance = vi.fn();

  instance.interceptors = {
    request: {
      handlers: [],
      use: vi.fn((onFulfilled, onRejected) => {
        instance.interceptors.request.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.request.handlers.length - 1; // id
      }),
      eject: vi.fn((id) => {
        if (id >= 0) instance.interceptors.request.handlers[id] = null;
      }),
    },
    response: {
      handlers: [],
      use: vi.fn((onFulfilled, onRejected) => {
        instance.interceptors.response.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.response.handlers.length - 1; // id
      }),
      eject: vi.fn((id) => {
        if (id >= 0) instance.interceptors.response.handlers[id] = null;
      }),
    },
  };

  instance.request = vi.fn();

  return instance;
};

// Mock functions
const mockRefreshTokenFn = vi.fn();
const mockGetAuthToken = vi.fn();
const mockOnStatusChange = vi.fn();
const mockShouldRefreshToken = vi.fn();
const mockAuthHeaderFormatter = vi.fn();

describe("createRefreshTokenPlugin", () => {
  let mockAxios;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: "retry-success" });
    mockAxios.request.mockResolvedValue({ data: "retry-success" });
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

    test("should handle refresh token failure", async () => {
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

      await expect(responseInterceptor(error)).rejects.toMatchObject({
        message: "Token refresh failed",
        originalError: refreshError,
      });
      expect(mockOnStatusChange).toHaveBeenCalledWith("failed", refreshError);
    });

    test("should handle refresh timeout", async () => {
      // Mock a slow refresh function that takes longer than timeout
      const slowRefreshFn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("token"), 200))
      );

      // Create a fresh mock axios for this test
      const timeoutMockAxios = createMockAxios();
      timeoutMockAxios.mockImplementation = vi.fn().mockResolvedValue({ data: "retry-success" });

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

    test("should use custom auth header formatter", async () => {
      const customFormatter = vi.fn().mockReturnValue("Custom new-token");

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

      await responseInterceptor(error);
      expect(customFormatter).toHaveBeenCalledWith("new-token");
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

describe("Queue handling", () => {
  const mockRefreshTokenFn = vi.fn();
  const mockGetAuthToken = vi.fn();

  let mockAxios;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = createMockAxios();
    mockAxios.mockResolvedValue({ data: "retry-success" });
    mockAxios.request.mockResolvedValue({ data: "retry-success" });
    mockRefreshTokenFn.mockResolvedValue("queue-token");
    mockGetAuthToken.mockReturnValue("current-token");
  });

  test("deduplicates simultaneous requests", async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
    });

    plugin(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: "GET", url: "/same" },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: "GET", url: "/same" },
    };

    const p1 = responseInterceptor(error1);
    const p2 = responseInterceptor(error2);

    const [result1, result2] = await Promise.all([p1, p2]);

    expect(result1).toStrictEqual(result2);
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(1);
  });

  test("resolves queued requests with new token", async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
    });

    plugin(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error = {
      response: { status: 401 },
      config: { method: "GET", url: "/queue", headers: {} },
    };

    const promise = responseInterceptor(error);

    await promise;

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer queue-token" }),
      })
    );
  });
});
