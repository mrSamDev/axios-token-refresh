# @mrsamdev/axios-token-refresh

[![npm version](https://img.shields.io/npm/v/@mrsamdev/axios-token-refresh.svg)](https://www.npmjs.com/package/@mrsamdev/axios-token-refresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An Axios plugin that refreshes your auth token when a request fails, queues the failed requests, and replays them once a fresh token arrives. One 401, one refresh, everyone retried.

It's a thin wrapper over Axios interceptors, written for my own apps. It works and it's tested, but read the code before you bet production traffic on it.

## What you get

- Refreshes the token on 401s, or on any condition you define with `shouldRefreshToken`
- Queues failed requests while the refresh runs, then retries them with the new token
- Parks mid-refresh requests too, so nothing leaves with a stale token (`pauseRequestsWhileRefreshing`)
- Injects the current token into outgoing requests (`autoInjectToken`)
- `AccessTokenStore` abstraction: the library reads, persists, and clears tokens for you, with `createLocalStorageTokenStore` / `createSessionStorageTokenStore` built in
- `refreshTokenFn` controls the whole token lifecycle through its return type: string, `null`, or throw
- Retries the refresh itself with `maxRetryAttempts`, `retryDelay`, and a per-attempt `AbortSignal`
- Caps the retry queue with `maxQueueSize` and the retry burst with `maxConcurrentRetries`
- Lifecycle hooks: `onRefreshStart`, `onRefreshSuccess`, `onRefreshFail`, plus `onStatusChange` for UI state
- `onHookError` surfaces failures from your own hooks; `silent` drops the console fallback
- Per-request opt-out via `skipAuthRefresh`, optional dedupe via `getRequestKey`
- Custom Authorization header format via `authHeaderFormatter`
- ESM, CommonJS, and full TypeScript types

## Installation

```bash
pnpm add @mrsamdev/axios-token-refresh
# or
npm install @mrsamdev/axios-token-refresh
# or
yarn add @mrsamdev/axios-token-refresh
```

## Development

Everything runs through pnpm. The library lives in `src/index.ts`.

```
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown; CJS/ESM plus type declarations into dist/
pnpm test        # Vitest, node environment
pnpm test:coverage
pnpm fmt         # oxfmt; fmt:check for CI
pnpm lint
```

## Usage

### Basic example with `AccessTokenStore` (recommended)

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
  // The library owns persistence. You return the new token, it stores it.
  accessTokenStore: createLocalStorageTokenStore('token'),

  refreshTokenFn: async () => {
    const response = await axios.post('https://api.example.com/refresh-token', {
      refresh_token: localStorage.getItem('refreshToken'),
    });
    return response.data.access_token;
  },
});

refreshPlugin.attach(apiClient);

export default apiClient;
```

### Basic example with `getAuthToken` (legacy)

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
    localStorage.setItem('token', newToken); // you persist it yourself this time
    return newToken;
  },

  getAuthToken: () => localStorage.getItem('token'),
});

refreshPlugin.attach(apiClient);

export default apiClient;
```

`getAuthToken` and `accessTokenStore` are mutually exclusive. Pick one. The library throws if you pass both.

### Advanced configuration

```javascript
const refreshPlugin = createRefreshTokenPlugin({
  // ... other options

  authHeaderFormatter: (token) => `Custom ${token}`, // default: `Bearer ${token}`
  refreshTimeout: 15000, // 15 seconds, default is 10000ms
  maxRetryAttempts: 3, // total refresh attempts, including the first
  retryDelay: 300, // ms between refresh attempts
  getRequestKey: (request) =>
    `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`,

  // Decide yourself when a refresh is warranted
  shouldRefreshToken: (error) => {
    return (
      // 401 Unauthorized
      (error.response && error.response.status === 401) ||
      // a specific error body
      (error.response && error.response.data && error.response.data.error === 'token_expired') ||
      // network errors, but only if we hold a token
      (error.message === 'Network Error' && localStorage.getItem('token'))
    );
  },
});
```

### Skip refresh for specific requests

