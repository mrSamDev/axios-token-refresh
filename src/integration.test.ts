import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, describe, expect, test } from "vitest";
import { createRefreshTokenPlugin } from "./index";

type CleanupContext = {
  cleanup: () => void;
  apiMock: MockAdapter;
  authMock: MockAdapter;
};

const contexts: CleanupContext[] = [];

afterEach(() => {
  while (contexts.length > 0) {
    const ctx = contexts.pop();
    if (!ctx) {
      continue;
    }
    ctx.cleanup();
    ctx.apiMock.restore();
    ctx.authMock.restore();
  }
});

describe("integration: real axios interceptors", () => {
  test("retries refreshTokenFn and succeeds before maxRetryAttempts", async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = "stale-token";
    let refreshAttempts = 0;

    apiMock.onGet("/protected").reply((config) => {
      if (config.headers?.Authorization === "Bearer fresh-token") {
        return [200, { ok: true }];
      }
      return [401, { code: "expired" }];
    });

    authMock.onPost("/refresh").reply(() => {
      refreshAttempts += 1;
      if (refreshAttempts < 2) {
        return [500, { error: "temporary" }];
      }
      token = "fresh-token";
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post("/refresh");
        return response.data.token;
      },
      maxRetryAttempts: 2,
      retryDelay: 30,
    })(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const startedAt = Date.now();
    const response = await apiClient.get("/protected");
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.data).toStrictEqual({ ok: true });
    expect(refreshAttempts).toBe(2);
    expect(elapsedMs).toBeGreaterThanOrEqual(25);
  });

  test("rejects queued request after maxRetryAttempts is exhausted", async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = "stale-token";
    let refreshAttempts = 0;

    apiMock.onGet("/protected").reply(401, { code: "expired" });

    authMock.onPost("/refresh").reply(() => {
      refreshAttempts += 1;
      return [500, { error: "still-broken" }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post("/refresh");
        return response.data.token;
      },
      maxRetryAttempts: 2,
      retryDelay: 10,
    })(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    await expect(apiClient.get("/protected")).rejects.toMatchObject({
      message: "Token refresh failed",
      originalError: expect.any(Error),
    });
    expect(refreshAttempts).toBe(2);
  });

  test("skipAuthRefresh bypasses refresh flow for a request", async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = "stale-token";
    apiMock.onGet("/public").reply(401, { code: "auth-required" });
    authMock.onPost("/refresh").reply(200, { token: "fresh-token" });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post("/refresh");
        token = response.data.token;
        return token;
      },
    })(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    await expect(
      apiClient.get("/public", {
        skipAuthRefresh: true,
      } as any)
    ).rejects.toMatchObject({
      response: {
        status: 401,
      },
    });

    expect(authMock.history.post.length).toBe(0);
  });

  test("getRequestKey can avoid dedupe collisions for same endpoint with different payloads", async () => {
    const apiClient = axios.create();
    const authClient = axios.create();
    const apiMock = new MockAdapter(apiClient);
    const authMock = new MockAdapter(authClient);

    let token = "stale-token";
    let refreshAttempts = 0;

    apiMock.onPost("/items").reply((config) => {
      if (config.headers?.Authorization !== "Bearer fresh-token") {
        return [401, { code: "expired" }];
      }
      return [200, { echoed: JSON.parse(config.data) }];
    });

    authMock.onPost("/refresh").reply(() => {
      refreshAttempts += 1;
      token = "fresh-token";
      return [200, { token }];
    });

    const cleanup = createRefreshTokenPlugin({
      getAuthToken: () => token,
      refreshTokenFn: async () => {
        const response = await authClient.post("/refresh");
        return response.data.token;
      },
      getRequestKey: (request) => {
        return `${request.method}-${request.url}-${JSON.stringify(request.data || {})}`;
      },
    })(apiClient);

    contexts.push({ cleanup, apiMock, authMock });

    const [first, second] = await Promise.all([
      apiClient.post("/items", { id: 1 }),
      apiClient.post("/items", { id: 2 }),
    ]);

    expect(first.data).toStrictEqual({ echoed: { id: 1 } });
    expect(second.data).toStrictEqual({ echoed: { id: 2 } });
    expect(refreshAttempts).toBe(1);
    expect(apiMock.history.post.length).toBe(4);
  });
});
