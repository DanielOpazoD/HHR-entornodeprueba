import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandleLogout } from '@/hooks/useAuthStateSessionSupport';
import { defaultAuditPort } from '@/application/ports/auditPort';
import { clearSessionScopedClientState } from '@/services/storage/sessionScopedStorageService';

vi.mock('@/application/ports/auditPort', () => ({
  defaultAuditPort: { logUserLogout: vi.fn() },
}));

vi.mock('@/config/queryClient', () => ({ clearQueryCache: vi.fn() }));

vi.mock('@/services/auth/authBroadcastChannel', () => ({ broadcastLogout: vi.fn() }));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn(async (_reason: string, close?: () => Promise<void>) => {
    await close?.();
  }),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

const USER = {
  uid: 'u1',
  email: 'enfermera@hospital.test',
  displayName: 'Enfermera',
  role: 'admin',
};

describe('createHandleLogout audit order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes the audit connection before Firebase signs out', async () => {
    let finishAudit: () => void = () => undefined;
    vi.mocked(defaultAuditPort.logUserLogout).mockReturnValue(
      new Promise<void>(resolve => {
        finishAudit = resolve;
      })
    );
    const signOut = vi.fn().mockResolvedValue(undefined);

    const logout = createHandleLogout(USER as never, signOut, vi.fn())('automatic');
    // The audit module is loaded on demand at logout.
    await vi.waitFor(() =>
      expect(defaultAuditPort.logUserLogout).toHaveBeenCalledWith(USER.email, 'automatic')
    );
    expect(clearSessionScopedClientState).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();

    finishAudit();
    await logout;
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('signs out once the audit budget runs out, even if the audit step never settles', async () => {
    vi.useFakeTimers();
    try {
      // e.g. the audit module is still downloading over a stalled network
      vi.mocked(defaultAuditPort.logUserLogout).mockReturnValue(new Promise<void>(() => undefined));
      const signOut = vi.fn().mockResolvedValue(undefined);

      const logout = createHandleLogout(USER as never, signOut, vi.fn())('manual');
      await vi.advanceTimersByTimeAsync(1_999);
      expect(signOut).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await logout;
      expect(signOut).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still signs out when the audit step fails', async () => {
    vi.mocked(defaultAuditPort.logUserLogout).mockRejectedValue(new Error('offline'));
    const signOut = vi.fn().mockResolvedValue(undefined);

    await createHandleLogout(USER as never, signOut, vi.fn())('manual');

    expect(signOut).toHaveBeenCalledOnce();
  });
});
