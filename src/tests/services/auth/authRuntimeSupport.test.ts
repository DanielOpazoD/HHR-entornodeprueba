import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSetting, mockSaveSetting, mockLoggerWarn } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSaveSetting: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbSettingsService', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  saveSetting: (...args: unknown[]) => mockSaveSetting(...args),
}));

vi.mock('@/services/utils/loggerService', () => ({
  logger: {
    child: () => ({
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
    }),
  },
}));

import {
  clearRecentManualLogout,
  hasRecentManualLogout,
  markRecentManualLogout,
} from '@/services/auth/authLogoutState';
import {
  AUTH_BOOTSTRAP_TIMEOUTS_MS,
  resolveAuthBootstrapBudget,
} from '@/services/auth/authBootstrapBudgets';
import { mountFirebaseConfigWarning } from '@/services/auth/firebaseStartupWarningRenderer';
import {
  clearRoleCacheForEmail,
  getCachedRole,
  saveRoleToCache,
} from '@/services/auth/authRoleCache';
import {
  clearGoogleLoginAttemptHint,
  clearRecentAuthenticatedSessionHint,
  hasRecentGoogleLoginAttemptHint,
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
  markGoogleLoginAttemptHint,
} from '@/services/auth/authStorageHints';
import { ROLE_CACHE_PREFIX, normalizeEmail } from '@/services/auth/authShared';

describe('authRuntimeSupport', () => {
  const fixedCacheTimestamp = Date.parse('2026-03-22T20:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    mockGetSetting.mockResolvedValue(null);
    mockSaveSetting.mockResolvedValue(undefined);
  });

  it('tracks recent manual logout state and expires stale entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T20:00:00.000Z'));

    markRecentManualLogout();
    expect(hasRecentManualLogout()).toBe(true);

    vi.setSystemTime(new Date('2026-03-22T20:03:00.000Z'));
    expect(hasRecentManualLogout()).toBe(false);

    markRecentManualLogout();
    clearRecentManualLogout();
    expect(hasRecentManualLogout()).toBe(false);
  });

  it('treats blocked session storage as an unavailable logout hint', () => {
    const storageGetter = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });

    expect(() => markRecentManualLogout()).not.toThrow();
    expect(hasRecentManualLogout()).toBe(false);
    expect(() => clearRecentManualLogout()).not.toThrow();

    storageGetter.mockRestore();
  });

  it('mounts the Firebase startup warning in the root element with highlighted env vars', () => {
    mountFirebaseConfigWarning('firebase warning', {
      title: 'Config pendiente',
      summary: 'Hay variables faltantes.',
      steps: [
        'Configura VITE_FIREBASE_API_KEY y VITE_FIREBASE_PROJECT_ID.',
        'Revisa VITE_FIREBASE_AUTH_DOMAIN.',
      ],
      footnote: 'Sin esto la app no inicia.',
    });

    expect(mockLoggerWarn).toHaveBeenCalledWith('firebase warning');
    expect(document.getElementById('root')?.innerHTML).toContain(
      '<code>VITE_FIREBASE_API_KEY</code>'
    );
    expect(document.getElementById('root')?.innerHTML).toContain(
      '<code>VITE_FIREBASE_PROJECT_ID</code>'
    );
  });

  it('resolves bootstrap budgets with the intended precedence', () => {
    expect(
      resolveAuthBootstrapBudget({
        hasRecentManualLogout: true,
        isOnline: false,
        hasPendingRedirect: true,
      })
    ).toEqual({
      profile: 'recent_manual_logout',
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUTS_MS.recentManualLogout,
    });

    expect(
      resolveAuthBootstrapBudget({
        hasRecentManualLogout: false,
        isOnline: false,
        hasPendingRedirect: true,
      })
    ).toEqual({
      profile: 'offline',
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUTS_MS.offline,
    });

    expect(
      resolveAuthBootstrapBudget({
        hasRecentManualLogout: false,
        isOnline: true,
        hasPendingRedirect: true,
      })
    ).toEqual({
      profile: 'redirect_pending',
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUTS_MS.redirectPending,
    });

    expect(
      resolveAuthBootstrapBudget({
        hasRecentManualLogout: false,
        isOnline: true,
        hasPendingRedirect: false,
      })
    ).toEqual({
      profile: 'default',
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUTS_MS.default,
    });
  });

  it('reads, writes and clears cached roles across IndexedDB and legacy localStorage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedCacheTimestamp));

    const email = 'Doctor@Hospital.cl';
    const cacheKey = `${ROLE_CACHE_PREFIX}${normalizeEmail(email)}`;

    await saveRoleToCache(email, 'doctor');
    expect(mockSaveSetting).toHaveBeenCalledWith(
      cacheKey,
      expect.objectContaining({
        role: 'doctor',
        timestamp: expect.any(Number),
      })
    );

    mockGetSetting.mockResolvedValueOnce({
      role: 'doctor',
      timestamp: fixedCacheTimestamp,
    });
    await expect(getCachedRole(email)).resolves.toBe('doctor');

    mockGetSetting.mockResolvedValueOnce(null);
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        role: 'viewer',
        timestamp: fixedCacheTimestamp,
      })
    );
    await expect(getCachedRole(email)).resolves.toBe('viewer');

    mockGetSetting.mockResolvedValueOnce({
      role: 'stale',
      timestamp: fixedCacheTimestamp - 8 * 24 * 60 * 60 * 1000,
    });
    await expect(getCachedRole(email)).resolves.toBeNull();

    await clearRoleCacheForEmail(email);
    expect(mockSaveSetting).toHaveBeenLastCalledWith(cacheKey, null);

    vi.useRealTimers();
  });

  it('degrades role cache failures without throwing', async () => {
    mockSaveSetting.mockRejectedValueOnce(new Error('write failed'));
    await expect(saveRoleToCache('user@hospital.cl', 'doctor')).resolves.toBeUndefined();

    mockGetSetting.mockRejectedValueOnce(new Error('read failed'));
    await expect(getCachedRole('user@hospital.cl')).resolves.toBeNull();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(2);
  });

  it('detects persisted Firebase auth hints in localStorage and sessionStorage', () => {
    expect(hasPersistedFirebaseAuthHint()).toBe(false);

    window.localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');
    expect(hasPersistedFirebaseAuthHint()).toBe(true);

    window.localStorage.removeItem('firebase:authUser:test:[DEFAULT]');
    window.sessionStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"abc"}');
    expect(hasPersistedFirebaseAuthHint()).toBe(true);
  });

  it('detects the app session hint for authenticated same-tab refreshes', () => {
    expect(hasRecentAuthenticatedSessionHint()).toBe(false);

    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    expect(hasRecentAuthenticatedSessionHint()).toBe(true);

    clearRecentAuthenticatedSessionHint();
    expect(hasRecentAuthenticatedSessionHint()).toBe(false);
  });

  it('tracks a short-lived Google login attempt hint without storing user data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T20:00:00.000Z'));

    expect(hasRecentGoogleLoginAttemptHint()).toBe(false);

    markGoogleLoginAttemptHint();
    expect(hasRecentGoogleLoginAttemptHint()).toBe(true);

    vi.setSystemTime(new Date('2026-03-22T20:03:00.000Z'));
    expect(hasRecentGoogleLoginAttemptHint()).toBe(false);

    markGoogleLoginAttemptHint();
    clearGoogleLoginAttemptHint();
    expect(hasRecentGoogleLoginAttemptHint()).toBe(false);
  });
});
