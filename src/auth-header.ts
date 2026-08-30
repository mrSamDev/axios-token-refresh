import type { RetryableRequestConfig } from './refresh-queue';

/**
 * Apply the auth header to a request config if a token is available.
 *
 * @param config The request config to mutate.
 * @param token The token to set, or `null` to leave the header untouched.
 * @param formatter Transforms a token into the `Authorization` header value.
 * @param force When `true`, overwrite an existing `Authorization` header.
 * @returns The mutated request config.
 */
export const applyAuthHeader = (
  config: RetryableRequestConfig,
  token: string | null,
  formatter: (token: string) => string,
  force = false,
): RetryableRequestConfig => {
  if (!token) {
    return config;
  }

  const headers = (config.headers ??= {} as RetryableRequestConfig['headers']);
  if (force || !headers.Authorization) {
    headers.Authorization = formatter(token);
  }
  return config;
};
