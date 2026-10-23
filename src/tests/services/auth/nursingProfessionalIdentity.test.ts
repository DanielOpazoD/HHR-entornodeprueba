import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  persistence: vi.fn(),
  callable: vi.fn(),
  clearRoles: vi.fn(),
  auth: {
    currentUser: null as { uid: string; displayName: string | null } | null,
    app: { options: { apiKey: '' } },
  },
}));
vi.mock('firebase/auth', () => ({
  browserSessionPersistence: 'session',
  setPersistence: mocks.persistence,
  signInWithEmailAndPassword(...args: unknown[]) {
    return mocks.signIn(...args);
  },
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
import {
  clearPendingProfessionalIdentity,
  readSessionProfessionalIdentity,
} from '@/services/user-profile/sessionProfessionalIdentity';

const signedInUser = { uid: 'synthetic-user', displayName: 'Profesional de prueba' };
const loginData = { rut: '11111111-1', password: '' };
describe('professional identity after individual authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearPendingProfessionalIdentity();
    mocks.auth.currentUser = null;
    mocks.signIn.mockImplementation(async () => {
      mocks.auth.currentUser = signedInUser;
      return { user: signedInUser };
    });
  });
  it('captures a valid RUT only after Firebase resolves for the current UID and persists on consumption', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    await establishNursingSession('signInWithRut', loginData);
    expect(sessionStorage.getItem(`hhr_professional_identity_v1.${signedInUser.uid}`)).toBeNull();
    expect(readSessionProfessionalIdentity(signedInUser.uid)).toEqual({
      uid: signedInUser.uid,
      name: signedInUser.displayName,
      rut: '11.111.111-1',
    });
  });

  it('does not capture identity when Firebase authentication fails', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    mocks.signIn.mockRejectedValue(new Error('sign-in failed'));
    await expect(establishNursingSession('signInWithRut', loginData)).rejects.toThrow(
      'sign-in failed'
    );
    expect(readSessionProfessionalIdentity(signedInUser.uid)).toBeNull();
  });

  it('preserves the same-UID hint when a password change has no RUT field', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    await establishNursingSession('signInWithRut', loginData);
    await establishNursingSession('changeNursingPassword', { password: '' });
    expect(readSessionProfessionalIdentity(signedInUser.uid)).toEqual({
      uid: signedInUser.uid,
      name: signedInUser.displayName,
      rut: '11.111.111-1',
    });
  });

  it('does not capture a login cancelled while Firebase is signing in', async () => {
    let current = true;
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    mocks.signIn.mockImplementation(async () => {
      mocks.auth.currentUser = signedInUser;
      current = false;
      return { user: signedInUser };
    });
    await establishNursingSession('signInWithRut', loginData, () => current);
    expect(readSessionProfessionalIdentity(signedInUser.uid)).toBeNull();
  });

  it('discards a Firebase result that is no longer the current user', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    mocks.signIn.mockImplementation(async () => {
      mocks.auth.currentUser = { uid: 'replacement', displayName: null };
      return { user: signedInUser };
    });
    await establishNursingSession('signInWithRut', loginData);
    expect(readSessionProfessionalIdentity(signedInUser.uid)).toBeNull();
  });

  it('keeps login successful when the optional hint store is denied', async () => {
    mocks.callable.mockResolvedValue({
      data: { credentialEmail: 'synthetic@accounts.hhr.invalid' },
    });
    const store = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await expect(establishNursingSession('signInWithRut', loginData)).resolves.toBeUndefined();
    expect(store).not.toHaveBeenCalled();
    expect(readSessionProfessionalIdentity(signedInUser.uid)?.rut).toBe('11.111.111-1');
    store.mockRestore();
  });
});