The refresh endpoint shouldn't trigger a refresh, and public endpoints don't need one at all. Pass `skipAuthRefresh: true` and the plugin ignores that request entirely:

```typescript
apiClient.get('/public-profile', {
  skipAuthRefresh: true,
});
```

If TypeScript complains about the custom property, add module augmentation once in your project:

```typescript
import 'axios';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    skipAuthRefresh?: boolean;
  }
}
```

### Parking requests during a refresh

With the default `pauseRequestsWhileRefreshing: true`, the request interceptor holds outgoing requests while a refresh is in flight, then releases them with the fresh token. Turn it off and those requests race out with the stale token, 401, and pile into the retry queue. Every one of them hits your API twice.

Parked requests follow the queue's failure rules. If the refresh fails, or `refreshTokenFn` returns `null`, they're rejected with the same `Token refresh failed` error instead of flying with a dead token. Plugin cleanup rejects them immediately. Requests with `skipAuthRefresh: true` and requests without a token are never parked, so a public call never waits on someone else's refresh.

```typescript
createRefreshTokenPlugin({
  // ... other options
  pauseRequestsWhileRefreshing: true, // default
});
```

The hold works independently of `autoInjectToken`. With `autoInjectToken: false` requests still get parked, but your headers stay your business. Set `pauseRequestsWhileRefreshing: false` for the old fire-immediately behavior.

### Bounding the retry queue

`maxQueueSize` caps how many requests may wait for the refresh. When the queue is full, the newest refreshable request is rejected with `Token refresh queue is full`, so the caller can back off instead of filling memory. The default is unlimited, so set it if you expect bursts.

```typescript
createRefreshTokenPlugin({
  maxQueueSize: 100,
});
```

### `AccessTokenStore`

The `AccessTokenStore` interface abstracts token persistence. The library reads the current token from it, stores refreshed tokens into it, and clears it when auth ends. Provide `getAuthToken` or `accessTokenStore`, never both.

```typescript
import type { AccessTokenStore } from '@mrsamdev/axios-token-refresh';

interface AccessTokenStore {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
  clear?(): void;
}
```

- `getAccessToken` returns the current token. Used for request injection and the default `shouldRefreshToken` check.
- `setAccessToken` stores a refreshed token. The library calls it after a successful refresh.
- `clear` is optional. The library calls it when `refreshTokenFn` returns `null`. Omit it and the library leaves the token alone on failure.

#### Built-in helpers

