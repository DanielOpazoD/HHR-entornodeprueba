import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from 'firebase/auth';
import {
  formatAuditTimestamp,
  getCurrentUserEmail,
  getCurrentUserDisplayName,
  getCurrentUserUid,
  getCachedIpAddress,
  fetchAndCacheIpAddress,
} from '@/services/admin/utils/auditUtils';

const authRuntimeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: authRuntimeMocks,
}));

vi.mock('@/services/admin/adminLoggers', () => ({
  auditUtilsLogger: loggerMocks,
}));

// Mock fetch
global.fetch = vi.fn();

describe('auditUtils', () => {
  const setCurrentUser = (user: Partial<User> | null) => {
    authRuntimeMocks.getCurrentUser.mockReturnValue(user as User | null);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCurrentUserEmail', () => {
    it('should return user email when available', () => {
      setCurrentUser({ email: 'test@example.com' });

      expect(getCurrentUserEmail()).toBe('test@example.com');
    });

    it('should cache email in localStorage', () => {
      setCurrentUser({ email: 'cached@example.com' });

      getCurrentUserEmail();
      expect(localStorage.getItem('hhr_audit_user_email_cache')).toBe('cached@example.com');
    });

    it('should return cached email if no current user', () => {
      localStorage.setItem('hhr_audit_user_email_cache', 'cached@test.com');
      setCurrentUser({ email: null });

      expect(getCurrentUserEmail()).toBe('cached@test.com');
    });

    it('should return displayName if no email', () => {
      setCurrentUser({ email: null, displayName: 'Test User' });

      expect(getCurrentUserEmail()).toBe('Test User');
    });

    it('should resolve browser-independent identity when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      setCurrentUser({ email: null, displayName: 'Conflict Worker', uid: 'worker-uid' });

      expect(getCurrentUserEmail()).toBe('Conflict Worker');
      expect(loggerMocks.warn).not.toHaveBeenCalled();
    });

    it('should return uid as last resort', () => {
      setCurrentUser({ email: null, displayName: null, uid: 'user123' });

      expect(getCurrentUserEmail()).toBe('user123');
    });

    it('should return anonymous_user if no info available', () => {
      setCurrentUser(null);

      expect(getCurrentUserEmail()).toBe('anonymous_user');
    });

    it('should return system_context on error', () => {
      authRuntimeMocks.getCurrentUser.mockImplementation(() => {
        throw new Error('Auth error');
      });

      expect(getCurrentUserEmail()).toBe('system_context');
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'Failed to resolve current user info',
        expect.any(Error)
      );
    });
  });

  describe('getCurrentUserDisplayName', () => {
    it('should return display name', () => {
      setCurrentUser({ displayName: 'John Doe' });

      expect(getCurrentUserDisplayName()).toBe('John Doe');
    });

    it('should return undefined if no display name', () => {
      setCurrentUser({ displayName: null });

      expect(getCurrentUserDisplayName()).toBeUndefined();
    });

    it('should return undefined on error', () => {
      authRuntimeMocks.getCurrentUser.mockImplementation(() => {
        throw new Error('Error');
      });

      expect(getCurrentUserDisplayName()).toBeUndefined();
    });
  });

  describe('getCurrentUserUid', () => {
    it('should return UID', () => {
      setCurrentUser({ uid: 'uid123' });

      expect(getCurrentUserUid()).toBe('uid123');
    });

    it('should return undefined on error', () => {
      authRuntimeMocks.getCurrentUser.mockImplementation(() => {
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
        json: () => Promise.resolve({ ip: '1.2.3.4' }),
      } as unknown as Response);

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

      const ip = await fetchAndCacheIpAddress();
      expect(ip).toBeUndefined();
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'Failed to fetch IP address',
        expect.any(Error)
      );
    });
  });

  describe('formatAuditTimestamp', () => {
    it('should format valid timestamps and keep unknown ones defensive', () => {
      expect(formatAuditTimestamp('2026-03-17T10:30:00.000Z')).toContain('2026');
      expect(formatAuditTimestamp(null)).toBe('Fecha desconocida');
    });
  });
});
