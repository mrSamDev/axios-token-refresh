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
 * @returns {Function} Axios plugin function
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  shouldRefreshToken = (error, originalRequest) => {
    const statusCode = error?.response ? error.response.status : "Network Error";
    return (statusCode === 401 || statusCode === "Network Error") && !!getAuthToken();
  },
  onStatusChange = (status) => {
    console.log(`Token refresh status: ${status}`);
  },
  authHeaderFormatter = (token) => `Bearer ${token}`,
  refreshTimeout = 10000,
}) {
  if (typeof refreshTokenFn !== "function") {
    throw new Error("refreshTokenFn must be a function");
  }

  if (typeof getAuthToken !== "function") {
    throw new Error("getAuthToken must be a function");
  }

  // Store pending requests with their resolve/reject functions
  const pendingRequests = [];
  let isRefreshing = false;
  let refreshPromise = null;

  /**
   * The actual axios plugin function
   * @param {Object} axios - Axios instance
   */
  return (axios) => {
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

            // Create a new promise for this request
            const retryPromise = new Promise((resolve, reject) => {
              pendingRequests.push({
                request: originalRequest,
                resolve,
                reject,
              });
            });

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
                pendingRequests.forEach(({ request, resolve }) => {
                  if (newToken) {
                    request.headers["Authorization"] = authHeaderFormatter(newToken);
                  }
                  // Resolve with axios retry
                  resolve(axios(request));
                });

                // Clear pending requests
                pendingRequests.length = 0;
              } catch (refreshError) {
                const error = refreshError instanceof Error ? refreshError : new Error("Token refresh failed");
                onStatusChange("failed", error);

                // Reject all pending requests
                pendingRequests.forEach(({ reject }) => {
                  const refreshFailedError = new Error("Token refresh failed");
                  refreshFailedError.originalError = error;
                  reject(refreshFailedError);
                });

                // Clear pending requests
                pendingRequests.length = 0;
              } finally {
                isRefreshing = false;
                refreshPromise = null;
              }
            }

            return retryPromise;
          }
        } catch (interceptorError) {
          const error = interceptorError instanceof Error ? interceptorError : new Error("Unknown error in refresh token interceptor");
          console.error("Error in refresh token interceptor:", error);

          if (isRefreshing) {
            onStatusChange("error", error);

            pendingRequests.forEach(({ reject }) => {
              reject(error);
            });

            pendingRequests.length = 0;
            isRefreshing = false;
            refreshPromise = null;
          }
        }

        return Promise.reject(error);
      }
    );
  };
}

export default createRefreshTokenPlugin;
