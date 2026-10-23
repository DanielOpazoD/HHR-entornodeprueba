import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => transport.call }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));

import { clearRecentAuthRoleLookups, getDynamicRoleForEmail } from '@/services/auth/authRoleLookup';
import { watchNursingSession } from '@/services/auth/nursingSessionMonitor';

describe('RUT bootstrap and session monitor share the initial role lookup', () => {
  const email = 'synthetic-monitor@accounts.hhr.invalid';
  let stop: (() => void) | undefined;
  let revoked: ReturnType<typeof vi.fn<() => Promise<void>>>;
  const user = () =>
    ({
      email,
      getIdTokenResult: async () => ({ claims: { auth_time: Date.now() / 1000 } }),
    }) as unknown as User;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    clearRecentAuthRoleLookups();
    transport.call.mockReset().mockResolvedValue({ data: { role: 'admin' } });
    revoked = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    stop?.();
    clearRecentAuthRoleLookups();
    vi.useRealTimers();
  });

  it('uses one server request for successful authorization followed by monitoring', async () => {
    await getDynamicRoleForEmail(email);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(revoked).not.toHaveBeenCalled();
  });

  it('still queries the server when there is no recent authorization', async () => {
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it('does not extend the existing ten-second reuse window', async () => {
    await getDynamicRoleForEmail(email);
    await vi.advanceTimersByTimeAsync(10_001);
    transport.call.mockResolvedValue({ data: { role: null } });
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.call).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it('forces periodic revocation checks even if another consumer just refreshed the role', async () => {
    await getDynamicRoleForEmail(email);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(55_000);
    await getDynamicRoleForEmail(email);
    expect(transport.call).toHaveBeenCalledTimes(2);
    transport.call.mockResolvedValue({ data: { role: null } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport.call).toHaveBeenCalledTimes(3);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it('joins an in-flight lookup and still closes an explicitly denied session', async () => {
    let resolve!: (value: { data: { role: null } }) => void;
    transport.call.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const bootstrap = getDynamicRoleForEmail(email);
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.call).toHaveBeenCalledTimes(1);
    resolve({ data: { role: null } });
    await bootstrap;
    await vi.advanceTimersByTimeAsync(0);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it('does not reuse an authorization invalidated by a session transition', async () => {
    await getDynamicRoleForEmail(email);
    clearRecentAuthRoleLookups();
    transport.call.mockResolvedValue({ data: { role: null } });
    stop = watchNursingSession(user(), revoked);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.call).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalledOnce();
  });
});
