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
- ⏰ Configurable timeout for token refresh operations
- 🔑 Customizable auth header formatting
- 🧠 Customizable request dedupe key via `getRequestKey`
- 🚫 Per-request refresh opt-out with `skipAuthRefresh`
- 🔁 Configurable refresh retry policy (`maxRetryAttempts`, `retryDelay`)
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
- Build: `pnpm build` (Vite library mode; outputs CJS/ESM + minified variants to `dist/`)
- Tests: `pnpm test` (Vitest, node environment)
- Coverage: `pnpm test:coverage`
- Library source: `src/index.ts`

## Usage

### Basic Example

```javascript
import axios from "axios";
import { createRefreshTokenPlugin } from "@mrsamdev/axios-token-refresh";

// Create an axios instance
const apiClient = axios.create({
  baseURL: "https://api.example.com",
  headers: {
    "Content-Type": "application/json",
  },
});

// Configure the refresh token plugin
const refreshPlugin = createRefreshTokenPlugin({
  // Function to refresh the token
  refreshTokenFn: async () => {
    // Implement your token refresh logic here
    const response = await axios.post("https://api.example.com/refresh-token", {
      refresh_token: localStorage.getItem("refreshToken"),
    });

    const newToken = response.data.access_token;
    localStorage.setItem("token", newToken);

    return newToken;
  },

  // Function to get the current token
  getAuthToken: () => localStorage.getItem("token"),

  // Optional: Custom condition for when to refresh token
  shouldRefreshToken: (error) => error.response && error.response.status === 401,

  // Optional: Status change callback
  onStatusChange: (status, error) => {
    console.log(`Token refresh status: ${status}`);
    if (error) {
      console.error("Token refresh error:", error);
    }
    // status can be: "refreshing", "success", "failed", "error"
  },
});

// Apply the plugin to your axios instance
refreshPlugin(apiClient);

// Now use your apiClient for all API calls
export default apiClient;
```

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
  getRequestKey: (request) => `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`,

  shouldRefreshToken: (error) => {
    // Custom logic to determine when to refresh the token
    return (
      // Refresh on 401 Unauthorized
      (error.response && error.response.status === 401) ||
      // Refresh on specific error message
      (error.response && error.response.data && error.response.data.error === "token_expired") ||
      // Refresh on network errors when token exists
      (error.message === "Network Error" && localStorage.getItem("token"))
    );
  },
});
```

### Skip Refresh For Specific Requests

Use `skipAuthRefresh: true` to bypass refresh logic for endpoints like login/logout/refresh:

```typescript
apiClient.get("/public-profile", {
  skipAuthRefresh: true,
});
```

If TypeScript complains about this custom config property, add module augmentation once in your project:

```typescript
import "axios";

declare module "axios" {
  interface InternalAxiosRequestConfig {
    skipAuthRefresh?: boolean;
  }
}
```

## TypeScript Usage

For TypeScript projects, you can take advantage of the built-in type definitions:

```typescript
import axios, { AxiosError } from "axios";
import { createRefreshTokenPlugin, RefreshTokenPluginOptions } from "@mrsamdev/axios-token-refresh";

// Create plugin with full type support
const options: RefreshTokenPluginOptions = {
  refreshTokenFn: async () => {
    // Implementation with full type checking
    return "new-token";
  },
  getAuthToken: () => localStorage.getItem("token"),
  shouldRefreshToken: (error: AxiosError) => {
    return !!error.response && error.response.status === 401;
  },
};

const refreshPlugin = createRefreshTokenPlugin(options);
```

## API Reference

### `createRefreshTokenPlugin(options)`

Creates an Axios interceptor plugin that handles token refresh.

#### Options

| Option                | Type                                                      | Required | Default                                 | Description                                                                                                                |
| --------------------- | --------------------------------------------------------- | -------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `refreshTokenFn`      | `() => Promise<string \| null>`                           | Yes      | -                                       | Async function that refreshes the token and returns the new token.                                                         |
| `getAuthToken`        | `() => string \| null`                                    | Yes      | -                                       | Function that returns the current auth token.                                                                              |
| `shouldRefreshToken`  | `(error: AxiosError, originalRequest: object) => boolean` | No       | Checks for 401 status or network errors | Function that determines if token refresh should be triggered.                                                             |
| `onStatusChange`      | `(status: string, error?: Error) => void`                 | No       | Console log function                    | Callback for token refresh status updates with error details. Status can be "refreshing", "success", "failed", or "error". |
| `authHeaderFormatter` | `(token: string) => string`                               | No       | `(token) => Bearer ${token}`            | Function to format the authorization header value.                                                                         |
| `getRequestKey`       | `(request: AxiosRequestConfig) => string`                 | No       | `method-url-params`                     | Custom dedupe key for queued retries. Use this to include fields like `data` to avoid collisions.                         |
| `refreshTimeout`      | `number`                                                  | No       | `10000` (10 seconds)                    | Timeout for token refresh operation in milliseconds.                                                                       |
| `maxRetryAttempts`    | `number`                                                  | No       | `1`                                     | Number of refresh attempts before failing. Must be an integer greater than or equal to 1.                                 |
| `retryDelay`          | `number`                                                  | No       | `0`                                     | Delay in milliseconds between refresh retry attempts. Must be greater than or equal to 0.                                 |

## How It Works

1. When an API call fails, the interceptor checks if the error meets the criteria for token refresh.
2. If token refresh is needed, it queues the failed request and starts the token refresh process (if not already in progress).
3. The refresh operation is attempted up to `maxRetryAttempts` times with optional `retryDelay` between attempts.
4. If refresh attempts fail (including timeout), all queued requests are rejected with detailed error information.
5. Once the token is refreshed, all queued requests are automatically retried with the new token.

## Error Handling

The plugin now provides more detailed error information when token refresh fails:

- Token refresh timeouts
- Errors in the refresh token function
- Errors in the interceptor itself

All errors are properly propagated to your application through:

- The onStatusChange callback (with error details)
- The rejected promises of pending requests

## Compatibility

This plugin is compatible with Axios v0.21.0 and above.

## License

MIT
