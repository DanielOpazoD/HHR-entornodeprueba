import { safeJsonParse } from '@/utils/jsonUtils';
import { ROLE_CACHE_PREFIX, normalizeEmail } from '@/services/auth/authShared';
import { authRoleCacheLogger } from '@/services/auth/authLoggers';

type CachedRole = { role: string; timestamp: number };

const ROLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const loadSettings = () => import('@/services/storage/indexeddb/indexedDbSettingsService');

const clearLegacyRoleCache = (key: string): void => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(key);
  }
};

const getRoleCacheKey = (email: string): string => `${ROLE_CACHE_PREFIX}${normalizeEmail(email)}`;

export const clearRoleCacheForEmail = async (email: string): Promise<void> => {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return;
  const key = getRoleCacheKey(cleanEmail);
  const { saveSetting } = await loadSettings();
  await saveSetting(key, null);
  clearLegacyRoleCache(key);
};

export const saveRoleToCache = async (email: string, role: string): Promise<void> => {
  try {
    const key = getRoleCacheKey(email);
    const cacheData: CachedRole = { role, timestamp: Date.now() };
    const { saveSetting } = await loadSettings();
    await saveSetting(key, cacheData);
    clearLegacyRoleCache(key);
  } catch (error) {
    authRoleCacheLogger.warn('Failed to cache role', error);
  }
};

export const getCachedRole = async (email: string): Promise<string | null> => {
  try {
    const key = getRoleCacheKey(email);
    const { getSetting } = await loadSettings();
    let cached = await getSetting<CachedRole | null>(key, null);

    if (!cached && typeof window !== 'undefined' && window.localStorage) {
      const legacy = window.localStorage.getItem(key);
      if (legacy) {
        cached = safeJsonParse<CachedRole | null>(legacy, null);
      }
    }

    if (!cached) return null;
    if (Date.now() - cached.timestamp < ROLE_CACHE_TTL_MS) {
      return cached.role;
    }
  } catch (error) {
    authRoleCacheLogger.warn('Failed to read role cache', error);
  }

  return null;
};
