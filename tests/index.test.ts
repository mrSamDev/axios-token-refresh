import { beforeAll, afterAll, beforeEach, describe, test, expect, vi } from "vitest";
import { createRefreshTokenPlugin } from "../src/index";
import { tryCatch } from "../src/try-catch";

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
  const instance = vi.fn() as any;

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
  let mockAxios: any;

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
          refreshTokenFn: "not-a-function" as any,
          getAuthToken: mockGetAuthToken,
        });
      }).toThrow("refreshTokenFn must be a function");
    });

    test("should throw error if getAuthToken is not a function", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: "not-a-function" as any,
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

    test("should throw error for invalid maxRetryAttempts", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxRetryAttempts: 0,
        });
      }).toThrow("maxRetryAttempts must be an integer greater than or equal to 1");
    });

    test("should throw error for non-integer maxRetryAttempts", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          maxRetryAttempts: 1.5,
        });
      }).toThrow("maxRetryAttempts must be an integer greater than or equal to 1");
    });

    test("should throw error for invalid retryDelay", () => {
      expect(() => {
        createRefreshTokenPlugin({
          refreshTokenFn: mockRefreshTokenFn,
          getAuthToken: mockGetAuthToken,
          retryDelay: -1,
        });
      }).toThrow("retryDelay must be a number greater than or equal to 0");
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
    let responseInterceptor: any;

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

    test("should not refresh token on non-401 response errors", async () => {
      const error = {
        response: { status: 403 },
        config: {
          method: "GET",
          url: "/forbidden",
        },
      };

      await expect(responseInterceptor(error)).rejects.toBe(error);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should refresh on network error when token exists (default shouldRefreshToken)", async () => {
      const error = {
        message: "Network Error",
        config: {
          method: "GET",
          url: "/network",
          headers: {},
        },
      };

      const promise = responseInterceptor(error);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
      expect(promise).toBeInstanceOf(Promise);
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

    test("should skip refresh when skipAuthRefresh is true", async () => {
      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/test",
          skipAuthRefresh: true,
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
    let responseInterceptor: any;

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

    test("retries refresh and succeeds before maxRetryAttempts", async () => {
      const retryingRefreshTokenFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Temporary refresh failure"))
        .mockResolvedValueOnce("retried-token");

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: retryingRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        maxRetryAttempts: 2,
        retryDelay: 5,
      });

      plugin(mockAxios);
      const responseInterceptorCalls = mockAxios.interceptors.response.use.mock.calls;
      const interceptor = responseInterceptorCalls[responseInterceptorCalls.length - 1][1];

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/retry-success",
          headers: {},
        },
      };

      await interceptor(error);

      expect(retryingRefreshTokenFn).toHaveBeenCalledTimes(2);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      expect(mockOnStatusChange).toHaveBeenCalledWith("success");
    });

    test("fails after reaching maxRetryAttempts", async () => {
      const alwaysFailRefreshTokenFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("attempt-1"))
        .mockRejectedValueOnce(new Error("attempt-2"));

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: alwaysFailRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        onStatusChange: mockOnStatusChange,
        maxRetryAttempts: 2,
        retryDelay: 5,
      });

      plugin(mockAxios);
      const responseInterceptorCalls = mockAxios.interceptors.response.use.mock.calls;
      const interceptor = responseInterceptorCalls[responseInterceptorCalls.length - 1][1];

      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/retry-fail",
          headers: {},
        },
      };

      await expect(interceptor(error)).rejects.toMatchObject({
        message: "Token refresh failed",
        originalError: expect.objectContaining({ message: "attempt-2" }),
      });

      expect(alwaysFailRefreshTokenFn).toHaveBeenCalledTimes(2);
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        "failed",
        expect.objectContaining({ message: "attempt-2" })
      );
    });
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

    test("should surface shouldRefreshToken errors through onStatusChange", async () => {
      const shouldRefreshError = new Error("should-refresh-exploded");
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: () => {
          throw shouldRefreshError;
        },
        onStatusChange: mockOnStatusChange,
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

      await expect(responseInterceptor(error)).rejects.toBe(shouldRefreshError);
      expect(mockOnStatusChange).toHaveBeenCalledWith("error", shouldRefreshError);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should normalize non-Error thrown values in shouldRefreshToken", async () => {
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        shouldRefreshToken: () => {
          throw "bad-throw";
        },
        onStatusChange: mockOnStatusChange,
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

      await expect(responseInterceptor(error)).rejects.toMatchObject({
        message: "Unknown error in refresh token interceptor",
      });
      expect(mockOnStatusChange).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ message: "Unknown error in refresh token interceptor" })
      );
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should surface getRequestKey errors through onStatusChange", async () => {
      const requestKeyError = new Error("request-key-exploded");
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: mockRefreshTokenFn,
        getAuthToken: mockGetAuthToken,
        getRequestKey: () => {
          throw requestKeyError;
        },
        onStatusChange: mockOnStatusChange,
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

      await expect(responseInterceptor(error)).rejects.toBe(requestKeyError);
      expect(mockOnStatusChange).toHaveBeenCalledWith("error", requestKeyError);
      expect(mockRefreshTokenFn).not.toHaveBeenCalled();
    });

    test("should reject queued requests when enqueue fails during active refresh", async () => {
      const requestKeyError = new Error("request-key-exploded-during-refresh");
      const deferredRefresh = new Promise<string | null>(() => {});

      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: () => deferredRefresh,
        getAuthToken: mockGetAuthToken,
        getRequestKey: (request) => {
          if (request.url === "/second") {
            throw requestKeyError;
          }
          return `${request.method}-${request.url}`;
        },
        onStatusChange: mockOnStatusChange,
      });

      plugin(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];

      const firstError = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/first",
          headers: {},
        },
      };
      const secondError = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/second",
          headers: {},
        },
      };

      const firstRequestPromise = responseInterceptor(firstError);
      const firstHandled = firstRequestPromise.catch((error) => error);

      await new Promise((resolve) => setTimeout(resolve, 0));

      await expect(responseInterceptor(secondError)).rejects.toBe(requestKeyError);

      await expect(firstHandled).resolves.toMatchObject({
        message: "Token refresh failed",
        originalError: requestKeyError,
      });
      expect(mockOnStatusChange).toHaveBeenCalledWith("error", requestKeyError);
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

    test("should reject pending queued requests on cleanup", async () => {
      const deferredRefresh = new Promise<string | null>(() => {});
      const refreshSpy = vi.fn(() => deferredRefresh);
      const plugin = createRefreshTokenPlugin({
        refreshTokenFn: refreshSpy,
        getAuthToken: mockGetAuthToken,
      });

      const cleanup = plugin(mockAxios);
      const responseInterceptor = mockAxios.interceptors.response.use.mock.calls[0][1];
      const error = {
        response: { status: 401 },
        config: {
          method: "GET",
          url: "/pending-cleanup",
          headers: {},
        },
      };

      const requestPromise = responseInterceptor(error);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      const settledRequest = requestPromise.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason })
      );

      cleanup();

      const settled = await settledRequest;
      expect(settled.status).toBe("rejected");
      if (settled.status === "rejected") {
        expect(settled.reason).toMatchObject({
          message: "Token refresh failed",
          originalError: expect.objectContaining({ message: "Refresh interceptor cleaned up" }),
        });
      }
    });
  });
});

