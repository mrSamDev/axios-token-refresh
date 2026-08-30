import type { InternalAxiosRequestConfig } from 'axios';

import { applyAuthHeader } from './auth-header';

export type RequestHandler = (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;

/**
 * Build the request handler that injects the current token into outgoing
 * requests. An existing `Authorization` header is never overwritten.
 */
export const createTokenInjector = (
  tokenGetter: () => string | null,
  authHeaderFormatter: (token: string) => string,
): RequestHandler => {
  return (config) => {
    const token = tokenGetter();
    if (token) {
      applyAuthHeader(config, token, authHeaderFormatter);
    }
    return config;
  };
};
