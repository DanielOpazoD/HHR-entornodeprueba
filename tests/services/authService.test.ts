import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIn, signInWithGoogle, onAuthChange } from '../../services/auth/authService';
import * as firebaseAuth from 'firebase/auth';
import { getDocs } from 'firebase/firestore';

vi.unmock('../../services/auth/authService');
vi.unmock('@/services/auth/authService');

// Mock setup for authService tests
vi.mock('firebase/auth', () => {
    const GoogleAuthProvider = vi.fn();
    (GoogleAuthProvider as any).prototype.setCustomParameters = vi.fn();

    return {
        signInWithEmailAndPassword: vi.fn(),
        signInWithPopup: vi.fn(),
        signOut: vi.fn(),
        onAuthStateChanged: vi.fn(),
        GoogleAuthProvider,
        signInAnonymously: vi.fn()
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

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as any);

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

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as any);
            vi.mocked(getDocs).mockResolvedValue({ empty: true } as any);

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

            vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockResolvedValue(mockFirebaseUser as any);

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

            vi.mocked(firebaseAuth.signInWithPopup).mockResolvedValue(mockResult as any);

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
            const firebaseCallback = vi.mocked(firebaseAuth.onAuthStateChanged).mock.calls[0][1] as (user: any) => Promise<void>;

            await firebaseCallback({
                uid: 'anon-123',
                isAnonymous: true
            } as any);

            expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
                uid: 'anon-123',
                displayName: 'Anonymous Doctor',
                role: 'viewer'
            }));
        });
    });
});
