# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-30

Minor bump: default behavior changed for requests fired during a refresh.
Review before upgrading.

### Changed

- **`pauseRequestsWhileRefreshing` now defaults to `true`.** Requests fired
  while a refresh is in flight are parked in the request interceptor and
  released with the fresh token, instead of racing out with the stale token,
  401-ing, and piling into the retry queue. Parked requests are rejected with
  the queue's `Token refresh failed` error when the refresh fails or the
  plugin is cleaned up. Set it to `false` for the 0.2 fire-immediately
  behavior. `skipAuthRefresh` requests are never parked.
- `refreshTokenFn` now receives the attempt's `AbortSignal`
  (`refreshTokenFn: (signal: AbortSignal) => Promise<string | null>`).
  The signal aborts on attempt timeout and plugin cleanup. Existing functions
  that ignore it keep working.

### Added

- `onHookError?: (error: Error, hookName: string) => void` — failures from
  `onStatusChange` / `onRefreshStart` / `onRefreshSuccess` / `onRefreshFail`
  are surfaced there instead of being swallowed; absent or throwing handlers
  fall back to `console.error`.
- `maxQueueSize?: number` — caps the retry queue. When full, the newest
  refreshable request is rejected with `Token refresh queue is full`.
- `silent?: boolean` — suppresses the `console.error` fallback for hook
  failures (serverless/edge friendly). Defaults to `false`.
- `onStatusChange` now receives a third `context` argument with `queueDepth`
  and `attemptCount` for observability.

### Fixed

- Retried requests no longer mutate the original request's `Authorization`
  header: retries now clone the config's headers.
- Plugin cleanup now aborts an in-flight refresh attempt instead of letting
  it run in the background.
- An attempt timeout now aborts the previous attempt's signal before the
  retry starts, so a signal-forwarding `refreshTokenFn` cannot overlap
  attempts (refresh-token reuse hazard with rotating refresh tokens).
- A throwing `shouldRefreshToken` or `getRequestKey` now rejects only that
  request, not the entire retry queue. The original 401 is preserved on the
  error's `originalError` property.
- Non-Error rejections from `refreshTokenFn` are normalized to `Error` at the
  source so all downstream consumers (queue, parked requests, hooks) receive
  the documented `Error` contract.
- Tokenless requests are never parked during an unrelated refresh.
- The `_retry` flag is set on an internal clone, never on the caller's
  request config.
- The dedupe key is now computed from the original request config, not the
  `_retry` clone, so a `getRequestKey` that reads `config._retry` sees the
  caller's config.
- The `axios` peer dependency is bounded to `>=1.0.0 <2.0.0` so a future
  axios 2.x cannot silently break the library.

### Deprecated

- Calling the plugin as a function (`refreshPlugin(apiClient)`) is deprecated.
  Use `refreshPlugin.attach(apiClient)`. The callable form will be removed in
  a future release.

### Internal

- Coverage thresholds raised to 95 (suite sits at 100).
- `noImplicitAny` enabled; the 1,126-line test monolith split by behavior.

## [0.2.2]

- Packaging fixes for pnpm trusted publishing and JSR.

## [0.2.1] and earlier

- See git history.
