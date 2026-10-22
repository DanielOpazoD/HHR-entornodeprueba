import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import type { QueryOptions } from '@/services/infrastructure/db/types';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry, maskRut } from '@/types/auditLogTypes';
import {
  getAuditLogs as getIndexedDBAuditLogs,
  getAuditLogsForDate as getIndexedDBAuditLogsForDate,
  getAuditLogsInRange as getIndexedDBAuditLogsInRange,
  saveAuditLog,
} from '@/services/storage/indexeddb/indexedDbAuditLogService';
import {
  getCachedIpAddress,
  getCurrentAuditSession,
  getCurrentUserEmail,
  isAuditSessionActor,
} from './utils/auditUtils';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { auditCoreLogger } from '@/services/admin/adminLoggers';
import {
  VIEW_THROTTLE_KEY,
  buildNextViewThrottleState,
  parseViewThrottleState,
  serializeViewThrottleState,
  shouldExcludeAuditEmail,
  shouldThrottleAuditViewAction,
  VIEW_THROTTLE_WINDOW_MS,
} from '@/services/admin/auditViewThrottle';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { compactAuditDetails } from '@/services/admin/auditDetailsCompaction';
import { resolveAuditConnectionId } from '@/services/admin/auditSession/auditConnectionTracker';
import { resolveAuditDeviceLabel } from '@/services/admin/auditSession/auditDeviceLabel';
import { AUDIT_SCHEMA_VERSION } from '@/services/admin/auditSession/auditConnectionEntries';
import {
  markAuditConnectionEntrySent,
  readAuditConnectionOutbox,
  settleAuditConnectionEntry,
  type AuditConnectionOutboxStorage,
} from '@/services/admin/auditSession/auditConnectionOutbox';

const COLLECTION_NAME = () => `hospitals/${getActiveHospitalId()}/auditLogs`;

export const shouldExcludeFromViewAudit = (): boolean => {
  const email = getCurrentUserEmail();
  return shouldExcludeAuditEmail(email);
};

const readSessionStorage = (key: string): string | null =>
  typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);

/** One read per patient and screen inside the throttle window. */
export const logThrottledViewEvent = async (
  action: AuditAction,
  entityId: string,
  details: Record<string, unknown>,
  recordDate?: string
): Promise<void> => {
  if (shouldExcludeFromViewAudit()) return;
  // Document, name and bed: a newborn may carry the mother's document but is another patient.
  const subject = [details.rut, details.patientName, entityId].filter(Boolean).join('|');
  const state = parseViewThrottleState(readSessionStorage(VIEW_THROTTLE_KEY));
  if (shouldThrottleAuditViewAction(action, state, Date.now(), VIEW_THROTTLE_WINDOW_MS, subject)) {
    return;
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(
      VIEW_THROTTLE_KEY,
      serializeViewThrottleState(
        buildNextViewThrottleState(action, state, new Date().toISOString(), subject)
      )
    );
  }

  await logAuditEvent(
    getCurrentUserEmail(),
    action,
    'patient',
    entityId,
    details,
    undefined,
    recordDate
  );
};

