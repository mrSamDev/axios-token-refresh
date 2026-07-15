/**
 * Axios plugin for automatic token refresh and request queueing on auth failures.
 *
 * When an API request fails with an authentication error, the plugin queues
 * the failed request, refreshes the token, and retries all queued requests
 * with the new token. Concurrent failures during an active refresh share the
 * same refresh promise and are deduplicated by request key.
 *
 * @example
 * ```ts
 * import axios from "axios";
 * import { createRefreshTokenPlugin } from "@mrsamdev/axios-token-refresh";
 *
 * const api = axios.create({ baseURL: "https://api.example.com" });
 *
 * const plugin = createRefreshTokenPlugin({
 *   refreshTokenFn: async () => {
 *     const res = await axios.post("/refresh-token", {
 *       refresh_token: localStorage.getItem("refreshToken"),
 *     });
 *     return res.data.access_token as string;
 *   },
 *   getAuthToken: () => localStorage.getItem("token"),
 * });
 *
 * // Install interceptors on the instance
 * const cleanup = plugin(api);
 *
 * // Later, to remove the interceptors:
 * cleanup();
 * ```
 *
 * @module
 */

import { createRefreshTokenPlugin } from './refresh-token-plugin';

export type { RefreshTokenPluginOptions, RefreshStatus } from './refresh-token-plugin';
export type { AccessTokenStore } from './access-token-store';
export { createLocalStorageTokenStore, createSessionStorageTokenStore } from './access-token-store';

export { createRefreshTokenPlugin };
export default createRefreshTokenPlugin;
