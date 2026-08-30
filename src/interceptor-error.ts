import type { ReportHook } from './hook-error';
import type { RefreshStatus, RefreshStatusContext } from './plugin-options';

/** State the interceptor-error handler reads from the owning install. */
export interface InterceptorErrorDeps {
  reportHook: ReportHook;
  onStatusChange: (status: RefreshStatus, error?: Error, context?: RefreshStatusContext) => void;
  queueSize: () => number;
  getAttempt: () => number;
}

/**
 * Build the handler for interceptor-level failures (a throwing
 * `shouldRefreshToken` or `getRequestKey`). It rejects only the offending
 * request, preserves the original 401 on `originalError`, and reports the
 * failure via `onStatusChange`. The queue is never drained here.
 */
export const createInterceptorErrorHandler =
  (deps: InterceptorErrorDeps) =>
  (interceptorError: unknown, originalError?: unknown): Promise<never> => {
    const { reportHook, onStatusChange, queueSize, getAttempt } = deps;
    const handledError =
      interceptorError instanceof Error
        ? interceptorError
        : new Error('Unknown error in refresh token interceptor');

    if (
      originalError !== undefined &&
      originalError !== handledError &&
      !('originalError' in handledError)
    ) {
      // Attach context (idiomatic, like err.code): preserves the caller's error identity.
      (handledError as Error & { originalError?: unknown }).originalError = originalError;
    }

    reportHook('onStatusChange', () =>
      onStatusChange('error', handledError, {
        queueDepth: queueSize(),
        attemptCount: getAttempt(),
      }),
    );

    return Promise.reject(handledError);
  };
