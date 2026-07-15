/**
 * Storage-agnostic abstraction for the access token. Plug in any backend
 * (localStorage, cookies, Zustand, AsyncStorage, etc.).
 *
 * @module
 */

/**
 * Implement this to plug in a storage backend. The library reads via
 * `getAccessToken`, persists refreshed tokens via `setAccessToken`, and
 * removes a stale token via `clear` (if defined) when `refreshTokenFn` returns
 * `null`. `clear` is optional: omit it to keep full control over token
 * destruction.
 *
 * @example
 * ```ts
 * const store: AccessTokenStore = {
 *   getAccessToken: () => localStorage.getItem("token"),
 *   setAccessToken: (token) => localStorage.setItem("token", token),
 *   clear: () => localStorage.removeItem("token"),
 * };
 * ```
 */
export interface AccessTokenStore {
  getAccessToken(): string | null;

  setAccessToken(token: string): void;

  /** Called when `refreshTokenFn` returns `null` (auth is over). Optional. */
  clear?(): void;
}

/** Back an {@link AccessTokenStore} with `localStorage` under `key`. */
export function createLocalStorageTokenStore(key: string): AccessTokenStore {
  return {
    getAccessToken: () => localStorage.getItem(key),
    setAccessToken: (token) => localStorage.setItem(key, token),
    clear: () => localStorage.removeItem(key),
  };
}

/** Back an {@link AccessTokenStore} with `sessionStorage` under `key`. */
export function createSessionStorageTokenStore(key: string): AccessTokenStore {
  return {
    getAccessToken: () => sessionStorage.getItem(key),
    setAccessToken: (token) => sessionStorage.setItem(key, token),
    clear: () => sessionStorage.removeItem(key),
  };
}
