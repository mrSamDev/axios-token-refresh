/**
 * Axios plugin for automatic token refresh. On an auth failure the plugin
 * queues the request, refreshes the token, and retries the queue with the new
 * token. Concurrent failures during a refresh share one refresh promise.
 *
 * @module
 */

import { createRefreshTokenPlugin } from './refresh-token-plugin';

export type { RefreshTokenPluginOptions, RefreshStatus } from './plugin-options';
export type { AccessTokenStore } from './access-token-store';
export { createLocalStorageTokenStore, createSessionStorageTokenStore } from './access-token-store';

export { createRefreshTokenPlugin };
export default createRefreshTokenPlugin;
