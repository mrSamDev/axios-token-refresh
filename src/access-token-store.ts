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

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type WebStorageName = 'localStorage' | 'sessionStorage';

// Read via globalThis so a missing Web Storage surfaces as undefined instead
// of Node's ReferenceError on the bare lazy global.
const webStorage = (name: WebStorageName): WebStorage | undefined =>
  (globalThis as unknown as Record<string, WebStorage | undefined>)[name];

const createWebStorageTokenStore = (name: WebStorageName, key: string): AccessTokenStore => {
  const getStorage = (): WebStorage => {
    const storage = webStorage(name);
    if (!storage) {
      throw new Error(`${name} is not available in this environment`);
    }
    return storage;
  };

  return {
    getAccessToken: () => getStorage().getItem(key),
    setAccessToken: (token) => {
      getStorage().setItem(key, token);
    },
    clear: () => {
      getStorage().removeItem(key);
    },
  };
};

/** Back an {@link AccessTokenStore} with `localStorage` under `key`. */
export function createLocalStorageTokenStore(key: string): AccessTokenStore {
  return createWebStorageTokenStore('localStorage', key);
}

/** Back an {@link AccessTokenStore} with `sessionStorage` under `key`. */
export function createSessionStorageTokenStore(key: string): AccessTokenStore {
  return createWebStorageTokenStore('sessionStorage', key);
}
