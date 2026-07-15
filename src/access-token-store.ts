/**
 * Storage-agnostic abstraction for the access token.
 *
 * Provides a minimal interface — read, write, and optionally clear — that
 * lets the library own token persistence without assuming any specific
 * storage backend (localStorage, sessionStorage, cookies, Zustand, Redux,
 * React Native AsyncStorage, etc.).
 *
 * Built-in helpers:
 * - {@link createLocalStorageTokenStore}
 * - {@link createSessionStorageTokenStore}
 *
 * @module
 */

/**
 * Storage abstraction for the access token.
 *
 * Implement this interface to plug in any storage backend. The library uses
 * `getAccessToken` for token injection and the default `shouldRefreshToken`
 * predicate, `setAccessToken` to persist a refreshed token automatically, and
 * `clear` (if provided) to remove a stale token when `refreshTokenFn` returns
 * `null` — signalling that authentication is over.
 *
 * `clear` is optional. If omitted, the library will not touch the stored token
 * on refresh failure; the consumer retains full control over token
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
  /**
   * Read the current access token, or `null` if none is available.
   */
  getAccessToken(): string | null;

  /**
   * Persist a new access token after a successful refresh.
   *
   * @param token The freshly obtained access token.
   */
  setAccessToken(token: string): void;

  /**
   * Remove the access token from storage. Called when `refreshTokenFn`
   * resolves with `null` — signalling that authentication is definitively
   * over (e.g. the refresh token itself has expired).
   *
   * Optional: if not provided, the library will not clear the token on
   * failure. The consumer is then responsible for any cleanup.
   */
  clear?(): void;
}

/**
 * Create an {@link AccessTokenStore} backed by `localStorage`.
 *
 * @param key The localStorage key used to store the access token.
 * @returns An {@link AccessTokenStore} instance.
 *
 * @example
 * ```ts
 * const store = createLocalStorageTokenStore("access_token");
 * ```
 */
export function createLocalStorageTokenStore(key: string): AccessTokenStore {
  return {
    getAccessToken: () => localStorage.getItem(key),
    setAccessToken: (token) => localStorage.setItem(key, token),
    clear: () => localStorage.removeItem(key),
  };
}

/**
 * Create an {@link AccessTokenStore} backed by `sessionStorage`.
 *
 * @param key The sessionStorage key used to store the access token.
 * @returns An {@link AccessTokenStore} instance.
 *
 * @example
 * ```ts
 * const store = createSessionStorageTokenStore("access_token");
 * ```
 */
export function createSessionStorageTokenStore(key: string): AccessTokenStore {
  return {
    getAccessToken: () => sessionStorage.getItem(key),
    setAccessToken: (token) => sessionStorage.setItem(key, token),
    clear: () => sessionStorage.removeItem(key),
  };
}
