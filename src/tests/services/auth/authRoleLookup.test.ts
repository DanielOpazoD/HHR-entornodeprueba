import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFunctionsMock = vi.fn();
const httpsCallableMock = vi.fn();

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: (...args: unknown[]) => getFunctionsMock(...args),
  },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallableMock(...args),
}));

import {
  AUTH_ROLE_LOOKUP_UNAVAILABLE_CODE,
  createAuthRoleLookupService,
  getDynamicRoleForEmail,
  resolveCallableRole,
} from '@/services/auth/authRoleLookup';

describe('authRoleLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFunctionsMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the current user role through the callable backed by config/roles', async () => {
    const checkUserRoleCall = vi.fn().mockResolvedValue({
      data: { role: 'doctor_specialist' },
    });
    httpsCallableMock.mockReturnValue(checkUserRoleCall);

    await expect(getDynamicRoleForEmail('specialist@hospital.cl')).resolves.toBe(
      'doctor_specialist'
    );
    expect(checkUserRoleCall).toHaveBeenCalledWith({});
  });

  it('returns null when callable resolves an unauthorized role marker', async () => {
    const checkUserRoleCall = vi.fn().mockResolvedValue({
      data: { role: 'unauthorized' },
    });
    httpsCallableMock.mockReturnValue(checkUserRoleCall);

    await expect(getDynamicRoleForEmail('removed@hospital.cl')).resolves.toBeNull();
  });

  it('normalizes malformed callable payloads to null without leaking ambiguity', () => {
    expect(resolveCallableRole(undefined)).toBeNull();
    expect(resolveCallableRole({ role: null })).toBeNull();
    expect(resolveCallableRole({ role: 'viewer' })).toBe('viewer');
  });

  it('throws an explicit unavailable error when the callable cannot be reached', async () => {
    const checkUserRoleCall = vi.fn().mockRejectedValue(new Error('network down'));
    httpsCallableMock.mockReturnValue(checkUserRoleCall);

    await expect(getDynamicRoleForEmail('network-failure@hospital.cl')).rejects.toMatchObject({
      code: AUTH_ROLE_LOOKUP_UNAVAILABLE_CODE,
    });
  });

  it('supports injected functions runtimes', async () => {
    const checkUserRoleCall = vi.fn().mockResolvedValue({
      data: { role: 'viewer' },
    });
    httpsCallableMock.mockReturnValue(checkUserRoleCall);
    const service = createAuthRoleLookupService({
      getFunctions: vi.fn().mockResolvedValue({ custom: true } as never),
    });

    await expect(service.getDynamicRoleForEmail('viewer@hospital.cl')).resolves.toBe('viewer');
  });

  it('reuses a freshly settled lookup across the observer and popup completion paths', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T04:00:00.000Z'));
    const checkUserRoleCall = vi.fn().mockResolvedValue({
      data: { role: 'doctor_specialist' },
    });
    httpsCallableMock.mockReturnValue(checkUserRoleCall);
    const service = createAuthRoleLookupService();

    await expect(service.getDynamicRoleForEmail('specialist@hospital.cl')).resolves.toBe(
      'doctor_specialist'
    );
    await expect(service.getDynamicRoleForEmail('SPECIALIST@hospital.cl')).resolves.toBe(
      'doctor_specialist'
    );

    expect(checkUserRoleCall).toHaveBeenCalledTimes(1);

    service.clearRecentLookups();
    await expect(service.getDynamicRoleForEmail('specialist@hospital.cl')).resolves.toBe(
      'doctor_specialist'
    );
    expect(checkUserRoleCall).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_001);
    await expect(service.getDynamicRoleForEmail('specialist@hospital.cl')).resolves.toBe(
      'doctor_specialist'
    );
    expect(checkUserRoleCall).toHaveBeenCalledTimes(3);
  });

  it('does not reuse or cache an in-flight lookup after the auth session is cleared', async () => {
    let resolveStaleLookup: ((value: { data: { role: string } }) => void) | undefined;
    const staleLookup = new Promise<{ data: { role: string } }>(resolve => {
      resolveStaleLookup = resolve;
    });
    const checkUserRoleCall = vi
      .fn()
      .mockReturnValueOnce(staleLookup)
      .mockResolvedValueOnce({ data: { role: 'viewer' } });
    httpsCallableMock.mockReturnValue(checkUserRoleCall);
    const service = createAuthRoleLookupService();

    const previousSessionLookup = service.getDynamicRoleForEmail('same-user@hospital.cl');
    service.clearRecentLookups();

    await expect(service.getDynamicRoleForEmail('same-user@hospital.cl')).resolves.toBe('viewer');
    resolveStaleLookup?.({ data: { role: 'doctor_specialist' } });
    await expect(previousSessionLookup).resolves.toBe('doctor_specialist');

    await expect(service.getDynamicRoleForEmail('same-user@hospital.cl')).resolves.toBe('viewer');
    expect(checkUserRoleCall).toHaveBeenCalledTimes(2);
  });
});
