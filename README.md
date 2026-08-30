# @mrsamdev/axios-token-refresh

[![npm version](https://img.shields.io/npm/v/@mrsamdev/axios-token-refresh.svg)](https://www.npmjs.com/package/@mrsamdev/axios-token-refresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A robust Axios plugin that handles token refresh logic when API calls fail due to authentication issues. It automatically queues pending requests and retries them once a new token is obtained.

**Note:** This is a basic wrapper around Axios interceptors, mainly for personal use. If you're using it in production, make sure to review security, error handling, and performance aspects.

## Features

- 🔄 Automatic token refresh on 401 errors
- ⏱️ Request queueing during token refresh
- 🔁 Automatic retry of queued requests after successful token refresh
- 🔧 Customizable conditions for token refresh
- 📊 Status change notifications during token refresh
- 🪙 `AccessTokenStore` abstraction — library owns token persistence
- 🔑 Built-in `createLocalStorageTokenStore` / `createSessionStorageTokenStore` helpers
- ✅ Automatic auth token injection into outgoing requests (`autoInjectToken`)
- 🪝 Lifecycle hooks: `onRefreshStart`, `onRefreshSuccess`, `onRefreshFail`
- ⏰ Configurable timeout for token refresh operations
- 🔑 Customizable auth header formatting
- 🧠 Customizable request dedupe key via `getRequestKey`
- 🚫 Per-request refresh opt-out with `skipAuthRefresh`
- 🔁 Configurable refresh retry policy (`maxRetryAttempts`, `retryDelay`)
- 🧹 Automatic token clearing on auth-over (`refreshTokenFn` returns `null`)
- 📦 Supports ESM and CommonJS
- 🔒 TypeScript support with full type definitions

## Installation

```bash
pnpm add @mrsamdev/axios-token-refresh
```

or

```bash
npm install @mrsamdev/axios-token-refresh
```

or

```bash
yarn add @mrsamdev/axios-token-refresh
```

## Development

- Typecheck: `pnpm typecheck`
- Build: `pnpm build` (tsdown; outputs CJS/ESM + type declarations to `dist/`)
- Tests: `pnpm test` (Vitest, node environment)
- Coverage: `pnpm test:coverage`
- Format: `pnpm fmt` (oxfmt) / `pnpm fmt:check`
- Lint: `pnpm lint`
- Library source: `src/index.ts`

## Usage

### Basic Example (with `AccessTokenStore` — recommended)

```javascript
import axios from 'axios';
import {
  createRefreshTokenPlugin,
  createLocalStorageTokenStore,
} from '@mrsamdev/axios-token-refresh';

const apiClient = axios.create({
  baseURL: 'https://api.example.com',
});

const refreshPlugin = createRefreshTokenPlugin({
  // The library owns token persistence — no manual localStorage.setItem needed
  accessTokenStore: createLocalStorageTokenStore('token'),

  // Just return the new token; the library stores it automatically
  refreshTokenFn: async () => {
    const response = await axios.post('https://api.example.com/refresh-token', {
      refresh_token: localStorage.getItem('refreshToken'),
    });
    return response.data.access_token;
  },
});

refreshPlugin(apiClient);

export default apiClient;
```

### Basic Example (with `getAuthToken` — legacy)

```javascript
import axios from 'axios';
import { createRefreshTokenPlugin } from '@mrsamdev/axios-token-refresh';

const apiClient = axios.create({
  baseURL: 'https://api.example.com',
});

const refreshPlugin = createRefreshTokenPlugin({
  refreshTokenFn: async () => {
    const response = await axios.post('https://api.example.com/refresh-token', {
      refresh_token: localStorage.getItem('refreshToken'),
    });

    const newToken = response.data.access_token;
    localStorage.setItem('token', newToken); // you must persist manually
    return newToken;
  },

  getAuthToken: () => localStorage.getItem('token'),
});

refreshPlugin(apiClient);

export default apiClient;
```

> **Note:** `getAuthToken` and `accessTokenStore` are mutually exclusive — provide one or the other, not both. The library throws if both are provided.

### Advanced Configuration

You can customize when token refresh is triggered with the `shouldRefreshToken` option:

```javascript
const refreshPlugin = createRefreshTokenPlugin({
  // ... other options

  // Custom options added in latest version
  authHeaderFormatter: (token) => `Custom ${token}`, // Default: `Bearer ${token}`
  refreshTimeout: 15000, // 15 seconds timeout (default: 10000ms)
  maxRetryAttempts: 3, // Total refresh attempts including the initial attempt
  retryDelay: 300, // Delay in ms between refresh retry attempts
  getRequestKey: (request) =>
    `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`,

  shouldRefreshToken: (error) => {
    // Custom logic to determine when to refresh the token
    return (
      // Refresh on 401 Unauthorized
      (error.response && error.response.status === 401) ||
      // Refresh on specific error message
      (error.response && error.response.data && error.response.data.error === 'token_expired') ||
      // Refresh on network errors when token exists
      (error.message === 'Network Error' && localStorage.getItem('token'))
    );
  },
});
```

### Skip Refresh For Specific Requests

Use `skipAuthRefresh: true` to bypass refresh logic for endpoints like login/logout/refresh:

```typescript
apiClient.get('/public-profile', {
  skipAuthRefresh: true,
});
```

If TypeScript complains about this custom config property, add module augmentation once in your project:

```typescript
import 'axios';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    skipAuthRefresh?: boolean;
  }
}
```

### `AccessTokenStore`

The `AccessTokenStore` interface abstracts token persistence. The library uses it to read the current token, persist refreshed tokens, and (optionally) clear stale tokens. Provide one of `getAuthToken` or `accessTokenStore` — not both.

```typescript
import type { AccessTokenStore } from '@mrsamdev/axios-token-refresh';

interface AccessTokenStore {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
  clear?(): void; // optional
}
```

- **`getAccessToken`** — reads the current token. Used for request injection and the default `shouldRefreshToken` predicate.
- **`setAccessToken`** — called automatically by the library after a successful refresh.
- **`clear`** (optional) — called automatically when `refreshTokenFn` returns `null` (auth is over). If omitted, the library won't touch the token on failure.

#### Built-in helpers

```typescript
import {
  createLocalStorageTokenStore,
  createSessionStorageTokenStore,
} from '@mrsamdev/axios-token-refresh';

// localStorage-backed store
const store = createLocalStorageTokenStore('token');

// sessionStorage-backed store
const store = createSessionStorageTokenStore('token');
```

#### Custom store (cookies, Zustand, Redux, etc.)

```typescript
const cookieStore: AccessTokenStore = {
  getAccessToken: () => getCookie('token'),
  setAccessToken: (token) => setCookie('token', token),
  clear: () => deleteCookie('token'),
};
```

### `refreshTokenFn` return contract

The `refreshTokenFn` has three distinct outcomes:

| Return   | Meaning                | Library action                                                                   |
| -------- | ---------------------- | -------------------------------------------------------------------------------- |
| `string` | Refresh succeeded      | `accessTokenStore.setAccessToken(token)` then retry queued requests              |
| `null`   | Authentication is over | `accessTokenStore.clear?.()` then reject queued requests                         |
| `throw`  | Network/server failure | Retry per `maxRetryAttempts`; if all fail, reject queued requests (**no clear**) |

This lets the consumer control token lifecycle through the return type:

```typescript
refreshTokenFn: async () => {
  try {
    const res = await axios.post('/refresh', { refresh_token: getRefreshToken() });
    return res.data.access_token; // -> setAccessToken
  } catch (e) {
    if (e.response?.status === 401) {
      return null; // -> clear() -- refresh token is dead
    }
    throw e; // -> retry, don't clear
  }
};
```

### Lifecycle Hooks

The library provides three lifecycle hooks alongside the existing `onStatusChange`:

```typescript
createRefreshTokenPlugin({
  // ... other options

  onRefreshStart: () => {
    // Refresh has started
  },

  onRefreshSuccess: (token: string) => {
    // Refresh succeeded -- token is the new access token
    analytics.track('refresh_success');
  },

  onRefreshFail: (error: Error) => {
    // Refresh failed -- either thrown or null return
    redirectToLogin();
  },

  // onStatusChange is kept for state tracking (e.g. loading spinners)
  onStatusChange: (status) => {
    loadingStore.set(status === 'refreshing');
  },
});
```

`onStatusChange` and the lifecycle hooks are **complementary**, not competing:

- `onStatusChange` answers "what state is the system in?" -- useful for UI bindings
- Lifecycle hooks answer "this specific thing happened" -- useful for side effects, analytics, cache invalidation

## TypeScript Usage

For TypeScript projects, you can take advantage of the built-in type definitions:

```typescript
import axios, { AxiosError } from 'axios';
import {
  createRefreshTokenPlugin,
  createLocalStorageTokenStore,
  type RefreshTokenPluginOptions,
  type AccessTokenStore,
} from '@mrsamdev/axios-token-refresh';

// Using accessTokenStore (recommended)
const options: RefreshTokenPluginOptions = {
  accessTokenStore: createLocalStorageTokenStore('token'),
  refreshTokenFn: async () => {
    const res = await axios.post('/refresh');
    return res.data.access_token as string;
  },
  onRefreshSuccess: (token: string) => {
    console.log('New token:', token);
  },
  shouldRefreshToken: (error: AxiosError) => {
    return !!error.response && error.response.status === 401;
  },
};

// Using a custom AccessTokenStore
const customStore: AccessTokenStore = {
  getAccessToken: () => myState.token,
  setAccessToken: (token) => {
    myState.token = token;
  },
  // clear is optional
};

const refreshPlugin = createRefreshTokenPlugin(options);
```

## API Reference

### `createRefreshTokenPlugin(options)`

Creates an Axios interceptor plugin that handles token refresh.

#### Options

| Option                | Type                                                      | Required | Default                                 | Description                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------- | -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refreshTokenFn`      | `() => Promise<string \| null>`                           | Yes      | -                                       | Async function that refreshes the token. Returns the new token string, `null` (auth over), or throws (retryable failure). See [return contract](#refreshtokenfn-return-contract). |
| `getAuthToken`        | `() => string \| null`                                    | One of*  | -                                       | Function that returns the current auth token. Mutually exclusive with `accessTokenStore`.                                                                                         |
| `accessTokenStore`    | `AccessTokenStore`                                        | One of*  | -                                       | Storage abstraction for the access token. Library auto-persists on refresh and auto-clears on `null` return. Mutually exclusive with `getAuthToken`.                              |
| `shouldRefreshToken`  | `(error: AxiosError, originalRequest: object) => boolean` | No       | Checks for 401 status or network errors | Function that determines if token refresh should be triggered.                                                                                                                    |
| `onStatusChange`      | `(status: string, error?: Error) => void`                 | No       | Console log function                    | Callback for token refresh status updates. Status can be "refreshing", "success", "failed", or "error".                                                                           |
| `onRefreshStart`      | `() => void`                                              | No       | -                                       | Fired when a token refresh begins. Complementary to `onStatusChange`.                                                                                                             |
| `onRefreshSuccess`    | `(token: string) => void`                                 | No       | -                                       | Fired when refresh succeeds, with the new token string.                                                                                                                           |
| `onRefreshFail`       | `(error: Error) => void`                                  | No       | -                                       | Fired when refresh fails (thrown error or `null` return).                                                                                                                         |
| `authHeaderFormatter` | `(token: string) => string`                               | No       | `(token) => Bearer ${token}`            | Function to format the authorization header value.                                                                                                                                |
| `getRequestKey`       | `(request: AxiosRequestConfig) => string`                 | No       | `method-url-params`                     | Custom dedupe key for queued retries. Use this to include fields like `data` to avoid collisions.                                                                                 |
| `refreshTimeout`      | `number`                                                  | No       | `10000` (10 seconds)                    | Timeout for token refresh operation in milliseconds.                                                                                                                              |
| `maxRetryAttempts`    | `number`                                                  | No       | `1`                                     | Number of refresh attempts before failing. Must be an integer greater than or equal to 1.                                                                                         |
| `retryDelay`          | `number`                                                  | No       | `0`                                     | Delay in milliseconds between refresh retry attempts. Must be greater than or equal to 0.                                                                                         |
| `autoInjectToken`     | `boolean`                                                 | No       | `true`                                  | When `true`, installs a request interceptor that automatically injects the current token into outgoing requests.                                                                  |

\* Provide exactly one of `getAuthToken` or `accessTokenStore`.

### Built-in helpers

| Helper                           | Type                                | Description                                 |
| -------------------------------- | ----------------------------------- | ------------------------------------------- |
| `createLocalStorageTokenStore`   | `(key: string) => AccessTokenStore` | Creates a store backed by `localStorage`.   |
| `createSessionStorageTokenStore` | `(key: string) => AccessTokenStore` | Creates a store backed by `sessionStorage`. |

## How It Works

1. When an API call fails, the interceptor checks if the error meets the criteria for token refresh.
2. If token refresh is needed, it queues the failed request and starts the token refresh process (if not already in progress).
3. The refresh operation is attempted up to `maxRetryAttempts` times with optional `retryDelay` between attempts.
4. If `refreshTokenFn` resolves with a **string**: the token is persisted via `accessTokenStore.setAccessToken` (if provided), and all queued requests are retried with the new token.
5. If `refreshTokenFn` resolves with **`null`**: `accessTokenStore.clear?.()` is called (if provided), and all queued requests are rejected — authentication is over.
6. If `refreshTokenFn` **throws** (all retries exhausted): all queued requests are rejected with detailed error information. The token is **not** cleared (might be a transient failure).
7. If `autoInjectToken` is `true` (default), a request interceptor automatically injects the current token into outgoing requests — no manual interceptor needed.

## Error Handling

The plugin provides detailed error information when token refresh fails:

- Token refresh timeouts
- Errors in the refresh token function
- `refreshTokenFn` returning `null` (authentication is over)
- Errors in the interceptor itself

All errors are properly propagated to your application through:

- The `onStatusChange` callback (with error details)
- The `onRefreshFail` lifecycle hook (with error details)
- The rejected promises of pending requests

## Compatibility

This plugin is compatible with Axios v0.21.0 and above.

## License

MIT
