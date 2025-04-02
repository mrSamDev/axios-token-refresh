# @mrsamdev/axios-token-refresh

[![npm version](https://img.shields.io/npm/v/@mrsamdev/axios-token-refresh.svg)](https://www.npmjs.com/package/@mrsamdev/axios-token-refresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A robust Axios plugin that handles token refresh logic when API calls fail due to authentication issues. It automatically queues pending requests and retries them once a new token is obtained.

## Features

- 🔄 Automatic token refresh on 401 errors
- ⏱️ Request queueing during token refresh
- 🔁 Automatic retry of queued requests after successful token refresh
- 🔧 Customizable conditions for token refresh
- 📊 Status change notifications during token refresh
- 📦 Supports ESM and CommonJS

## Installation

```bash
npm install @mrsamdev/axios-token-refresh
```

or

```bash
yarn add @mrsamdev/axios-token-refresh
```

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
  onStatusChange: (status) => {
    console.log(`Token refresh status: ${status}`);
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

## API Reference

### `createRefreshTokenPlugin(options)`

Creates an Axios interceptor plugin that handles token refresh.

#### Options

| Option               | Type       | Required | Description                                                                                                     |
| -------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `refreshTokenFn`     | `Function` | Yes      | Async function that refreshes the token and returns the new token.                                              |
| `getAuthToken`       | `Function` | Yes      | Function that returns the current auth token.                                                                   |
| `shouldRefreshToken` | `Function` | No       | Function that determines if token refresh should be triggered. Default checks for 401 status or network errors. |
| `onStatusChange`     | `Function` | No       | Callback for token refresh status updates. Status can be "refreshing", "success", "failed", or "error".         |

## How It Works

1. When an API call fails, the interceptor checks if the error meets the criteria for token refresh.
2. If token refresh is needed, it queues the failed request and starts the token refresh process (if not already in progress).
3. Once the token is refreshed, all queued requests are automatically retried with the new token.
4. If token refresh fails, all queued requests are rejected with the original error.

## Compatibility

This plugin is compatible with Axios v0.21.0 and above.

## License

MIT