const generateAuditId = (): string =>
  `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

interface AuditLocalStore {
  saveAuditLog: (entry: AuditLogEntry) => Promise<void>;
  getAuditLogs: (limitCount?: number | null) => Promise<AuditLogEntry[]>;
  getAuditLogsForDate: (date: string) => Promise<AuditLogEntry[]>;
  getAuditLogsInRange: (range: AuditLogRange) => Promise<AuditLogEntry[]>;
}

interface AuditRuntimeSyncPolicy {
  shouldUseRemoteAuditSync: () => boolean;
}

/** Device facts stamped on every event. */
interface AuditDeviceEnvironment {
  connectionStorage: () => AuditConnectionOutboxStorage | undefined;
  userAgent: () => string | undefined;
}

export interface AuditLogRange {
  fromIso: string;
  toIso: string;
  limit: number;
}

/**
 * `stored`: Firestore holds the event (or queues it in its offline cache). `local`: remote audit
 * sync is off (no Firestore, or the device is offline) and only this device keeps it.
 */
export type AuditWriteDelivery = 'stored' | 'local' | 'rejected' | 'failed';

export interface AuditCoreService {
  logAuditEvent: (
    userId: string,
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => Promise<AuditWriteDelivery>;
  getAuditLogs: (limitCount?: number | null) => Promise<AuditLogEntry[]>;
  getAuditLogsForDate: (date: string) => Promise<AuditLogEntry[]>;
  /** Events of `[fromIso, toIso)`, newest first. Remote failures are reported, not hidden. */
  getAuditLogsInRange: (range: AuditLogRange) => Promise<AuditLogEntry[]>;
  /** Specific events by document id (e.g. connection starts and ends); missing ids are skipped. */
  getAuditLogsByIds: (ids: string[]) => Promise<AuditLogEntry[]>;
  /** Delivers queued connection events; only call it while a user is signed in. */
  flushAuditConnectionOutbox: () => Promise<void>;
  /** Writes a connection event directly when the device could not queue it. */
  writeAuditConnectionEntry: (entry: AuditLogEntry) => Promise<void>;
}

const defaultAuditLocalStore: AuditLocalStore = {
  saveAuditLog,
  getAuditLogs: getIndexedDBAuditLogs,
  getAuditLogsForDate: getIndexedDBAuditLogsForDate,
  getAuditLogsInRange: getIndexedDBAuditLogsInRange,
};

const defaultAuditRuntimeSyncPolicy: AuditRuntimeSyncPolicy = {
  shouldUseRemoteAuditSync: isFirestoreEnabled,
};

const defaultAuditDeviceEnvironment: AuditDeviceEnvironment = {
  connectionStorage: () => (typeof localStorage === 'undefined' ? undefined : localStorage),
  userAgent: () => (typeof navigator === 'undefined' ? undefined : navigator.userAgent),
};

const isPermissionDeniedAuditError = (error: unknown): boolean => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code || '')
      : '';

  return code.includes('permission-denied');
};

const sortAuditLogsByNewestTimestamp = (logs: AuditLogEntry[]): AuditLogEntry[] =>
  [...logs].sort((a, b) => {
    const aTime = Date.parse(a.timestamp || '');
    const bTime = Date.parse(b.timestamp || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

export const createAuditCoreService = (
  database: Pick<IDatabaseProvider, 'setDoc' | 'getDocs' | 'getDoc'> = firestoreDb,
  localStore: AuditLocalStore = defaultAuditLocalStore,
  syncPolicy: AuditRuntimeSyncPolicy = defaultAuditRuntimeSyncPolicy,
  device: AuditDeviceEnvironment = defaultAuditDeviceEnvironment
): AuditCoreService => {
  const storeLocally = async (entry: AuditLogEntry): Promise<boolean> => {
    try {
      await localStore.saveAuditLog(entry);
      return true;
    } catch (error) {
      auditCoreLogger.error('Failed to store audit log in IndexedDB', error);
      return false;
    }
  };

  const writeRemote = async (
    entry: AuditLogEntry
  ): Promise<Exclude<AuditWriteDelivery, 'local'>> => {
    try {
      await database.setDoc(COLLECTION_NAME(), entry.id, entry);
      return 'stored';
    } catch (error) {
      if (isPermissionDeniedAuditError(error)) {
        auditCoreLogger.warn('Firestore rejected the audit append', {
          action: entry.action,
          entryId: entry.id,
          code: (error as { code?: string }).code || 'permission-denied',
        });
        return 'rejected';
      }
      auditCoreLogger.error('Failed to save audit log to Firestore', error);
      return 'failed';
    }
  };

  // The browser keeps a local copy only when there is no Firestore to hold the trail; with
  // Firestore its offline cache already queues the write.
  const persist = async (entry: AuditLogEntry): Promise<AuditWriteDelivery> => {
    if (!syncPolicy.shouldUseRemoteAuditSync()) {
      return (await storeLocally(entry)) ? 'local' : 'failed';
    }
    return writeRemote(entry);
  };

  const logAuditEvent: AuditCoreService['logAuditEvent'] = async (
    userId,
    action,
    entityType,
    entityId,
    details,
    patientRut,
    recordDate,
    authors
  ): Promise<AuditWriteDelivery> => {
    // Only the signed-in user writes events, and only in their own name: an action whose author
    // is no longer signed in here (session ended or replaced) is never recorded under the next
    // person. The rules refuse such a write too (canCreateOwnAuditLogEntry).
    const session = getCurrentAuditSession();
    if (!session || !isAuditSessionActor(userId, session)) {
      auditCoreLogger.warn('Audit event not written: its author is not the signed-in user', {
        action,
        entityType,
        entityId,
      });
      return 'rejected';
    }
    const userUid = session.uid;
    const storage = device.connectionStorage();
    const withDocument = patientRut && !details.rut ? { ...details, rut: patientRut } : details;

    const delivery = await persist({
      id: generateAuditId(),
      timestamp: new Date().toISOString(),
      schemaVersion: AUDIT_SCHEMA_VERSION,
      userId: session.email ?? session.uid,
      userDisplayName: session.displayName,
      userUid,
      ipAddress: getCachedIpAddress(),
      action,
      entityType,
      entityId,
      details: compactAuditDetails(withDocument),
      patientIdentifier: patientRut ? maskRut(patientRut) : undefined,
      recordDate,
      authors,
      sessionId: storage ? resolveAuditConnectionId(storage, userUid) : undefined,
      device: resolveAuditDeviceLabel(device.userAgent()),
    });
    return delivery;
  };

  /**
   * The audit collection is create-only, so a refusal is ambiguous: a repeat of an event that
   * already landed, or an account that may not write. Only an earlier attempt that never settled
   * (`sentAt` still set, e.g. the page closed mid-write) lets a refusal count as a duplicate;
   * otherwise the event stays for the next person who signs in on this device.
   */
  const deliverQueued = async (storage: AuditConnectionOutboxStorage): Promise<void> => {
    // Only Firestore delivers: with remote sync off, a local copy would empty the queue for good.
    if (!syncPolicy.shouldUseRemoteAuditSync()) return;
    const authorUid = getCurrentAuditSession()?.uid;
    for (const item of readAuditConnectionOutbox(storage)) {
      // Each event is written by its own author's session; another person's waits for theirs.
      if (!authorUid || item.entry.userUid !== authorUid) continue;
      const landedBefore = item.sentAt !== undefined;
      markAuditConnectionEntrySent(storage, item.entry.id, Date.now());
      const delivery = await writeRemote(item.entry);
      settleAuditConnectionEntry(
        storage,
        item.entry.id,
        delivery === 'rejected' && landedBefore ? 'duplicate' : delivery
      );
    }
  };

  let flushing: Promise<void> | null = null;
  const flushAuditConnectionOutbox: AuditCoreService['flushAuditConnectionOutbox'] = () => {
    const storage = device.connectionStorage();
    if (!storage) return Promise.resolve();
    // One delivery at a time: offline writes stay pending instead of piling up per heartbeat.
    flushing ??= deliverQueued(storage).finally(() => {
      flushing = null;
    });
    return flushing;
  };

  return {
    logAuditEvent,
    flushAuditConnectionOutbox,
    writeAuditConnectionEntry: async entry => {
      await persist(entry);
    },
    getAuditLogs: async (limitCount?: number | null): Promise<AuditLogEntry[]> => {
      if (!syncPolicy.shouldUseRemoteAuditSync()) {
        return await localStore.getAuditLogs(limitCount);
      }

      try {
        const queryOptions: QueryOptions = {
          orderBy: [{ field: 'timestamp', direction: 'desc' }],
        };
        if (typeof limitCount === 'number') {
          queryOptions.limit = limitCount;
        }

        return await database.getDocs<AuditLogEntry>(COLLECTION_NAME(), queryOptions);
      } catch (error) {
        auditCoreLogger.error('Failed to fetch audit logs from Firestore', error);
        return await localStore.getAuditLogs(limitCount);
      }
    },
    getAuditLogsByIds: async (ids: string[]): Promise<AuditLogEntry[]> => {
      if (!syncPolicy.shouldUseRemoteAuditSync() || ids.length === 0) return [];
      // One unreadable id must not hide the others.
      const found = await Promise.allSettled(
        ids.map(id => database.getDoc<AuditLogEntry>(COLLECTION_NAME(), id))
      );
      return found.flatMap(result =>
        result.status === 'fulfilled' && result.value !== null ? [result.value] : []
      );
    },
    getAuditLogsInRange: async (range: AuditLogRange): Promise<AuditLogEntry[]> => {
      if (!syncPolicy.shouldUseRemoteAuditSync()) {
        return await localStore.getAuditLogsInRange(range);
      }
      return await database.getDocs<AuditLogEntry>(COLLECTION_NAME(), {
        where: [
          { field: 'timestamp', operator: '>=', value: range.fromIso },
          { field: 'timestamp', operator: '<', value: range.toIso },
        ],
        orderBy: [{ field: 'timestamp', direction: 'desc' }],
        limit: range.limit,
      });
    },
    getAuditLogsForDate: async (date: string): Promise<AuditLogEntry[]> => {
      if (!syncPolicy.shouldUseRemoteAuditSync()) {
        return await localStore.getAuditLogsForDate(date);
      }

      try {
        const logs = await database.getDocs<AuditLogEntry>(COLLECTION_NAME(), {
          where: [{ field: 'recordDate', operator: '==', value: date }],
        });
        return sortAuditLogsByNewestTimestamp(logs);
      } catch (error) {
        auditCoreLogger.error('Failed to fetch audit logs for date', error);
        return await localStore.getAuditLogsForDate(date);
      }
    },
  };
};

const defaultAuditCoreService = createAuditCoreService();

export const logAuditEvent: AuditCoreService['logAuditEvent'] = (...args) =>
  defaultAuditCoreService.logAuditEvent(...args);

export const getAuditLogs: AuditCoreService['getAuditLogs'] = limitCount =>
  defaultAuditCoreService.getAuditLogs(limitCount);

export const getAuditLogsInRange: AuditCoreService['getAuditLogsInRange'] = range =>
  defaultAuditCoreService.getAuditLogsInRange(range);

export const getAuditLogsByIds: AuditCoreService['getAuditLogsByIds'] = ids =>
  defaultAuditCoreService.getAuditLogsByIds(ids);

export const getAuditLogsForDate: AuditCoreService['getAuditLogsForDate'] = date =>
  defaultAuditCoreService.getAuditLogsForDate(date);

export const flushAuditConnectionOutbox: AuditCoreService['flushAuditConnectionOutbox'] = () =>
  defaultAuditCoreService.flushAuditConnectionOutbox();

export const writeAuditConnectionEntry: AuditCoreService['writeAuditConnectionEntry'] = entry =>
  defaultAuditCoreService.writeAuditConnectionEntry(entry);
