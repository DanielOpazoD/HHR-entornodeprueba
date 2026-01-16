import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSignatureMode } from '../../hooks/useSignatureMode';
import { signInAnonymously } from 'firebase/auth';

// Mock Firebase Auth
vi.mock('firebase/auth', () => ({
    signInAnonymously: vi.fn().mockResolvedValue({ user: { uid: 'anon-123' } }),
    getAuth: vi.fn(() => ({})),
}));

// Mock Firebase Config
vi.mock('../../firebaseConfig', () => ({
    auth: { currentUser: null },
}));

describe('useSignatureMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock URL parameters
        delete (window as any).location;
        (window as any).location = new URL('http://localhost/?mode=signature');
    });

    it('should sign in anonymously if in signature mode and no user is present', () => {
        renderHook(() => useSignatureMode('2024-12-28', null, false));

        expect(signInAnonymously).toHaveBeenCalled();
    });

    it('should NOT sign in anonymously if a user is already present (real or passport)', () => {
        const mockAdminUser = { uid: 'admin-1', email: 'admin@hhr.cl', displayName: 'Admin' } as any;
        renderHook(() => useSignatureMode('2024-12-28', mockAdminUser, false));

        expect(signInAnonymously).not.toHaveBeenCalled();
    });

    it('should NOT sign in anonymously if auth is loading', () => {
        renderHook(() => useSignatureMode('2024-12-28', null, true));

        expect(signInAnonymously).not.toHaveBeenCalled();
    });

    it('should NOT sign in if NOT in signature mode', () => {
        (window as any).location = new URL('http://localhost/');
        renderHook(() => useSignatureMode('2024-12-28', null, false));

        expect(signInAnonymously).not.toHaveBeenCalled();
    });
});
