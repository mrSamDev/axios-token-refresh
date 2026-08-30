import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createLocalStorageTokenStore,
  createSessionStorageTokenStore,
} from '../src/access-token-store';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const stubStorage = (): StorageLike => ({
  getItem: vi.fn(() => 'stored-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

const installStorage = (
  name: 'localStorage' | 'sessionStorage',
  storage: StorageLike | undefined,
) => {
  (globalThis as Record<string, unknown>)[name] = storage;
};

const removeStorage = (name: 'localStorage' | 'sessionStorage') => {
  delete (globalThis as Record<string, unknown>)[name];
};

afterEach(() => {
  removeStorage('localStorage');
  removeStorage('sessionStorage');
});

describe('storage helpers without Web Storage (SSR)', () => {
  test('localStorage store methods name the missing environment instead of a TypeError', () => {
    removeStorage('localStorage');
    const store = createLocalStorageTokenStore('token');

    expect(() => store.getAccessToken()).toThrow('localStorage is not available');
    expect(() => store.setAccessToken('t')).toThrow('localStorage is not available');
    expect(() => store.clear?.()).toThrow('localStorage is not available');
  });

  test('sessionStorage store methods name the missing environment', () => {
    removeStorage('sessionStorage');
    const store = createSessionStorageTokenStore('token');

    expect(() => store.getAccessToken()).toThrow('sessionStorage is not available');
    expect(() => store.setAccessToken('t')).toThrow('sessionStorage is not available');
    expect(() => store.clear?.()).toThrow('sessionStorage is not available');
  });
});

describe('storage helpers with Web Storage', () => {
  test('delegates read, write, and clear to the storage', () => {
    const storage = stubStorage();
    installStorage('localStorage', storage);
    const store = createLocalStorageTokenStore('token');

    expect(store.getAccessToken()).toBe('stored-token');
    store.setAccessToken('fresh');
    store.clear?.();

    expect(storage.getItem).toHaveBeenCalledWith('token');
    expect(storage.setItem).toHaveBeenCalledWith('token', 'fresh');
    expect(storage.removeItem).toHaveBeenCalledWith('token');
  });

  test('quota or privacy-mode write failures propagate instead of being swallowed', () => {
    const storage = stubStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    installStorage('localStorage', storage);
    const store = createLocalStorageTokenStore('token');

    expect(() => store.setAccessToken('too-big')).toThrow('QuotaExceededError');
  });
});
