import { describe, expect, test, vi } from 'vitest';

import { createRefreshTokenPlugin } from '../src/index';
import { createMockAxios } from './helpers/mock-axios';
import { mockRefreshTokenFn, mockGetAuthToken } from './helpers/plugin-mocks';

describe('onStatusChange context', () => {
  test('receives queue depth and attempt count', async () => {
    mockRefreshTokenFn.mockResolvedValue('new-token');
    mockGetAuthToken.mockReturnValue('current-token');
    const onStatusChange = vi.fn();
    const axios = createMockAxios();
    axios.mockResolvedValue({ data: 'retry-success' });
    createRefreshTokenPlugin({
      refreshTokenFn: mockRefreshTokenFn,
      getAuthToken: mockGetAuthToken,
      onStatusChange,
    }).attach(axios);

    const responseInterceptor = axios.interceptors.response.use.mock.calls[0][1];
    const error = {
      response: { status: 401 },
      config: { method: 'GET', url: '/test', headers: {} },
    };

    await responseInterceptor(error);

    expect(onStatusChange).toHaveBeenCalledWith(
      'refreshing',
      undefined,
      expect.objectContaining({ queueDepth: 1, attemptCount: 1 }),
    );
    expect(onStatusChange).toHaveBeenCalledWith(
      'success',
      undefined,
      expect.objectContaining({ queueDepth: 1, attemptCount: 1 }),
    );
  });
});
