import { tryCatch } from './try-catch';

/** Lifecycle hooks whose failures the reporter can surface. */
export type HookName = 'onStatusChange' | 'onRefreshStart' | 'onRefreshSuccess' | 'onRefreshFail';

export type OnHookError = (error: Error, hookName: HookName) => void;

/** Runs a hook guarded; a throw never escapes, it gets surfaced instead. */
export type ReportHook = (hookName: HookName, hook: () => void) => void;

/**
 * Build the guarded hook runner. A throwing hook is reported via
 * `onHookError`; when that is absent or itself throws, the last resort is
 * `console.error` so hook failures never vanish silently. Pass `silent` to
 * drop the console fallback (e.g. serverless/edge where stderr is alarming).
 */
export const createHookReporter =
  (onHookError?: OnHookError, silent = false): ReportHook =>
  (hookName, hook) => {
    const [, error] = tryCatch(hook);
    if (!error) {
      return;
    }

    if (onHookError) {
      const [, reportError] = tryCatch(() => onHookError(error, hookName));
      if (!reportError) {
        return;
      }
    }

    if (!silent) {
      console.error('[axios-token-refresh]', hookName, error);
    }
  };
