import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  persistence: vi.fn(),
  callable: vi.fn(),
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
vi.mock('@/services/auth/authRoleLookup', () => ({ clearRecentAuthRoleLookups: vi.fn() }));
import { establishNursingSession } from '@/services/auth/nursingAccountService';
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
  });
  it('uses session persistence and Firebase password sign-in after private verification', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    await establishNursingSession('signInWithRut', { password: 'synthetic-password' });
    expect(mocks.persistence).toHaveBeenCalledWith(mocks.auth, 'session');
    expect(mocks.signIn).toHaveBeenCalledWith(
      mocks.auth,
      'synthetic@accounts.hhr.invalid',
      'synthetic-password'
    );
  });
});
