/**
 * Axios Refresh Token Plugin
 *
 * This plugin handles token refresh logic when API calls fail due to authentication issues.
 * It queues pending authorized requests and retries them once a new token is obtained.
 *
 * @module @mrsamdev/axios-token-refresh
 */

/**
 * Creates and returns an axios interceptor plugin that handles token refresh.
 * Keeps the public API intact while organising the code for clarity and testability.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.refreshTokenFn - Async function that refreshes the token and returns the new token
 * @param {Function} options.getAuthToken - Function that returns the current auth token
 * @param {Function} [options.shouldRefreshToken] - Function that determines if token refresh should be triggered
 * @param {Function} [options.onStatusChange] - Callback for token refresh status updates
 * @param {Function} [options.authHeaderFormatter] - Format the authorization header value
 * @param {number} [options.refreshTimeout] - Timeout for token refresh operation in milliseconds
 * @param {boolean} [options.autoInjectToken] - Automatically inject token in request headers
 * @returns {Function} Axios plugin function that installs interceptors and returns a cleanup callback
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  shouldRefreshToken = (error, originalRequest) => {
    if (!getAuthToken()) return false;

    // Network errors (no response object)
    if (!error?.response) {
      return true;
    }

    // 401 unauthorized
    return error.response.status === 401;
  },
  onStatusChange = (status, error) => {
    console.log(`Token refresh status: ${status}`, error || "");
  },
  authHeaderFormatter = (token) => `Bearer ${token}`,
  refreshTimeout = 10000,
  autoInjectToken = true,
} = {}) {
  if (typeof refreshTokenFn !== "function") {
    throw new Error("refreshTokenFn must be a function");
  }

  if (typeof getAuthToken !== "function") {
    throw new Error("getAuthToken must be a function");
  }

  // Pending authorized requests waiting for a refreshed token
  const pendingRequests = [];
  const requestPromiseMap = new Map(); // For request deduplication
  let isRefreshing = false;
  let refreshPromise = null;

  /**
   * Generate a unique key for request deduplication
   * @param {Object} config - Axios request config
   * @returns {string} Unique request key
   */
  const getRequestKey = (config = {}) => {
    const method = (config.method || "get").toLowerCase();
    const url = config.url || "";
    const params = JSON.stringify(config.params || {});
    return `${method}-${url}-${params}`;
  };

  const applyAuthHeader = (config, token, force = false) => {
    if (!token) return config;
    config.headers = config.headers || {};

    if (force || !config.headers.Authorization) {
      config.headers.Authorization = authHeaderFormatter(token);
    }

    return config;
  };

  const resetTracking = () => {
    pendingRequests.length = 0;
    requestPromiseMap.clear();
  };

  const enqueueRequest = (originalRequest) => {
    const requestKey = getRequestKey(originalRequest);

    if (requestPromiseMap.has(requestKey)) {
      return requestPromiseMap.get(requestKey);
    }

    let resolveFn;
    let rejectFn;

    const retryPromise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    pendingRequests.push({
      request: originalRequest,
      requestKey,
      resolve: resolveFn,
      reject: rejectFn,
    });

    requestPromiseMap.set(requestKey, retryPromise);
    return retryPromise;
  };

  const executeRequest = (axiosInstance, request) => {
    const target = typeof axiosInstance === "function" ? axiosInstance : axiosInstance?.request?.bind(axiosInstance);

    if (!target) {
      return Promise.reject(new Error("Provided axios instance is not callable"));
    }

    return target(request);
  };

  const resolveQueue = (newToken, axiosInstance) => {
    const requestsToResolve = [...pendingRequests];
    resetTracking();

    requestsToResolve.forEach(({ request, resolve }) => {
      const requestConfig = {
        ...request,
        headers: { ...(request.headers || {}) },
      };

      applyAuthHeader(requestConfig, newToken, true);
      resolve(executeRequest(axiosInstance, requestConfig));
    });
  };

  const rejectQueue = (refreshError) => {
    const error = refreshError instanceof Error ? refreshError : new Error("Token refresh failed");
    const requestsToReject = [...pendingRequests];
    resetTracking();

    requestsToReject.forEach(({ reject }) => {
      const refreshFailedError = new Error("Token refresh failed");
      refreshFailedError.originalError = error;
      reject(refreshFailedError);
    });
  };

  const createRefreshPromise = () => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Token refresh timeout"));
      }, refreshTimeout);
    });

    refreshPromise = Promise.race([Promise.resolve().then(refreshTokenFn), timeoutPromise]);
    return refreshPromise;
  };

  /**
   * The actual axios plugin function
   * @param {Object} axios - Axios instance
   */
  return (axios) => {
    const requestInterceptorId = autoInjectToken
      ? axios.interceptors.request.use(
          (config) => {
            const token = getAuthToken();
            return token ? applyAuthHeader(config, token) : config;
          },
          (error) => Promise.reject(error)
        )
      : null;

    const responseInterceptorId = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error?.config;

        if (!originalRequest || originalRequest._retry) {
          return Promise.reject(error);
        }

        try {
          if (!shouldRefreshToken(error, originalRequest)) {
            return Promise.reject(error);
          }

          originalRequest._retry = true;
          const retryPromise = enqueueRequest(originalRequest);

          if (!isRefreshing) {
            isRefreshing = true;
            onStatusChange("refreshing");

            try {
              const newToken = await createRefreshPromise();
              onStatusChange("success");
              resolveQueue(newToken, axios);
            } catch (refreshError) {
              onStatusChange("failed", refreshError instanceof Error ? refreshError : new Error("Token refresh failed"));
              rejectQueue(refreshError);
            } finally {
              isRefreshing = false;
              refreshPromise = null;
            }
          }

          return retryPromise;
        } catch (interceptorError) {
          const handledError = interceptorError instanceof Error ? interceptorError : new Error("Unknown error in refresh token interceptor");
          onStatusChange("error", handledError);

          if (isRefreshing && refreshPromise) {
            rejectQueue(handledError);
            isRefreshing = false;
            refreshPromise = null;
          }

          return Promise.reject(handledError);
        }
      }
    );

    // Return cleanup function
    return () => {
      if (autoInjectToken && typeof axios?.interceptors?.request?.eject === "function") {
        axios.interceptors.request.eject(requestInterceptorId);
      }

      if (typeof axios?.interceptors?.response?.eject === "function") {
        axios.interceptors.response.eject(responseInterceptorId);
      }

      resetTracking();
      isRefreshing = false;
      refreshPromise = null;
    };
  };
}

export default createRefreshTokenPlugin;
