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
 * @returns {Function} Axios plugin function
 */
export function createRefreshTokenPlugin({
  refreshTokenFn,
  getAuthToken,
  shouldRefreshToken = (error) => {
    // Default check for when to refresh token
    const statusCode = error?.response ? error.response.status : "Network Error";
    return (statusCode === 401 || statusCode === "Network Error") && getAuthToken();
  },
  onStatusChange = (status) => {
    // Default status change handler
    console.log(`Token refresh status: ${status}`);
  },
}) {
  if (typeof refreshTokenFn !== "function") {
    throw new Error("refreshTokenFn must be a function");
  }

  if (typeof getAuthToken !== "function") {
    throw new Error("getAuthToken must be a function");
  }

  // Store pending requests that need retrying after token refresh
  const pendingRequests = new WeakMap();
  const requestTracker = [];
  let isRefreshing = false;

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

        try {
          // Check if we should trigger token refresh
          if (shouldRefreshToken(error) && !originalRequest._retry) {
            // Mark this request as being processed
            pendingRequests.set(originalRequest, true);
            requestTracker.push(originalRequest);
            originalRequest._retry = true;

            // Start refresh token process if not already in progress
            if (!isRefreshing) {
              isRefreshing = true;
              onStatusChange("refreshing");

              try {
                // Call the provided refresh token function
                const newToken = await refreshTokenFn();
                onStatusChange("success");

                // Process all pending requests with the new token
                for (let i = requestTracker.length - 1; i >= 0; i--) {
                  const request = requestTracker[i];

                  if (pendingRequests.get(request)) {
                    if (newToken) {
                      request.headers["Authorization"] = `Bearer ${newToken}`;
                    }

                    // Retry the request
                    pendingRequests.delete(request);
                    requestTracker.splice(i, 1);

                    // If this is the current request, return the axios call to avoid duplicate Promise.reject
                    if (request === originalRequest) {
                      return axios(request);
                    } else {
                      axios(request);
                    }
                  }
                }
              } catch (refreshError) {
                onStatusChange("failed");
                // Handle refresh token failure
                requestTracker.forEach((request) => pendingRequests.delete(request));
                requestTracker.length = 0;
              } finally {
                isRefreshing = false;
              }
            } else if (pendingRequests.get(originalRequest)) {
              // If refresh is in progress, wait for it to complete before rejecting
              return new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                  if (!isRefreshing) {
                    clearInterval(checkInterval);
                    // If the request is no longer in pending, it was processed successfully
                    if (!pendingRequests.get(originalRequest)) {
                      resolve();
                    } else {
                      // If still pending after refresh completed, reject it
                      pendingRequests.delete(originalRequest);
                      reject(error);
                    }
                  }
                }, 100);
              });
            }
          }
        } catch (interceptorError) {
          console.error("Error in refresh token interceptor:", interceptorError);

          if (isRefreshing) {
            onStatusChange("error");
            requestTracker.forEach((request) => pendingRequests.delete(request));
            requestTracker.length = 0;
            isRefreshing = false;
          }
        }

        return Promise.reject(error);
      }
    );
  };
}

export default createRefreshTokenPlugin;
