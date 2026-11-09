/**
 * Second opinion before a permission storm ends the session. Loaded on demand: a storm is rare
 * and the authenticated shell has no room for it.
 *
 * Seen on 11-09: a valid account (claims, rules and access document unchanged) lost two sessions
 * to storms, and signing in again worked a minute later. A fresh ID token plus one server read
 * that every authorized role may do tells a transient denial from a real permission loss.
 */
import { doc, getDocFromServer } from 'firebase/firestore';
import {
  COLLECTIONS,
  getActiveHospitalId,
  HOSPITAL_COLLECTIONS,
  SETTINGS_DOCS,
} from '@/constants/firestorePaths';
import { defaultAuthRuntime, type AuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

export type SessionPermissionProbeOutcome = 'readable' | 'denied' | 'timeout' | 'failed';

export const SESSION_PERMISSION_PROBE_TIMEOUT_MS = 5_000;
/** A recovery reload that is followed by another storm is not transient: log out instead. */
export const SESSION_PERMISSION_RECOVERY_COOLDOWN_MS = 10 * 60_000;
const RECOVERY_RELOAD_KEY = 'hhr.sessionPermissionRecoveryReloadAt';

const isDenial = (error: unknown): boolean => {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  return code.includes('permission-denied') || code.includes('unauthenticated');
};

export const probeSessionReadPermission = async ({
  authRuntime = defaultAuthRuntime,
  firestoreRuntime = defaultFirestoreServiceRuntime,
  timeoutMs = SESSION_PERMISSION_PROBE_TIMEOUT_MS,
}: {
  authRuntime?: Pick<AuthRuntime, 'getCurrentUser'>;
  firestoreRuntime?: Pick<FirestoreServiceRuntimePort, 'getDb'>;
  timeoutMs?: number;
} = {}): Promise<SessionPermissionProbeOutcome> => {
  const user = authRuntime.getCurrentUser();
  if (!user) return 'denied';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const probe = (async (): Promise<SessionPermissionProbeOutcome> => {
    try {
      await user.getIdToken(true);
      // From the server: a cached copy would read fine even if the rules now refuse the session.
      await getDocFromServer(
        doc(
          firestoreRuntime.getDb(),
          COLLECTIONS.HOSPITALS,
          getActiveHospitalId(),
          HOSPITAL_COLLECTIONS.SETTINGS,
          SETTINGS_DOCS.NURSES
        )
      );
      return 'readable';
    } catch (error) {
      return isDenial(error) ? 'denied' : 'failed';
    }
  })();
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const readSessionStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** True when this tab already reloaded to recover from a storm within the cooldown. */
export const hasRecentRecoveryReload = (now: number = Date.now()): boolean => {
  try {
    const at = Number(readSessionStorage()?.getItem(RECOVERY_RELOAD_KEY));
    return Number.isFinite(at) && at > 0 && now - at < SESSION_PERMISSION_RECOVERY_COOLDOWN_MS;
  } catch {
    return false;
  }
};

/** Marks the reload; if storage is unavailable no reload may happen, so the caller logs out. */
export const markRecoveryReload = (now: number = Date.now()): boolean => {
  try {
    const storage = readSessionStorage();
    if (!storage) return false;
    storage.setItem(RECOVERY_RELOAD_KEY, String(now));
    return storage.getItem(RECOVERY_RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
};
