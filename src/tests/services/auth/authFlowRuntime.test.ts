import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firebaseAuth from 'firebase/auth';
import type { AuthRuntime } from '@/services/firebase-runtime/authRuntime';

vi.unmock('@/services/auth/authFallback');

import { signInWithGoogle } from '@/services/auth/authGoogleFlow';
import { signIn, createUser } from '@/services/auth/authCredentialFlow';
import {
  handleSignInRedirectResult,
  hasActiveFirebaseSession,
  signInWithGoogleRedirect,
} from '@/services/auth/authFallback';
import { isCurrentUserAuthorizedForGeneralLogin } from '@/services/auth/authPolicy';

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  GoogleAuthProvider: Object.assign(
    vi.fn(function GoogleAuthProvider() {
      return { setCustomParameters: vi.fn() };
    }),
    { credential: vi.fn((idToken: string) => ({ idToken })) }
  ),
}));

vi.mock('@/services/auth/authAccessResolution', () => ({
  authorizeCurrentFirebaseUser: vi.fn().mockResolvedValue(null),
  authorizeFirebaseUser: vi.fn(async (user: { uid: string; email: string | null }) => ({
    uid: user.uid,
    email: user.email,
    displayName: 'Injected User',
    role: 'admin',
  })),
}));

vi.mock('@/services/auth/authRedirectRuntime', () => ({
  getAuthRedirectRuntimeSupport: vi.fn(() => ({
    canUseRedirectAuth: true,
    redirectDisabledReason: null,
  })),
}));

vi.mock('@/services/auth/authE2ERedirectRuntime', () => ({
  consumeE2ERedirectPendingUser: vi.fn(() => null),
  readE2ERedirectMode: vi.fn(() => null),
}));

vi.mock('@/services/auth/authBootstrapState', () => ({
  clearAuthBootstrapPending: vi.fn(),
  isAuthBootstrapPending: vi.fn(() => false),
  markAuthBootstrapPending: vi.fn(),
}));

vi.mock('@/services/auth/authPolicy', () => ({
  isCurrentUserAuthorizedForGeneralLogin: vi.fn(async () => true),
  resolveGeneralLoginAccessForEmail: vi.fn(async () => ({
    allowed: true,
    role: 'admin',
    resolution: 'authorized',
  })),
}));

const createAuthRuntime = (): AuthRuntime => {
  const auth = { currentUser: null } as firebaseAuth.Auth;
  return {
    auth,
    ready: Promise.resolve(),
    getCurrentUser: vi.fn(() => auth.currentUser),
  };
};

describe('auth runtime injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'created-1', email: 'new@hospital.cl', displayName: 'Created User' },
    } as unknown as firebaseAuth.UserCredential);
  });

  it('uses the injected runtime for Google popup auth', async () => {
    const authRuntime = createAuthRuntime();
    vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValue({
      user: { uid: 'google-1', email: 'admin@hospital.cl' },
    } as unknown as firebaseAuth.UserCredential);

    await signInWithGoogle({ authRuntime });

    expect(firebaseAuth.signInWithPopup).toHaveBeenCalledWith(authRuntime.auth, expect.anything());
  });

  it('exchanges a current GIS credential in the same Firebase runtime without popup', async () => {
    const authRuntime = createAuthRuntime();
    const firebaseUser = { uid: 'fedcm-1', email: 'admin@hospital.cl' } as firebaseAuth.User;
    vi.mocked(firebaseAuth.signInWithCredential).mockImplementation(async () => {
      Object.assign(authRuntime.auth, { currentUser: firebaseUser });
      return { user: firebaseUser } as firebaseAuth.UserCredential;
    });
    const user = await signInWithGoogle({
      authRuntime,
      googleCredential: {
        idToken: 'test-auth-token',
        isCurrent: () => true,
      },
    });
    expect(user).toMatchObject({ uid: 'fedcm-1', role: 'admin' });
    expect(firebaseAuth.signInWithCredential).toHaveBeenCalledWith(authRuntime.auth, {
      idToken: 'test-auth-token',
    });
    expect(firebaseAuth.signInWithPopup).not.toHaveBeenCalled();
  });

  it('does not exchange an obsolete GIS credential or navigate as fallback', async () => {
    await expect(
      signInWithGoogle({
        authRuntime: createAuthRuntime(),
        googleCredential: {
          idToken: 'dummy',
          isCurrent: () => false,
        },
      })
    ).rejects.toMatchObject({ code: 'auth/cancelled-popup-request' });
    expect(firebaseAuth.signInWithCredential).not.toHaveBeenCalled();
    expect(firebaseAuth.signInWithPopup).not.toHaveBeenCalled();
    expect(firebaseAuth.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('falls back to redirect auth when popup flow hits a recoverable COOP error', async () => {
    const authRuntime = createAuthRuntime();
    vi.mocked(firebaseAuth.signInWithPopup).mockRejectedValue(
      new Error('INTERNAL ASSERTION FAILED: Cross-Origin-Opener-Policy')
    );

    await expect(signInWithGoogle({ authRuntime })).rejects.toMatchObject({
      code: 'auth/popup-coop-blocked',
    });

    expect(firebaseAuth.signInWithRedirect).toHaveBeenCalledWith(
      authRuntime.auth,
      expect.anything()
    );
  });

  it('uses the injected runtime for email/password sign-in and sign-out fallback', async () => {
    const authRuntime = createAuthRuntime();
    vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: {
        uid: 'user-1',
        email: 'admin@hospital.cl',
        displayName: 'Admin',
      },
    } as unknown as firebaseAuth.UserCredential);

    await signIn('admin@hospital.cl', 'secret', { authRuntime });
    await createUser('new@hospital.cl', 'secret', { authRuntime });

    expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalledWith(
      authRuntime.auth,
      'admin@hospital.cl',
      'secret'
    );
    expect(firebaseAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      authRuntime.auth,
      'new@hospital.cl',
      'secret'
    );
  });

  it('uses the injected runtime for redirect auth start and result handling', async () => {
    const authRuntime = createAuthRuntime();
    vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue({
      user: { uid: 'redirect-1', email: 'admin@hospital.cl' },
    } as unknown as firebaseAuth.UserCredential);

    await signInWithGoogleRedirect({ authRuntime });
    await handleSignInRedirectResult({ authRuntime });

    expect(firebaseAuth.signInWithRedirect).toHaveBeenCalledWith(
      authRuntime.auth,
      expect.anything()
    );
    expect(firebaseAuth.getRedirectResult).toHaveBeenCalledWith(authRuntime.auth);
  });

  it('reads the current user from the injected runtime for session helpers', async () => {
    const authRuntime = createAuthRuntime();
    const runtimeUser = {
      uid: 'runtime-user',
      email: 'admin@hospital.cl',
    } as firebaseAuth.User;
    authRuntime.getCurrentUser = vi.fn(() => runtimeUser);

    expect(hasActiveFirebaseSession({ authRuntime })).toBe(true);
    await expect(isCurrentUserAuthorizedForGeneralLogin({ authRuntime })).resolves.toBe(true);
  });
});
