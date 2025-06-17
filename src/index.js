/**
 * Axios Refresh Token Plugin
 *
 * This plugin handles token refresh logic when API calls fail due to authentication issues.
 * It queues pending authorized requests and retries them once a new token is obtained.
 *
 * @module @mrsamdev/axios-token-refresh
 */

/**
 * Creates and returns an axios interceptor plugin that handles token refresh
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.refreshTokenFn - Async function that refreshes the token and returns the new token
 * @param {Function} options.getAuthToken - Function that returns the current auth token
 * @param {Function} [options.shouldRefreshToken] - Function that determines if token refresh should be triggered
 * @param {Function} [options.onStatusChange] - Callback for token refresh status updates
 * @param {Function} [options.authHeaderFormatter] - Format the authorization header value
 * @param {number} [options.refreshTimeout] - Timeout for token refresh operation in milliseconds
 * @param {boolean} [options.autoInjectToken] - Automatically inject token in request headers
 * @returns {Function} Axios plugin function
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  shouldRefreshToken = (error, originalRequest) => {
    if (!getAuthToken()) return false;

    // Handle network errors (no response object)
    if (!error?.response) {
      return true;
    }

    // Handle 401 unauthorized
    return error.response.status === 401;
  },
  onStatusChange = (status, error) => {
    console.log(`Token refresh status: ${status}`, error || "");
  },
  authHeaderFormatter = (token) => `Bearer ${token}`,
  refreshTimeout = 10000,
  autoInjectToken = true,
}) {
  if (typeof refreshTokenFn !== "function") {
    throw new Error("refreshTokenFn must be a function");
  }

  if (typeof getAuthToken !== "function") {
    throw new Error("getAuthToken must be a function");
  }

  // Store pending requests with their resolve/reject functions
  const pendingRequests = [];
  const pendingRequestsMap = new Map(); // For request deduplication
  let isRefreshing = false;
  let refreshPromise = null;

  /**
   * Generate a unique key for request deduplication
   * @param {Object} config - Axios request config
   * @returns {string} Unique request key
   */
  const getRequestKey = (config) => {
    return `${config.method || "get"}-${config.url}-${JSON.stringify(config.params || {})}`;
  };

  /**
   * Clean up request tracking
   */
  const cleanupRequests = () => {
    pendingRequests.length = 0;
    pendingRequestsMap.clear();
  };

  /**
   * The actual axios plugin function
   * @param {Object} axios - Axios instance
   */
  return (axios) => {
    // Add request interceptor for automatic token injection
    if (autoInjectToken) {
      axios.interceptors.request.use(
        (config) => {
          const token = getAuthToken();
          if (token && !config.headers?.["Authorization"]) {
            config.headers = config.headers || {};
            config.headers["Authorization"] = authHeaderFormatter(token);
          }
          return config;
        },
        (error) => Promise.reject(error)
      );
    }

    // Add response interceptor
    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If no config exists, we can't retry the request
        if (!originalRequest) {
          return Promise.reject(error);
        }

        try {
          if (shouldRefreshToken(error, originalRequest) && !originalRequest._retry) {
            originalRequest._retry = true;

            // Check for duplicate requests
            const requestKey = getRequestKey(originalRequest);
            if (pendingRequestsMap.has(requestKey)) {
              return pendingRequestsMap.get(requestKey);
            }

            // Create a new promise for this request
            const retryPromise = new Promise((resolve, reject) => {
              pendingRequests.push({
                request: originalRequest,
                requestKey,
                resolve,
                reject,
              });
            });

            // Store the promise to prevent duplicates
            pendingRequestsMap.set(requestKey, retryPromise);

            // Start refresh token process if not already in progress
            if (!isRefreshing) {
              isRefreshing = true;
              onStatusChange("refreshing");

              // Create the refresh promise with timeout
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                  reject(new Error("Token refresh timeout"));
                }, refreshTimeout);
              });

              refreshPromise = Promise.race([refreshTokenFn(), timeoutPromise]);

              try {
                // Call the provided refresh token function with timeout
                const newToken = await refreshPromise;
                onStatusChange("success");

                // Process all pending requests with the new token
                const requestsToResolve = [...pendingRequests];
                cleanupRequests();

                // Resolve all pending requests
                requestsToResolve.forEach(({ request, resolve }) => {
                  if (newToken) {
                    request.headers = request.headers || {};
                    request.headers["Authorization"] = authHeaderFormatter(newToken);
                  }
                  // Resolve with axios retry
                  resolve(axios(request));
                });
              } catch (refreshError) {
                const error = refreshError instanceof Error ? refreshError : new Error("Token refresh failed");

                onStatusChange("failed", error);

                // Reject all pending requests
                const requestsToReject = [...pendingRequests];
                cleanupRequests();

                requestsToReject.forEach(({ reject }) => {
                  const refreshFailedError = new Error("Token refresh failed");
                  refreshFailedError.originalError = error;
                  reject(refreshFailedError);
                });
              } finally {
                isRefreshing = false;
                refreshPromise = null;
              }
            }

            return retryPromise;
          }
        } catch (interceptorError) {
          const handledError = interceptorError instanceof Error ? interceptorError : new Error("Unknown error in refresh token interceptor");

          console.error("Error in refresh token interceptor:", handledError);
          onStatusChange("error", handledError);

          // Only clean up if we were the ones managing the refresh state
          if (isRefreshing && refreshPromise) {
            const requestsToReject = [...pendingRequests];
            cleanupRequests();

            requestsToReject.forEach(({ reject }) => {
              reject(handledError);
            });

            isRefreshing = false;
            refreshPromise = null;
          }

          // For non-refresh related errors, just reject the current request
          return Promise.reject(handledError);
        }

        return Promise.reject(error);
      }
    );

    // Return cleanup function
    return () => {
      cleanupRequests();
      isRefreshing = false;
      refreshPromise = null;
    };
  };
}

export default createRefreshTokenPlugin;
