import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firebaseAuth from 'firebase/auth';
import type { AuthRuntime } from '@/services/firebase-runtime/authRuntime';
import type { AuthUser } from '@/types/authRoleTypes';
import {
  authorizeCurrentFirebaseUser,
  authorizeFirebaseUser,
} from '@/services/auth/authAccessResolution';
import { consumeE2EPopupMockUser } from '@/services/auth/authE2EPopupRuntime';
import { createCensusPerfModel } from '@/shared/runtime/censusPerfModel';

const { mockRecordAuthPerfEvent } = vi.hoisted(() => ({ mockRecordAuthPerfEvent: vi.fn() }));
vi.mock('@/shared/runtime/censusStartupPerf', () => ({
  recordAuthPerfEvent: mockRecordAuthPerfEvent,
}));
vi.mock('@/services/auth/authE2EPopupRuntime', () => ({
  consumeE2EPopupDelayMs: vi.fn(() => 0),
  consumeE2EPopupErrorCode: vi.fn(() => null),
  consumeE2EPopupMockUser: vi.fn(() => null),
}));

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
    mockRecordAuthPerfEvent.mockReset();
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
    expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
  });

  it.each(['popup', 'gis'] as const)(
    'records %s authentication only after Firebase resolves, before pending role authorization',
    async path => {
      let sequence = 0;
      let now = 10;
      const model = createCensusPerfModel({
        now: () => now,
        id: () => 'attempt-' + ++sequence,
        timeOrigin: 0,
        environment: 'development',
      });
      const id = model.begin(path === 'popup' ? 'app_button' : 'google_button');
      if (path === 'gis') model.receiveCredential();
      mockRecordAuthPerfEvent.mockImplementation(model.auth);
      let resolveFirebase!: (value: firebaseAuth.UserCredential) => void;
      let resolveRole!: (value: AuthUser) => void;
      const exchange = new Promise<firebaseAuth.UserCredential>(resolve => {
        resolveFirebase = resolve;
      });
      const role = new Promise<AuthUser>(resolve => {
        resolveRole = resolve;
      });
      const exchangeMock =
        path === 'popup'
          ? vi.mocked(firebaseAuth.signInWithPopup)
          : vi.mocked(firebaseAuth.signInWithCredential);
      exchangeMock.mockReturnValueOnce(exchange);
      vi.mocked(authorizeFirebaseUser).mockReturnValueOnce(role);
      const pending = signInWithGoogle({
        authRuntime: createAuthRuntime(),
        perfAttemptId: id,
        ...(path === 'gis'
          ? { googleCredential: { idToken: 'synthetic-sensitive-token', isCurrent: () => true } }
          : {}),
      });
      await vi.waitFor(() => expect(exchangeMock).toHaveBeenCalledOnce());
      expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
      now = 20;
      resolveFirebase({
        user: { uid: 'user-1', email: 'sensitive@hospital.cl' },
      } as firebaseAuth.UserCredential);
      await vi.waitFor(() => expect(authorizeFirebaseUser).toHaveBeenCalledOnce());
      expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
        [id, 'credential_received'],
        [id, 'authenticated'],
      ]);
      expect(model.snapshot().authAttempts[0].events).toEqual({
        started: 10,
        credential_received: path === 'gis' ? 10 : 20,
        authenticated: 20,
      });
      const audit = JSON.stringify(model.snapshot());
      expect(audit).not.toContain('synthetic-sensitive-token');
      expect(audit).not.toContain('sensitive@hospital.cl');
      resolveRole({
        uid: 'user-1',
        email: 'sensitive@hospital.cl',
        displayName: 'User',
        role: 'admin',
      });
      await expect(pending).resolves.toMatchObject({ role: 'admin' });
    }
  );

  it.each(['popup', 'gis', 'token-construction', 'obsolete-credential'] as const)(
    'does not record authentication for %s failure before Firebase result',
    async path => {
      const failure = Object.assign(new Error('synthetic exchange failure'), {
        code: 'auth/network-request-failed',
      });
      if (path === 'popup') vi.mocked(firebaseAuth.signInWithPopup).mockRejectedValueOnce(failure);
      if (path === 'gis')
        vi.mocked(firebaseAuth.signInWithCredential).mockRejectedValueOnce(failure);
      if (path === 'token-construction')
        vi.mocked(firebaseAuth.GoogleAuthProvider.credential).mockImplementationOnce(() => {
          throw failure;
        });
      await expect(
        signInWithGoogle({
          authRuntime: createAuthRuntime(),
          perfAttemptId: 'attempt-1',
          ...(path !== 'popup'
            ? {
                googleCredential: {
                  idToken: 'synthetic-sensitive-token',
                  isCurrent: () => path !== 'obsolete-credential',
                },
              }
            : {}),
        })
      ).rejects.toBeDefined();
      expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
      expect(authorizeFirebaseUser).not.toHaveBeenCalled();
    }
  );

  it.each(['existing-session', 'e2e-fixture'] as const)(
    'does not invent a Firebase exchange for %s',
    async path => {
      const user: AuthUser = {
        uid: 'existing-1',
        email: 'spec@hospital.cl',
        displayName: 'Existing',
        role: 'admin',
      };
      if (path === 'existing-session')
        vi.mocked(authorizeCurrentFirebaseUser).mockResolvedValueOnce(user);
      else vi.mocked(consumeE2EPopupMockUser).mockReturnValueOnce(user);
      await expect(
        signInWithGoogle({ authRuntime: createAuthRuntime(), perfAttemptId: 'attempt-1' })
      ).resolves.toEqual(user);
      expect(firebaseAuth.signInWithPopup).not.toHaveBeenCalled();
      expect(firebaseAuth.signInWithCredential).not.toHaveBeenCalled();
      expect(mockRecordAuthPerfEvent).not.toHaveBeenCalled();
    }
  );

  it('does not let either metric write failure prevent role authorization and login', async () => {
    mockRecordAuthPerfEvent.mockImplementation(() => {
      throw new Error('audit unavailable');
    });
    vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValueOnce({
      user: { uid: 'google-1', email: 'admin@hospital.cl' },
    } as firebaseAuth.UserCredential);
    await expect(
      signInWithGoogle({ authRuntime: createAuthRuntime(), perfAttemptId: 'attempt-1' })
    ).resolves.toMatchObject({ uid: 'google-1', role: 'admin' });
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['attempt-1', 'credential_received'],
      ['attempt-1', 'authenticated'],
    ]);
    expect(authorizeFirebaseUser).toHaveBeenCalledOnce();
  });

  it('records authenticated but never authorized when role validation rejects', async () => {
    vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValueOnce({
      user: { uid: 'google-1', email: 'admin@hospital.cl' },
    } as firebaseAuth.UserCredential);
    vi.mocked(authorizeFirebaseUser).mockRejectedValueOnce(new Error('no autorizado'));
    await expect(
      signInWithGoogle({ authRuntime: createAuthRuntime(), perfAttemptId: 'attempt-1' })
    ).rejects.toThrow('no autorizado');
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['attempt-1', 'credential_received'],
      ['attempt-1', 'authenticated'],
    ]);
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
