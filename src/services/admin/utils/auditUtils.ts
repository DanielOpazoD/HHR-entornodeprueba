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

const getLocalStorage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/**
 * Get current user email with robust fallbacks
 * Priority: auth.email → cached email → displayName → uid → anonymous
 */
export const getCurrentUserEmail = (): string => {
  try {
    const user = resolveCurrentUser();
    const browserStorage = getLocalStorage();

    if (user?.email) {
      browserStorage?.setItem(USER_EMAIL_CACHE_KEY, user.email);
      return user.email;
    }

    const cached = browserStorage?.getItem(USER_EMAIL_CACHE_KEY);
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

export const getCurrentUserDisplayName = (): string | undefined => {
  try {
    return resolveCurrentUser()?.displayName || undefined;
  } catch (_e) {
    return undefined;
  }
};

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
let ipFetchInProgress = false;

/**
 * Get user's IP address (cached in session)
 * Non-blocking - returns cached value or undefined
 */
export const getCachedIpAddress = (): string | undefined => {
  return sessionStorage.getItem(IP_CACHE_KEY) || undefined;
};

/**
 * Fetch and cache user's IP address (call once at login)
 */
export const fetchAndCacheIpAddress = async (): Promise<string | undefined> => {
  if (ipFetchInProgress) return undefined;

  const cached = getCachedIpAddress();
  if (cached) return cached;

  ipFetchInProgress = true;
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    if (data.ip) {
      sessionStorage.setItem(IP_CACHE_KEY, data.ip);
      return data.ip;
    }
  } catch (e) {
    auditUtilsLogger.warn('Failed to fetch IP address', e);
  } finally {
    ipFetchInProgress = false;
  }
  return undefined;
};
