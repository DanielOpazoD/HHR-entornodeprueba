import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signIn, signInWithGoogle, createUser } from '@/services/auth/authFlow';
import { signInWithGoogleRedirect, handleSignInRedirectResult } from '@/services/auth/authFallback';
import { signOut } from '@/services/auth/authSession';
import * as authRedirectRuntime from '@/services/auth/authRedirectRuntime';
import * as firebaseAuth from 'firebase/auth';

vi.unmock('../../services/auth/authFlow');
vi.unmock('@/services/auth/authFlow');
vi.unmock('../../services/auth/authFallback');
vi.unmock('@/services/auth/authFallback');
vi.unmock('../../services/auth/authSession');
vi.unmock('@/services/auth/authSession');

const mockCheckUserRoleCallable = vi.fn();

// Mock setup for canonical auth public entrypoints
vi.mock('firebase/auth', () => {
  const GoogleAuthProvider = vi.fn();
  (
    GoogleAuthProvider as unknown as { prototype: { setCustomParameters: () => void } }
  ).prototype.setCustomParameters = vi.fn();

  return {
    signInWithEmailAndPassword: vi.fn(),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider,
    signInAnonymously: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(),
  };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions: unknown, callableName: string) => {
    if (callableName === 'checkUserRole') {
      return mockCheckUserRoleCallable;
    }
    return vi.fn().mockResolvedValue({ data: {} });
  }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

describe('auth public entrypoints', () => {
  const AUTH_BOOTSTRAP_PENDING_KEY = 'hhr_auth_bootstrap_pending_v1';
  const GOOGLE_LOGIN_LOCK_KEY = 'hhr_google_login_lock_v1';
  const defaultRedirectRuntimeSupport: authRedirectRuntime.AuthRedirectRuntimeSupport = {
    isLocalhostRuntime: false,
    preferRedirectOnLocalhost: false,
    canUseRedirectAuth: true,
    supportLevel: 'ready',
    redirectDisabledReason: null,
    supportSummary: null,
    supportAction: null,
    recommendedFlowLabel: 'Acceso alternativo',
    authDomain: 'hospitalhangaroa.firebaseapp.com',
    usesFirebaseHostedAuthDomain: true,
  };
  const originalLocation = window.location;
  const setLocation = (pathname: string, hostname = originalLocation.hostname) => {
    Reflect.deleteProperty(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname, hostname },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authRedirectRuntime, 'getAuthRedirectRuntimeSupport').mockReturnValue(
      defaultRedirectRuntimeSupport
    );
    localStorage.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
    localStorage.removeItem(GOOGLE_LOGIN_LOCK_KEY);
    mockCheckUserRoleCallable.mockResolvedValue({
      data: { role: 'unauthorized' },
    });
    setLocation('/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('signIn', () => {
    it('should allow access for users authorized in config/roles', async () => {
      const mockFirebaseUser = {
        user: {
          uid: '123',
          email: 'admin@hospital.cl',
          displayName: 'Admin',
        },
      };
      mockCheckUserRoleCallable.mockResolvedValue({
        data: { role: 'admin' },
      });

      vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(
        mockFirebaseUser as unknown as firebaseAuth.UserCredential
      );

      const result = await signIn('admin@hospital.cl', 'password');

      expect(result.uid).toBe('123');
      expect(result.role).toBe('admin');
      expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalled();
    });

    it('should deny access and sign out if user has no valid role', async () => {
      const mockFirebaseUser = {
        user: {
          uid: '456',
          email: 'unknown@gmail.com',
          displayName: 'Unknown',
        },
      };

      vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(
        mockFirebaseUser as unknown as firebaseAuth.UserCredential
      );
      await expect(signIn('unknown@gmail.com', 'password')).rejects.toThrow('Acceso no autorizado');
      expect(firebaseAuth.signOut).toHaveBeenCalled();
    });

    it('should normalize emails during check', async () => {
      const mockFirebaseUser = {
        user: {
          uid: '123',
          email: 'ADMIN@HOSPITAL.CL ', // With spaces and caps
          displayName: 'Admin',
        },
      };
      mockCheckUserRoleCallable.mockResolvedValue({
        data: { role: 'admin' },
      });

      vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(
        mockFirebaseUser as unknown as firebaseAuth.UserCredential
      );

      const result = await signIn(' ADMIN@hospital.cl', 'password');

      expect(result.role).toBe('admin');
    });

    it('should reject emails that only look privileged when no configured role exists', async () => {
      const mockFirebaseUser = {
        user: {
          uid: 'attacker-1',
          email: 'admin@hospital.cl.attacker@evil.com',
          displayName: 'Attacker',
        },
      };

      vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(
        mockFirebaseUser as unknown as firebaseAuth.UserCredential
      );
      await expect(signIn('admin@hospital.cl.attacker@evil.com', 'password')).rejects.toThrow(
        'Acceso no autorizado'
      );
      expect(firebaseAuth.signOut).toHaveBeenCalled();
    });
  });

  describe('signInWithGoogle', () => {
    it('should succeed for authorized users resolved from config roles', async () => {
      const mockResult = {
        user: {
          uid: 'google-123',
          email: 'specialist@hospital.cl',
          displayName: 'Specialist Google',
        },
      };
      mockCheckUserRoleCallable.mockResolvedValue({
        data: { role: 'doctor_specialist' },
      });

      vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValue(
        mockResult as unknown as firebaseAuth.UserCredential
      );

      const result = await signInWithGoogle();

      expect(result.uid).toBe('google-123');
      expect(result.role).toBe('doctor_specialist');
    });

    it('should fail with multi-tab guidance when another tab lock is active', async () => {
      localStorage.setItem(
        GOOGLE_LOGIN_LOCK_KEY,
        JSON.stringify({ owner: 'external-tab', timestamp: 9999999999999 })
      );

      await expect(signInWithGoogle()).rejects.toThrow(/otra pestaña.*\d+s/i);
      expect(firebaseAuth.signInWithPopup).not.toHaveBeenCalled();
    });

    it('should map INTERNAL ASSERTION popup failures to fallback auth error code', async () => {
      vi.mocked(firebaseAuth.signInWithPopup).mockRejectedValue(
        new Error('INTERNAL ASSERTION FAILED: Cross-Origin-Opener-Policy')
      );

      await expect(signInWithGoogle()).rejects.toMatchObject({
        code: 'auth/popup-coop-blocked',
      });
    });

    it('should start redirect fallback on localhost after a recoverable popup failure', async () => {
      vi.spyOn(authRedirectRuntime, 'getAuthRedirectRuntimeSupport').mockReturnValue({
        ...defaultRedirectRuntimeSupport,
        isLocalhostRuntime: true,
        canUseRedirectAuth: false,
        supportLevel: 'disabled',
        redirectDisabledReason:
          'En este equipo el acceso alternativo está desactivado para evitar bucles de acceso en el navegador.',
        supportSummary:
          'En localhost el sistema prefiere la ventana normal de Google y evita cambiar de pestaña automáticamente.',
        supportAction:
          'Si la ventana no aparece, usa el botón principal otra vez o revisa si el navegador bloqueó ventanas emergentes.',
        recommendedFlowLabel: 'Ventana de Google',
      });
      vi.mocked(firebaseAuth.signInWithPopup).mockRejectedValue({
        code: 'auth/popup-blocked',
        message: 'popup blocked',
      });

      await expect(signInWithGoogle()).rejects.toMatchObject({
        code: 'auth/popup-blocked',
      });

      expect(firebaseAuth.signInWithRedirect).toHaveBeenCalled();
    });

    it('should not start redirect fallback when the popup request is cancelled', async () => {
      vi.mocked(firebaseAuth.signInWithPopup).mockRejectedValue({
        code: 'auth/cancelled-popup-request',
        message: 'cancelled-popup-request',
      });

      await expect(signInWithGoogle()).rejects.toMatchObject({
        code: 'auth/cancelled-popup-request',
      });

      expect(firebaseAuth.signInWithRedirect).not.toHaveBeenCalled();
    });

    it('should keep the popup flow pending when Google selection takes a long time', async () => {
      vi.useFakeTimers();
      vi.mocked(firebaseAuth.signInWithPopup).mockImplementation(
        () => new Promise(() => {}) as Promise<firebaseAuth.UserCredential>
      );

      let settled = false;
      void signInWithGoogle().then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );

      // A user can legitimately spend >30s inside the Google popup (account
      // picker + password + 2FA); the flow must stay pending well past that.
      await vi.advanceTimersByTimeAsync(60000);
      expect(settled).toBe(false);
    });

    it('should fail cleanly when the Google popup never settles', async () => {
      vi.useFakeTimers();
      vi.mocked(firebaseAuth.signInWithPopup).mockImplementation(
        () => new Promise(() => {}) as Promise<firebaseAuth.UserCredential>
      );

      let rejectedError: unknown = null;
      void signInWithGoogle().catch(error => {
        rejectedError = error;
      });

      await vi.waitFor(() => expect(firebaseAuth.signInWithPopup).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(121000);
      await Promise.resolve();

      expect(rejectedError).toMatchObject({ code: 'auth/popup-timeout' });
      expect(localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY)).toBeNull();
    });
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      const mockUser = {
        user: {
          uid: 'new-123',
          email: 'new@test.com',
          displayName: 'New User',
        },
      };
      vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockResolvedValue(
        mockUser as unknown as firebaseAuth.UserCredential
      );

      const result = await createUser('new@test.com', 'password');
      expect(result.uid).toBe('new-123');
    });

    it('should map Firebase error codes', async () => {
      vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValue({
        code: 'auth/email-already-in-use',
      });

      await expect(createUser('used@test.com', 'password')).rejects.toThrow(
        'Este email ya está registrado'
      );
    });
  });

  describe('signOut', () => {
    it('should sign out and clear cache', async () => {
      await signOut();
      expect(firebaseAuth.signOut).toHaveBeenCalled();
    });
  });

  describe('handleSignInRedirectResult', () => {
    it('should return null if no result', async () => {
      vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue(null);
      const result = await handleSignInRedirectResult();
      expect(result).toBeNull();
    });

    it('should return authorized session state when redirect succeeds', async () => {
      vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue({
        user: { uid: 'redirect-123', email: 'admin@test.com', displayName: 'Admin' },
      } as unknown as firebaseAuth.UserCredential);
      mockCheckUserRoleCallable.mockResolvedValue({
        data: { role: 'admin' },
      });

      const result = await handleSignInRedirectResult();
      expect(result).toEqual(
        expect.objectContaining({
          status: 'authorized',
          user: expect.objectContaining({
            role: 'admin',
          }),
        })
      );
    });

    it('stays quiet when a stale pending flag from another tab finishes without result', async () => {
      // The pending flag is shared via localStorage across tabs; without the
      // per-tab sessionStorage login-attempt hint this tab never started a
      // Google flow, so no scary error should surface here.
      localStorage.setItem(
        AUTH_BOOTSTRAP_PENDING_KEY,
        JSON.stringify({ startedAt: 9999999999999, mode: 'redirect' })
      );
      vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue(null);

      const result = await handleSignInRedirectResult();

      expect(result).toBeNull();
      expect(localStorage.getItem(AUTH_BOOTSTRAP_PENDING_KEY)).toBeNull();
    });

    it('should surface an auth error when a recent Google attempt returns without result', async () => {
      sessionStorage.setItem('hhr_google_login_attempt_pending', String(Date.now()));
      vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue(null);

      const result = await handleSignInRedirectResult();

      expect(result).toEqual(
        expect.objectContaining({
          status: 'auth_error',
          error: expect.objectContaining({
            code: 'auth/redirect-empty-result',
            retryable: true,
          }),
        })
      );
      expect(sessionStorage.getItem('hhr_google_login_attempt_pending')).toBeNull();
    });
  });

  describe('signInWithGoogleRedirect', () => {
    it('should mark bootstrap as pending before redirect starts', async () => {
      setLocation('/', 'app.hhr.test');

      await signInWithGoogleRedirect();

      expect(firebaseAuth.signInWithRedirect).toHaveBeenCalled();
      expect(localStorage.getItem(AUTH_BOOTSTRAP_PENDING_KEY)).not.toBeNull();
    });

    it('should reject redirect flow on localhost when runtime policy disables it', async () => {
      vi.spyOn(authRedirectRuntime, 'getAuthRedirectRuntimeSupport').mockReturnValue({
        ...defaultRedirectRuntimeSupport,
        isLocalhostRuntime: true,
        canUseRedirectAuth: false,
        supportLevel: 'disabled',
        redirectDisabledReason:
          'En este equipo el acceso alternativo está desactivado para evitar bucles de acceso en el navegador.',
        supportSummary:
          'En localhost el sistema prefiere la ventana normal de Google y evita cambiar de pestaña automáticamente.',
        supportAction:
          'Si la ventana no aparece, usa el botón principal otra vez o revisa si el navegador bloqueó ventanas emergentes.',
        recommendedFlowLabel: 'Ventana de Google',
      });

      await expect(signInWithGoogleRedirect()).rejects.toThrow(
        /acceso alternativo está desactivado/i
      );
      expect(firebaseAuth.signInWithRedirect).not.toHaveBeenCalled();
    });
  });
});
