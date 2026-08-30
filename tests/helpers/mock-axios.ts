import { vi } from 'vitest';

// Minimal axios-like mock: callable instance with interceptor registration,
// mirroring the subset of AxiosInstance the plugin touches.
export const createMockAxios = () => {
  const instance = vi.fn() as any;

  instance.interceptors = {
    request: {
      handlers: [],
      use: vi.fn((onFulfilled: unknown, onRejected: unknown) => {
        instance.interceptors.request.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.request.handlers.length - 1;
      }),
      eject: vi.fn((id: number) => {
        if (id >= 0) instance.interceptors.request.handlers[id] = null;
      }),
    },
    response: {
      handlers: [],
      use: vi.fn((onFulfilled: unknown, onRejected: unknown) => {
        instance.interceptors.response.handlers.push({ onFulfilled, onRejected });
        return instance.interceptors.response.handlers.length - 1;
      }),
      eject: vi.fn((id: number) => {
        if (id >= 0) instance.interceptors.response.handlers[id] = null;
      }),
    },
  };

  instance.request = vi.fn();
  return instance;
};

export const responseErrorHandler = (instance: any) =>
  instance.interceptors.response.use.mock.calls[0][1];

export const authError = (url: string) => ({
  response: { status: 401 },
  config: {
    method: 'GET',
    url,
    headers: {},
  },
});
