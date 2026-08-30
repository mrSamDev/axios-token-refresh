import { vi } from 'vitest';

import type { AccessTokenStore } from '../../src/access-token-store';

export function createMockStore(initialToken: string | null = 'current-token'): AccessTokenStore & {
  getAccessToken: ReturnType<typeof vi.fn>;
  setAccessToken: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  let token = initialToken;
  return {
    getAccessToken: vi.fn(() => token),
    setAccessToken: vi.fn((t: string) => {
      token = t;
    }),
    clear: vi.fn(() => {
      token = null;
    }),
  };
}
