/**
 * Audit Utilities
 * Handles user identification and IP address tracking for audit logs.
 */

import { auditUtilsLogger } from '@/services/admin/adminLoggers';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';

// ============================================================================
// User Identification
// ============================================================================

const USER_EMAIL_CACHE_KEY = 'hhr_audit_user_email_cache';

const resolveCurrentUser = () => defaultAuthRuntime.getCurrentUser();

const getLocalStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const getSessionStorage = (): Storage | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

const safeStorageGet = (storage: Storage | undefined, key: string): string | null => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageSet = (storage: Storage | undefined, key: string, value: string): void => {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Storage may be unavailable or full in hardened/private browsers.
  }
};

/**
 * Get current user email with robust fallbacks
 * Priority: auth.email → cached email → displayName → uid → anonymous
 */
export const getCurrentUserEmail = (): string => {
  try {
    const user = resolveCurrentUser();
    const browserStorage = getLocalStorage();

    if (user?.email) {
      safeStorageSet(browserStorage, USER_EMAIL_CACHE_KEY, user.email);
      return user.email;
    }

    const cached = safeStorageGet(browserStorage, USER_EMAIL_CACHE_KEY);
    if (cached) return cached;

    if (user?.displayName) return user.displayName;
    if (user?.uid) return user.uid;

    return 'anonymous_user';
  } catch (e) {
    auditUtilsLogger.warn('Failed to resolve current user info', e);
    return 'system_context';
  }
};

/**
 * Get user display name if available
 */
export interface AuditSessionIdentity {
  uid: string;
  email?: string;
  displayName?: string;
}

/** The signed-in Firebase user exactly as authenticated: no cached or fallback values. */
export const getCurrentAuditSession = (): AuditSessionIdentity | null => {
  try {
    const user = resolveCurrentUser();
    if (!user?.uid) return null;
    return {
      uid: user.uid,
      email: user.email || undefined,
      displayName: user.displayName || undefined,
    };
  } catch (_e) {
    return null;
  }
};

/** Whether `actor` (an email or a uid) names the signed-in user. */
export const isAuditSessionActor = (actor: string, session: AuditSessionIdentity): boolean =>
  actor === session.uid ||
  (Boolean(session.email) && actor.toLowerCase() === session.email?.toLowerCase());

/**
 * Get Firebase UID
 */
export const getCurrentUserUid = (): string | undefined => {
  try {
    return resolveCurrentUser()?.uid || undefined;
  } catch (_e) {
    return undefined;
  }
};

// ============================================================================
// IP Address Tracking
// ============================================================================

const IP_CACHE_KEY = 'hhr_audit_user_ip';
const IP_FETCH_TIMEOUT_MS = 5_000;
let ipFetchInProgress = false;

/**
 * Get user's IP address (cached in session)
 * Non-blocking - returns cached value or undefined
 */
export const getCachedIpAddress = (): string | undefined => {
  return safeStorageGet(getSessionStorage(), IP_CACHE_KEY) || undefined;
};

/**
 * Fetch and cache user's IP address (call once at login)
 */
export const fetchAndCacheIpAddress = async (): Promise<string | undefined> => {
  if (ipFetchInProgress) return undefined;

  const cached = getCachedIpAddress();
  if (cached) return cached;

  ipFetchInProgress = true;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), IP_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(
      'https://api.ipify.org?format=json',
      controller ? { signal: controller.signal } : undefined
    );
    if (response.ok === false) {
      return undefined;
    }
    const data = (await response.json()) as { ip?: unknown } | null;
    if (typeof data?.ip === 'string' && data.ip.trim().length > 0) {
      const resolvedIp = data.ip.trim();
      safeStorageSet(getSessionStorage(), IP_CACHE_KEY, resolvedIp);
      return resolvedIp;
    }
  } catch (e) {
    auditUtilsLogger.warn('Failed to fetch IP address', e);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    ipFetchInProgress = false;
  }
  return undefined;
};
