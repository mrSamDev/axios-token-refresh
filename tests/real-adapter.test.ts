import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';

// Real axios dispatch (request interceptor, AxiosHeaders normalization,
// settle/reject on status) with only the transport stubbed. MockAdapter
// bypasses parts of this chain, so header behavior lived untested.
const createRecordingAdapter = (isAccepted: (auth: string) => boolean) => {
  const seenAuth: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seenAuth.push(String(config.headers?.Authorization ?? ''));
    const status = isAccepted(seenAuth[seenAuth.length - 1]) ? 200 : 401;
    const response: AxiosResponse = {
      data: status === 200 ? { ok: true } : { error: 'expired' },
      status,
      statusText: status === 200 ? 'OK' : 'Unauthorized',
      headers: {},
      config,
    };
    return status === 200
      ? response
      : Promise.reject(
          Object.assign(new Error('Request failed with status code 401'), { response, config }),
        );
  };
  return { seenAuth, adapter };
};

describe('real axios dispatch', () => {
  test('retry carries the refreshed token through real AxiosHeaders', async () => {
    const { seenAuth, adapter } = createRecordingAdapter((auth) => auth === 'Bearer fresh-token');
    const api = axios.create({ adapter });
    createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('fresh-token'),
      getAuthToken: () => 'stale-token',
    })(api);

    const response = await api.get('/protected');

    expect(response.status).toBe(200);
    expect(response.data).toStrictEqual({ ok: true });
    expect(seenAuth).toStrictEqual(['Bearer stale-token', 'Bearer fresh-token']);
  }, 1500);

  test('a retry that 401s again rejects instead of looping', async () => {
    const { seenAuth, adapter } = createRecordingAdapter(() => false);
    const api = axios.create({ adapter });
    createRefreshTokenPlugin({
      refreshTokenFn: vi.fn().mockResolvedValue('still-stale'),
      getAuthToken: () => 'stale-token',
    })(api);

    const handled = api.get('/protected').then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settled = await handled;
    expect(settled.status).toBe('rejected');
    expect(seenAuth).toStrictEqual(['Bearer stale-token', 'Bearer still-stale']);
  }, 1500);
});
