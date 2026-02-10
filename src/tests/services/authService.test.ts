import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIn, signInWithGoogle, onAuthChange } from '@/services/auth/authService';
import * as firebaseAuth from 'firebase/auth';
import { getDocs } from 'firebase/firestore';

vi.unmock('../../services/auth/authService');
vi.unmock('@/services/auth/authService');

// Mock setup for authService tests
vi.mock('firebase/auth', () => {
    const GoogleAuthProvider = vi.fn();
    (GoogleAuthProvider as unknown as { prototype: { setCustomParameters: () => void } }).prototype.setCustomParameters = vi.fn();

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

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn()
}));

describe('authService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('signIn', () => {
        it('should allow access if user is in whitelist', async () => {
            const mockFirebaseUser = {
                user: {
                    uid: '123',
                    email: 'daniel.opazo@hospitalhangaroa.cl',
                    displayName: 'Daniel'
                }
            };

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as unknown as firebaseAuth.UserCredential);

            // Static role check should catch this before Firestore
            const result = await signIn('daniel.opazo@hospitalhangaroa.cl', 'password');

            expect(result.uid).toBe('123');
            expect(result.role).toBe('admin');
            expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalled();
        });

        it('should deny access and sign out if user is not in whitelist', async () => {
            const mockFirebaseUser = {
                user: {
                    uid: '456',
                    email: 'unknown@gmail.com',
                    displayName: 'Unknown'
                }
            };

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as unknown as firebaseAuth.UserCredential);
            vi.mocked(getDocs).mockResolvedValue({ empty: true } as unknown as any); // Using unknown to satisfy TS without a full QuerySnapshot mock

            await expect(signIn('unknown@gmail.com', 'password')).rejects.toThrow('Acceso no autorizado');
            expect(firebaseAuth.signOut).toHaveBeenCalled();
        });

        it('should normalize emails during check', async () => {
            const mockFirebaseUser = {
                user: {
                    uid: '123',
                    email: 'DANIEL.OPAZO@HOSPITALHANGAROA.CL ', // With spaces and caps
                    displayName: 'Daniel'
                }
            };

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as unknown as firebaseAuth.UserCredential);

            const result = await signIn(' DANIEL.opazo@hospitalhangaroa.cl', 'password');

            expect(result.role).toBe('admin');
        });
    });

    describe('signInWithGoogle', () => {
        it('should succeed for authorized users', async () => {
            const mockResult = {
                user: {
                    uid: 'google-123',
                    email: 'd.opazo.damiani@gmail.com',
                    displayName: 'Daniel Google'
                }
            };

            vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValue(mockResult as unknown as firebaseAuth.UserCredential);

            const result = await signInWithGoogle();

            expect(result.uid).toBe('google-123');
            expect(result.role).toBe('doctor_urgency');
        });
    });

    describe('onAuthChange', () => {
        it('should handle anonymous users for signature mode', async () => {
            const mockCallback = vi.fn();

            onAuthChange(mockCallback);

            expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalled();
            const firebaseCallback = vi.mocked(firebaseAuth.onAuthStateChanged).mock.calls[0][1] as (user: firebaseAuth.User | null) => Promise<void>;

            await firebaseCallback({
                uid: 'anon-123',
                isAnonymous: true
            } as unknown as firebaseAuth.User);

            expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
                uid: 'anon-123',
                displayName: 'Anonymous Doctor',
                role: 'viewer'
            }));
        });
    });

    describe('createUser', () => {
        it('should create a new user', async () => {
            const mockUser = {
                user: {
                    uid: 'new-123',
                    email: 'new@test.com',
                    displayName: 'New User'
                }
            };
            vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockResolvedValue(mockUser as any);

            const result = await (await import('@/services/auth/authService')).createUser('new@test.com', 'password');
            expect(result.uid).toBe('new-123');
        });

        it('should map Firebase error codes', async () => {
            vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValue({ code: 'auth/email-already-in-use' });

            await expect((await import('@/services/auth/authService')).createUser('used@test.com', 'password'))
                .rejects.toThrow('Este email ya está registrado');
        });
    });

    describe('signOut', () => {
        it('should sign out and clear cache', async () => {
            await (await import('@/services/auth/authService')).signOut();
            expect(firebaseAuth.signOut).toHaveBeenCalled();
        });
    });

    describe('signInAnonymouslyForPassport', () => {
        it('should return uid if user already signed in', async () => {
            const auth = (await import('@/firebaseConfig')).auth;
            Object.defineProperty(auth, 'currentUser', { value: { uid: 'existing-123' }, configurable: true });

            const result = await (await import('@/services/auth/authService')).signInAnonymouslyForPassport();
            expect(result).toBe('existing-123');
        });

        it('should sign in anonymously if not signed in', async () => {
            const auth = (await import('@/firebaseConfig')).auth;
            Object.defineProperty(auth, 'currentUser', { value: null, configurable: true });
            vi.mocked(firebaseAuth.signInAnonymously).mockResolvedValue({ user: { uid: 'anon-456' } } as any);

            const result = await (await import('@/services/auth/authService')).signInAnonymouslyForPassport();
            expect(result).toBe('anon-456');
        });
    });

    describe('handleSignInRedirectResult', () => {
        it('should return null if no result', async () => {
            vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue(null);
            const result = await (await import('@/services/auth/authService')).handleSignInRedirectResult();
            expect(result).toBeNull();
        });

        it('should return user for shared census mode', async () => {
            // Mock window.location.pathname
            const originalLocation = window.location;
            delete (window as any).location;
            (window as any).location = { ...originalLocation, pathname: '/censo-compartido/test' };

            vi.mocked(firebaseAuth.getRedirectResult).mockResolvedValue({
                user: { uid: 'shared-123', email: 'guest@test.com', displayName: 'Guest' }
            } as any);

            const result = await (await import('@/services/auth/authService')).handleSignInRedirectResult();
            expect(result?.role).toBe('viewer_census');

            // Restore location
            (window as any).location = originalLocation;
        });
    });
});
