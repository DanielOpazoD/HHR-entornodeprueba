import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  persistence: vi.fn(),
  callable: vi.fn(),
  clearRoles: vi.fn(),
  auth: { currentUser: null as object | null, app: { options: { apiKey: 'synthetic-key' } } },
}));
vi.mock('firebase/auth', () => ({
  browserSessionPersistence: 'session',
  setPersistence: mocks.persistence,
  signInWithEmailAndPassword: mocks.signIn,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.callable }));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { ready: Promise.resolve(), auth: mocks.auth },
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));
vi.mock('@/services/auth/authRoleLookup', () => ({ clearRecentAuthRoleLookups: mocks.clearRoles }));
import { establishNursingSession } from '@/services/auth/nursingAccountService';
import { runSessionStorageTransition } from '@/services/storage/sessionStorageTransition';
import { beginPendingLogout } from '@/services/auth/authLogoutState';
describe('individual login respects session replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser = null;
  });
  it('does not sign in after another document admitted a different owner', async () => {
    mocks.callable.mockImplementation(async () => {
      localStorage.setItem('hhr_session_generation_v1', 'new-owner-generation');
      return { data: { credentialEmail: 'synthetic@accounts.hhr.invalid' } };
    });
    await expect(
      establishNursingSession('signInWithRut', { password: 'synthetic-password' })
    ).rejects.toThrow();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.clearRoles).not.toHaveBeenCalled();
  });
  it('ignores a cancelled form even when the backend finishes successfully', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    await expect(
      establishNursingSession(
        'activateNursingAccount',
        { password: 'synthetic-password' },
        () => false
      )
    ).rejects.toThrow();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.clearRoles).not.toHaveBeenCalled();
  });
  it('does not invalidate the replacement owner while waiting for the session transition lock', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const lock = runSessionStorageTransition(() => blocked);
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    const login = establishNursingSession('signInWithRut', { password: 'synthetic-password' });
    await vi.waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
    expect(mocks.clearRoles).not.toHaveBeenCalled();
    localStorage.setItem('hhr_session_generation_v1', 'replacement-owner');
    release();
    await lock;
    await expect(login).rejects.toThrow('La sesión cambió');
    expect(mocks.clearRoles).not.toHaveBeenCalled();
    expect(mocks.persistence).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('waits for a logout of this tab to finish before verifying the new credentials', async () => {
    const finishLogout = beginPendingLogout();
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    const login = establishNursingSession('signInWithRut', { password: 'synthetic-password' });
    await new Promise(resolve => setTimeout(resolve, 20));
    // The leaving session's token (revoked after a password change) must not be sent.
    expect(mocks.callable).not.toHaveBeenCalled();

    finishLogout();
    await login;
    expect(mocks.callable).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it('uses session persistence and Firebase password sign-in after private verification', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    await establishNursingSession('signInWithRut', { password: 'synthetic-password' });
    expect(mocks.clearRoles).toHaveBeenCalledTimes(1);
    expect(mocks.clearRoles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persistence.mock.invocationCallOrder[0]
    );
    expect(mocks.persistence).toHaveBeenCalledWith(mocks.auth, 'session');
    expect(mocks.signIn).toHaveBeenCalledWith(
      mocks.auth,
      'synthetic@accounts.hhr.invalid',
      'synthetic-password'
    );
  });
  it('returns setup without persistence, session replacement or Firebase sign-in', async () => {
    mocks.callable.mockResolvedValue({ data: { requiresSetup: true, activationToken: 'fake' } });
    await expect(
      establishNursingSession('signInWithRut', { password: '11111111' })
    ).resolves.toEqual({ requiresSetup: true, activationToken: 'fake' });
    expect(mocks.persistence).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.clearRoles).not.toHaveBeenCalled();
  });
});
