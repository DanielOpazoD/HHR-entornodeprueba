import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getCurrentUserEmail,
    getCurrentUserDisplayName,
    getCurrentUserUid,
    getCachedIpAddress,
    fetchAndCacheIpAddress
} from '@/services/admin/utils/auditUtils';
import { getAuth } from 'firebase/auth';

// Mock Firebase Auth
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn()
}));

// Mock fetch
global.fetch = vi.fn();

describe('auditUtils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    describe('getCurrentUserEmail', () => {
        it('should return user email when available', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { email: 'test@example.com' }
            } as any);

            expect(getCurrentUserEmail()).toBe('test@example.com');
        });

        it('should cache email in localStorage', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { email: 'cached@example.com' }
            } as any);

            getCurrentUserEmail();
            expect(localStorage.getItem('hhr_audit_user_email_cache')).toBe('cached@example.com');
        });

        it('should return cached email if no current user', () => {
            localStorage.setItem('hhr_audit_user_email_cache', 'cached@test.com');
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { email: null }
            } as any);

            expect(getCurrentUserEmail()).toBe('cached@test.com');
        });

        it('should return displayName if no email', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { email: null, displayName: 'Test User' }
            } as any);

            expect(getCurrentUserEmail()).toBe('Test User');
        });

        it('should return uid as last resort', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { email: null, displayName: null, uid: 'user123' }
            } as any);

            expect(getCurrentUserEmail()).toBe('user123');
        });

        it('should return anonymous_user if no info available', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: null
            } as any);

            expect(getCurrentUserEmail()).toBe('anonymous_user');
        });

        it('should return system_context on error', () => {
            vi.mocked(getAuth).mockImplementation(() => {
                throw new Error('Auth error');
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            expect(getCurrentUserEmail()).toBe('system_context');
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('getCurrentUserDisplayName', () => {
        it('should return display name', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { displayName: 'John Doe' }
            } as any);

            expect(getCurrentUserDisplayName()).toBe('John Doe');
        });

        it('should return undefined if no display name', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { displayName: null }
            } as any);

            expect(getCurrentUserDisplayName()).toBeUndefined();
        });

        it('should return undefined on error', () => {
            vi.mocked(getAuth).mockImplementation(() => {
                throw new Error('Error');
            });

            expect(getCurrentUserDisplayName()).toBeUndefined();
        });
    });

    describe('getCurrentUserUid', () => {
        it('should return UID', () => {
            vi.mocked(getAuth).mockReturnValue({
                currentUser: { uid: 'uid123' }
            } as any);

            expect(getCurrentUserUid()).toBe('uid123');
        });

        it('should return undefined on error', () => {
            vi.mocked(getAuth).mockImplementation(() => {
                throw new Error('Error');
            });

            expect(getCurrentUserUid()).toBeUndefined();
        });
    });

    describe('getCachedIpAddress', () => {
        it('should return cached IP', () => {
            sessionStorage.setItem('hhr_audit_user_ip', '192.168.1.1');
            expect(getCachedIpAddress()).toBe('192.168.1.1');
        });

        it('should return undefined if not cached', () => {
            expect(getCachedIpAddress()).toBeUndefined();
        });
    });

    describe('fetchAndCacheIpAddress', () => {
        it('should fetch and cache IP', async () => {
            vi.mocked(fetch).mockResolvedValue({
                json: () => Promise.resolve({ ip: '1.2.3.4' })
            } as any);

            const ip = await fetchAndCacheIpAddress();
            expect(ip).toBe('1.2.3.4');
            expect(sessionStorage.getItem('hhr_audit_user_ip')).toBe('1.2.3.4');
        });

        it('should return cached IP without fetching', async () => {
            sessionStorage.setItem('hhr_audit_user_ip', '5.6.7.8');

            const ip = await fetchAndCacheIpAddress();
            expect(ip).toBe('5.6.7.8');
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should handle fetch errors gracefully', async () => {
            vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const ip = await fetchAndCacheIpAddress();
            expect(ip).toBeUndefined();
            warnSpy.mockRestore();
        });
    });
});
