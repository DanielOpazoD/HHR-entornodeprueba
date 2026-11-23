import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDynamicRoleForEmail,
  mockGetCachedRole,
  mockSaveRoleToCache,
  mockEmitAuthOperationalEvent,
  mockRecordAuthOperationalError,
} = vi.hoisted(() => ({
  mockGetDynamicRoleForEmail: vi.fn(),
  mockGetCachedRole: vi.fn(),
  mockSaveRoleToCache: vi.fn(),
  mockEmitAuthOperationalEvent: vi.fn(),
  mockRecordAuthOperationalError: vi.fn(),
}));

vi.mock('@/services/auth/authRoleLookup', () => ({
  getDynamicRoleForEmail: (email: string) => mockGetDynamicRoleForEmail(email),
}));

vi.mock('@/services/auth/authRoleCache', () => ({
  clearRoleCacheForEmail: vi.fn(),
  getCachedRole: (email: string) => mockGetCachedRole(email),
  saveRoleToCache: (email: string, role: string) => mockSaveRoleToCache(email, role),
}));

vi.mock('@/services/auth/authOperationalTelemetry', () => ({
  emitAuthOperationalEvent: (...args: unknown[]) => mockEmitAuthOperationalEvent(...args),
  recordAuthOperationalError: (...args: unknown[]) => mockRecordAuthOperationalError(...args),
}));

import { resolveGeneralLoginAccessForEmail } from '@/services/auth/authPolicy';

describe('authPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedRole.mockResolvedValue(null);
    mockGetDynamicRoleForEmail.mockResolvedValue('doctor_specialist');
    mockSaveRoleToCache.mockResolvedValue(undefined);
  });

  it('can use a cached role as a bootstrap-only fast path', async () => {
    mockGetCachedRole.mockResolvedValue('admin');

    await expect(
      resolveGeneralLoginAccessForEmail(' Admin@Hospital.cl ', { allowCachedRole: true })
    ).resolves.toEqual({
      allowed: true,
      role: 'admin',
      resolution: 'authorized',
    });

    expect(mockGetCachedRole).toHaveBeenCalledWith('admin@hospital.cl');
    expect(mockGetDynamicRoleForEmail).not.toHaveBeenCalled();
  });

  it('uses the fresh dynamic lookup by default and refreshes the role cache', async () => {
    await expect(resolveGeneralLoginAccessForEmail('doctor@hospital.cl')).resolves.toEqual({
      allowed: true,
      role: 'doctor_specialist',
      resolution: 'authorized',
    });

    expect(mockGetCachedRole).not.toHaveBeenCalled();
    expect(mockGetDynamicRoleForEmail).toHaveBeenCalledWith('doctor@hospital.cl');
    expect(mockSaveRoleToCache).toHaveBeenCalledWith('doctor@hospital.cl', 'doctor_specialist');
  });

  it('returns unauthorized and emits telemetry when no dynamic role exists', async () => {
    mockGetDynamicRoleForEmail.mockResolvedValueOnce(null);

    await expect(resolveGeneralLoginAccessForEmail('unknown@hospital.cl')).resolves.toEqual({
      allowed: false,
      resolution: 'unauthorized',
    });

    expect(mockEmitAuthOperationalEvent).toHaveBeenCalledWith(
      'resolve_general_login_access',
      'unauthorized',
      expect.objectContaining({
        code: 'auth_email_not_authorized',
        context: { email: 'unknown@hospital.cl', source: 'none' },
      })
    );
  });
});
