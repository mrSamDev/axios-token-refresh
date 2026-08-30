import { vi } from 'vitest';

export const mockRefreshTokenFn = vi.fn();
export const mockGetAuthToken = vi.fn();
export const mockOnStatusChange = vi.fn();
export const mockShouldRefreshToken = vi.fn();
export const mockAuthHeaderFormatter = vi.fn();