```typescript
import {
  createLocalStorageTokenStore,
  createSessionStorageTokenStore,
} from '@mrsamdev/axios-token-refresh';

const localStorageStore = createLocalStorageTokenStore('token');
const sessionStorageStore = createSessionStorageTokenStore('token');
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

`refreshTokenFn` has three outcomes, and the library treats each differently:

| Return   | Meaning                | What the library does                                             |
| -------- | ---------------------- | ----------------------------------------------------------------- |
| `string` | Refresh succeeded      | Stores the token via `accessTokenStore.setAccessToken`, then retries the queued requests |
| `null`   | Auth is over           | Calls `accessTokenStore.clear?.()`, then rejects the queued requests |
| `throw`  | Network or server error | Retries per `maxRetryAttempts`; if all attempts fail, rejects the queued requests **without clearing the token** |

You steer the token lifecycle with the return type. Return `null` when the refresh token is dead. Throw when the failure might be transient and let the retry policy sort it out:

```typescript
refreshTokenFn: async (signal) => {
  try {
    // Forward the AbortSignal so a timeout or cleanup stops this call
    // instead of letting it overlap the next attempt.
    const res = await axios.post('/refresh', { refresh_token: getRefreshToken() }, { signal });
    return res.data.access_token;
  } catch (e) {
    if (e.response?.status === 401) return null; // refresh token is dead: clear
    throw e; // transient: retry, don't clear
  }
};
```

Each retry attempt gets a fresh `AbortSignal`. It aborts when that attempt times out, when the handle is aborted, or when the plugin is cleaned up. Ignoring the signal is fine, the refresh still settles on its own. But the old attempt keeps running in the background while the retry fires, so keep `refreshTokenFn` idempotent.

### Lifecycle hooks

Three hooks run alongside `onStatusChange`:

```typescript
createRefreshTokenPlugin({
  // ... other options

  onRefreshStart: () => {
    // a refresh has begun
  },

  onRefreshSuccess: (token: string) => {
    analytics.track('refresh_success');
  },

  onRefreshFail: (error: Error) => {
    // thrown error or null return, either way auth didn't survive
    redirectToLogin();
  },

  // kept for state tracking, e.g. loading spinners
  onStatusChange: (status) => {
    loadingStore.set(status === 'refreshing');
  },
});
```

`onStatusChange` and the hooks do different jobs. `onStatusChange` answers "what state is the system in", which suits UI bindings. The hooks answer "this specific thing happened", which suits side effects: analytics, cache invalidation, redirects.

`onStatusChange` receives a third argument with context:

```typescript
onStatusChange: (status, error, context) => {
  // context.queueDepth: requests waiting in the retry queue
  // context.attemptCount: which refresh attempt is running, 1-based
  loadingStore.set(status === 'refreshing');
  metrics.recordQueueDepth(context.queueDepth);
},
```

#### Hook failure visibility

A throwing hook never breaks the refresh flow; the queue always settles. But failures get surfaced, not swallowed:

```typescript
createRefreshTokenPlugin({
  // ... other options

  onHookError: (error, hookName) => {
    // Runs when onStatusChange, onRefreshStart, onRefreshSuccess,
    // or onRefreshFail throws. Log it, report it. Don't rethrow blindly,
    // a throwing onHookError falls back to console.error.
    sentry.captureException(error, { tags: { hook: hookName } });
  },
});
```

Without `onHookError`, or when it itself throws, the failure falls back to `console.error` so it stays visible. Set `silent: true` to drop the fallback on runtimes where stderr is loud, like serverless or edge.

## TypeScript Usage

The package ships its own type definitions:

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

### Exports

- `createRefreshTokenPlugin(options)`, also the default export
- `createLocalStorageTokenStore(key)` and `createSessionStorageTokenStore(key)`
- Types: `RefreshTokenPluginOptions`, `RefreshStatus`, `AccessTokenStore`, `RetryableRequestConfig`, `RefreshFailedError`

`RetryableRequestConfig` is Axios config plus the `_retry` and `skipAuthRefresh` flags. `RefreshFailedError` carries `originalError` and is what queued requests get rejected with when a refresh fails.

### `createRefreshTokenPlugin(options)`

Creates the plugin. Install it with `refreshPlugin.attach(apiClient)`, which returns a cleanup function.

Calling the plugin itself, `refreshPlugin(apiClient)`, still works but is deprecated and will be removed. Use `attach`.

#### Options

| Option                   | Type                                                       | Required | Default                        | Description                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `refreshTokenFn`         | `(signal: AbortSignal) => Promise<string \| null>`         | Yes      |                                | Refreshes the token. Return a string, `null` (auth over), or throw (retryable). See the [return contract](#refreshtokenfn-return-contract). |
| `getAuthToken`           | `() => string \| null`                                     | One of\* |                                | Returns the current auth token. Mutually exclusive with `accessTokenStore`.                                                                   |
| `accessTokenStore`       | `AccessTokenStore`                                         | One of\* |                                | Storage abstraction for the token. The library persists on refresh and clears on `null`. Mutually exclusive with `getAuthToken`.              |
| `shouldRefreshToken`     | `(error: AxiosError, originalRequest: object) => boolean`   | No       | 401s and network errors        | Decides whether an error triggers a refresh.                                                                                                  |
| `onStatusChange`         | `(status: string, error?: Error, context?: object) => void` | No       | No-op                          | Status updates: `"refreshing"`, `"success"`, `"failed"`, or `"error"`.                                                                       |
| `onRefreshStart`         | `() => void`                                               | No       |                                | Runs when a refresh begins.                                                                                                                   |
| `onRefreshSuccess`       | `(token: string) => void`                                  | No       |                                | Runs on success, with the new token.                                                                                                          |
| `onRefreshFail`          | `(error: Error) => void`                                   | No       |                                | Runs on failure, thrown error or `null` return.                                                                                               |
| `onHookError`            | `(error: Error, hookName: string) => void`                  | No       | `console.error` fallback       | Runs when one of your hooks throws. If omitted, or if it throws too, failures fall back to `console.error`.                                    |
| `authHeaderFormatter`    | `(token: string) => string`                                 | No       | ``(token) => `Bearer ${token}` `` | Formats the Authorization header value.                                                                                                    |
| `getRequestKey`          | `(request: AxiosRequestConfig) => string`                  | No       | Off                            | Dedupe key for queued retries. Requests sharing a key share one retry. Omit it and every failed request retries on its own.                  |
| `refreshTimeout`         | `number`                                                    | No       | `10000`                        | How long one refresh attempt may run, in ms.                                                                                                  |
| `maxRetryAttempts`       | `number`                                                    | No       | `1`                            | Total refresh attempts before giving up. Integer, at least 1.                                                                                 |
| `retryDelay`              | `number`                                                    | No       | `0`                            | Delay between refresh attempts, in ms. At least 0.                                                                                           |
| `maxConcurrentRetries`   | `number`                                                    | No       | Unlimited                      | How many retried requests may be in flight at once after a refresh. Integer, at least 1. Tames the burst when many requests fail together.    |
| `autoInjectToken`        | `boolean`                                                   | No       | `true`                         | Installs a request interceptor that puts the current token on outgoing requests.                                                              |
| `pauseRequestsWhileRefreshing` | `boolean`                                            | No       | `true`                         | Holds outgoing requests while a refresh runs, then releases them with the fresh token.                                                       |
| `maxQueueSize`           | `number`                                                    | No       | Unlimited                      | Caps the retry queue. When full, the newest refreshable request is rejected with `Token refresh queue is full`.                                |
| `silent`                 | `boolean`                                                   | No       | `false`                        | Drops the `console.error` fallback for hook failures. Handy on runtimes where stderr costs you.                                              |

\* Provide exactly one of `getAuthToken` or `accessTokenStore`.

### Built-in helpers

| Helper                           | Type                                 | Description                                |
| -------------------------------- | ------------------------------------ | ------------------------------------------ |
| `createLocalStorageTokenStore`   | `(key: string) => AccessTokenStore`  | Creates a store backed by `localStorage`.  |
| `createSessionStorageTokenStore` | `(key: string) => AccessTokenStore`  | Creates a store backed by `sessionStorage`. |

## How It Works

1. A request fails. The interceptor checks it against `shouldRefreshToken`.
2. If it qualifies, the request goes into the queue and a refresh starts, unless one is already running.
3. The refresh runs up to `maxRetryAttempts` times, with `retryDelay` between attempts.
4. `refreshTokenFn` returns a string: the token is stored via `accessTokenStore.setAccessToken` and every queued request retries with it.
5. It returns `null`: `accessTokenStore.clear?.()` runs and the queued requests are rejected. Auth is over.
6. It throws, all attempts spent: the queued requests are rejected with the full error. The token survives, since the failure might be transient.
7. With `autoInjectToken` on (the default), a request interceptor puts the current token on outgoing requests. No manual interceptor needed.

`refreshTimeout` bounds how long the library waits for one attempt. On timeout, that attempt's `AbortSignal` aborts. Forward it into your HTTP call to actually stop the work; a `refreshTokenFn` that ignores the signal keeps running in the background while the next retry fires immediately. Keep the function idempotent and this can't hurt you.

## Error Handling

When something goes wrong, the plugin reports rather than guesses. It covers refresh timeouts, errors thrown by `refreshTokenFn`, a `null` return (auth over), and errors inside the interceptor itself. Each surfaces through `onStatusChange`, `onRefreshFail`, and the rejected promises of the pending requests. What the user sees is your call.

## Compatibility

Works with Axios v0.21.0 and above.

## License

MIT