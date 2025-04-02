import { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";

export interface RefreshTokenPluginOptions {
  /**
   * Async function that refreshes the token and returns the new token
   */
  refreshTokenFn: () => Promise<string | null>;

  /**
   * Function that returns the current auth token
   */
  getAuthToken: () => string | null;

  /**
   * Function that determines if token refresh should be triggered
   * @default (error, originalRequest) => {
   *   const statusCode = error?.response ? error.response.status : "Network Error";
   *   return (statusCode === 401 || statusCode === "Network Error") && getAuthToken();
   * }
   */
  shouldRefreshToken?: (error: AxiosError, originalRequest: AxiosRequestConfig) => boolean;

  /**
   * Callback for token refresh status updates
   * @default (status) => { console.log(`Token refresh status: ${status}`); }
   */
  onStatusChange?: (status: "refreshing" | "success" | "failed" | "error") => void;
}

/**
 * Creates and returns an axios interceptor plugin that handles token refresh
 */
export function createRefreshTokenPlugin(options: RefreshTokenPluginOptions): (axios: AxiosInstance) => void;

export default createRefreshTokenPlugin;
