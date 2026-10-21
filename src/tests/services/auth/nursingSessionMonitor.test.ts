import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { MANAGED_ROLE_OPTIONS } from '@/shared/access/roleAccessMatrix';
import { watchNursingSession } from '@/services/auth/nursingSessionMonitor';

const lookup = vi.hoisted(() => ({ role: vi.fn(), clear: vi.fn() }));
vi.mock('@/services/auth/authRoleLookup', () => ({
  getDynamicRoleForEmail: lookup.role,
  clearRecentAuthRoleLookups: lookup.clear,
}));

describe('managed RUT session monitoring', () => {
  let stop: (() => void) | undefined;
  const user = (authTime = Date.now() / 1000) =>
    ({
      email: 'synthetic@accounts.hhr.invalid',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { auth_time: authTime } }),
    }) as unknown as User;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'));
    vi.resetAllMocks();
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it.each(MANAGED_ROLE_OPTIONS)('keeps an authorized $role session open', async ({ role }) => {
    lookup.role.mockResolvedValue(role);
    const revoked = vi.fn().mockResolvedValue(undefined);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lookup.role).toHaveBeenCalledTimes(2);
    expect(revoked).not.toHaveBeenCalled();
  });

  it('closes a session when the server denies access on a later check', async () => {
    lookup.role.mockResolvedValueOnce('admin').mockResolvedValueOnce(null);
    const revoked = vi.fn().mockResolvedValue(undefined);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(revoked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it.each([null, 'editor'])('closes a managed session with denied role %s', async role => {
    lookup.role.mockResolvedValue(role);
    const revoked = vi.fn().mockResolvedValue(undefined);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it('keeps a valid session during a transient lookup failure but closes it at 12 hours', async () => {
    lookup.role.mockRejectedValue(new Error('temporary transport failure'));
    const revoked = vi.fn().mockResolvedValue(undefined);
    stop = watchNursingSession(user(Date.now() / 1000 - 43_140), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(revoked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it('ignores an obsolete denial and stops polling after detachment', async () => {
    let resolveRole: (role: null) => void = () => {};
    lookup.role.mockReturnValue(new Promise<null>(resolve => (resolveRole = resolve)));
    const revoked = vi.fn().mockResolvedValue(undefined);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolveRole(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revoked).not.toHaveBeenCalled();
    expect(lookup.role).toHaveBeenCalledOnce();
  });
});
