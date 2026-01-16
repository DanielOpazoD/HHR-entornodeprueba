/**
 * useSharedCensusMode Hook Tests
 * Tests for shared census access authorization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSharedCensusMode } from '@/hooks/useSharedCensusMode';
import * as censusAuthorizedEmails from '@/constants/censusAuthorizedEmails';

// Mock window.location
const mockLocation = {
    pathname: '/'
};
Object.defineProperty(window, 'location', {
    value: mockLocation,
    writable: true
});

// Mock useAuth context
const mockUser = {
    uid: 'user-123',
    email: 'authorized@hospital.cl',
    displayName: 'Test User'
};
let mockAuthLoading = false;

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        user: mockUser,
        isLoading: mockAuthLoading
    })
}));

vi.mock('@/constants/censusAuthorizedEmails');

describe('useSharedCensusMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLocation.pathname = '/';
        mockAuthLoading = false;
    });

    describe('Non-shared mode access', () => {
        it('should return isSharedCensusMode as false on normal routes', () => {
            mockLocation.pathname = '/dashboard';

            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.isSharedCensusMode).toBe(false);
        });

        it('should not be loading on normal routes', async () => {
            mockLocation.pathname = '/censo';

            const { result } = renderHook(() => useSharedCensusMode());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });
        });
    });

    describe('Shared mode detection', () => {
        it('should detect /censo-compartido path', () => {
            mockLocation.pathname = '/censo-compartido';

            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.isSharedCensusMode).toBe(true);
        });

        it('should detect /censo-publico path', () => {
            mockLocation.pathname = '/censo-publico';

            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.isSharedCensusMode).toBe(true);
        });

        it('should extract invitation ID from URL', () => {
            mockLocation.pathname = '/censo-compartido/abc123';

            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.invitationId).toBe('abc123');
        });
    });

    describe('Authorization', () => {
        beforeEach(() => {
            mockLocation.pathname = '/censo-compartido';
        });

        it('should check email authorization on shared routes', () => {
            vi.mocked(censusAuthorizedEmails.isEmailAuthorizedForCensus).mockReturnValue(true);

            renderHook(() => useSharedCensusMode());

            // The hook should call the authorization check
            expect(censusAuthorizedEmails.isEmailAuthorizedForCensus).toHaveBeenCalled();
        });

        it('should have proper return type', () => {
            vi.mocked(censusAuthorizedEmails.isEmailAuthorizedForCensus).mockReturnValue(true);

            const { result } = renderHook(() => useSharedCensusMode());

            expect(typeof result.current.isSharedCensusMode).toBe('boolean');
            expect(typeof result.current.isLoading).toBe('boolean');
            expect(typeof result.current.needsLogin).toBe('boolean');
        });

        it('should detect shared mode path correctly', () => {
            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.isSharedCensusMode).toBe(true);
        });
    });

    describe('Access User Object', () => {
        beforeEach(() => {
            mockLocation.pathname = '/censo-compartido';
            vi.mocked(censusAuthorizedEmails.isEmailAuthorizedForCensus).mockReturnValue(true);
        });

        it('should have correct return shape', () => {
            const { result } = renderHook(() => useSharedCensusMode());

            // Verify the hook returns all expected properties
            expect(result.current).toHaveProperty('isSharedCensusMode');
            expect(result.current).toHaveProperty('invitationId');
            expect(result.current).toHaveProperty('accessUser');
            expect(result.current).toHaveProperty('isLoading');
            expect(result.current).toHaveProperty('error');
            expect(result.current).toHaveProperty('needsLogin');
        });

        it('should set isSharedCensusMode correctly', () => {
            const { result } = renderHook(() => useSharedCensusMode());

            expect(result.current.isSharedCensusMode).toBe(true);
        });
    });
});
