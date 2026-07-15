import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createLocalStorageTokenStore,
  createSessionStorageTokenStore,
  type AccessTokenStore,
} from '../src/access-token-store';

// ---------------------------------------------------------------------------
// In-memory Storage mock (localStorage / sessionStorage are not available in
// the node test environment).
// ---------------------------------------------------------------------------
function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn(() => null),
    length: 0,
  } as unknown as Storage;
}

// ---------------------------------------------------------------------------
// createLocalStorageTokenStore
// ---------------------------------------------------------------------------
describe('createLocalStorageTokenStore', () => {
  let mockStorage: Storage;
  let original: Storage | undefined;

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>).localStorage;
    } else {
      globalThis.localStorage = original;
    }
  });

  test('returns an AccessTokenStore', () => {
    const store = createLocalStorageTokenStore('token');
    expect(typeof store.getAccessToken).toBe('function');
    expect(typeof store.setAccessToken).toBe('function');
    expect(typeof store.clear).toBe('function');
  });

  test('getAccessToken returns null when no token is stored', () => {
    const store = createLocalStorageTokenStore('token');
    expect(store.getAccessToken()).toBeNull();
  });

  test('setAccessToken stores the token and getAccessToken retrieves it', () => {
    const store = createLocalStorageTokenStore('token');
    store.setAccessToken('my-jwt');
    expect(store.getAccessToken()).toBe('my-jwt');
    expect(mockStorage.getItem).toHaveBeenCalledWith('token');
    expect(mockStorage.setItem).toHaveBeenCalledWith('token', 'my-jwt');
  });

  test('clear removes the token', () => {
    const store = createLocalStorageTokenStore('token');
    store.setAccessToken('my-jwt');
    store.clear?.();
    expect(store.getAccessToken()).toBeNull();
    expect(mockStorage.removeItem).toHaveBeenCalledWith('token');
  });

  test('uses a custom key', () => {
    const store = createLocalStorageTokenStore('access_token');
    store.setAccessToken('abc');
    expect(mockStorage.setItem).toHaveBeenCalledWith('access_token', 'abc');
    store.clear?.();
    expect(mockStorage.removeItem).toHaveBeenCalledWith('access_token');
  });

  test('overwrites previous token on setAccessToken', () => {
    const store = createLocalStorageTokenStore('token');
    store.setAccessToken('first');
    store.setAccessToken('second');
    expect(store.getAccessToken()).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// createSessionStorageTokenStore
// ---------------------------------------------------------------------------
describe('createSessionStorageTokenStore', () => {
  let mockStorage: Storage;
  let original: Storage | undefined;

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>).sessionStorage;
    } else {
      globalThis.sessionStorage = original;
    }
  });

  test('returns an AccessTokenStore', () => {
    const store = createSessionStorageTokenStore('token');
    expect(typeof store.getAccessToken).toBe('function');
    expect(typeof store.setAccessToken).toBe('function');
    expect(typeof store.clear).toBe('function');
  });

  test('getAccessToken returns null when no token is stored', () => {
    const store = createSessionStorageTokenStore('token');
    expect(store.getAccessToken()).toBeNull();
  });

  test('setAccessToken stores the token', () => {
    const store = createSessionStorageTokenStore('token');
    store.setAccessToken('my-jwt');
    expect(store.getAccessToken()).toBe('my-jwt');
    expect(mockStorage.setItem).toHaveBeenCalledWith('token', 'my-jwt');
  });

  test('clear removes the token', () => {
    const store = createSessionStorageTokenStore('token');
    store.setAccessToken('my-jwt');
    store.clear?.();
    expect(store.getAccessToken()).toBeNull();
    expect(mockStorage.removeItem).toHaveBeenCalledWith('token');
  });
});

// ---------------------------------------------------------------------------
// AccessTokenStore type is structurally compatible with a minimal object
// ---------------------------------------------------------------------------
describe('AccessTokenStore interface compliance', () => {
  test('a minimal store with getAccessToken + setAccessToken satisfies AccessTokenStore', () => {
    const minimal: AccessTokenStore = {
      getAccessToken: () => 'token',
      setAccessToken: () => {},
    };
    expect(minimal.getAccessToken()).toBe('token');
    expect(minimal.clear).toBeUndefined();
  });

  test('a store with clear satisfies AccessTokenStore', () => {
    let token: string | null = 'abc';
    const store: AccessTokenStore = {
      getAccessToken: () => token,
      setAccessToken: (t) => {
        token = t;
      },
      clear: () => {
        token = null;
      },
    };
    store.setAccessToken('xyz');
    expect(store.getAccessToken()).toBe('xyz');
    store.clear?.();
    expect(store.getAccessToken()).toBeNull();
  });
});