describe("Queue handling", () => {
  const mockRefreshTokenFn = vi.fn();
  const mockGetAuthToken = vi.fn();

  let mockAxios: any;

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

  test("uses custom getRequestKey for dedupe", async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      getRequestKey: () => "same-custom-key",
    });

    plugin(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: "GET", url: "/first", params: { a: 1 } },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: "GET", url: "/second", params: { b: 2 } },
    };

    const [result1, result2] = await Promise.all([responseInterceptor(error1), responseInterceptor(error2)]);

    expect(result1).toStrictEqual(result2);
    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(1);
  });

  test("custom getRequestKey can prevent dedupe collisions", async () => {
    const plugin = createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      getRequestKey: (request) => `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`,
    });

    plugin(mockAxios);
    const [, responseInterceptor] = mockAxios.interceptors.response.use.mock.calls[0];

    const error1 = {
      response: { status: 401 },
      config: { method: "POST", url: "/same", data: { payload: 1 } },
    };
    const error2 = {
      response: { status: 401 },
      config: { method: "POST", url: "/same", data: { payload: 2 } },
    };

    await Promise.all([responseInterceptor(error1), responseInterceptor(error2)]);

    expect(mockRefreshTokenFn).toHaveBeenCalledTimes(1);
    expect(mockAxios).toHaveBeenCalledTimes(2);
  });
});

describe("tryCatch", () => {
  test("returns success tuple for synchronous operations", () => {
    const result = tryCatch(() => 42);

    expect(result).toStrictEqual([42, null]);
  });

  test("returns failure tuple for synchronous errors", () => {
    const result = tryCatch(() => {
      throw new Error("sync-fail");
    });

    expect(result[0]).toBeNull();
    expect((result[1] as Error)?.message).toBe("sync-fail");
  });

  test("returns success tuple for promise operations", async () => {
    const result = await tryCatch(Promise.resolve("ok"));

    expect(result).toStrictEqual(["ok", null]);
  });

  test("returns failure tuple for rejected promises", async () => {
    const result = await tryCatch(Promise.reject(new Error("async-fail")));

    expect(result[0]).toBeNull();
    expect((result[1] as Error)?.message).toBe("async-fail");
  });
});
