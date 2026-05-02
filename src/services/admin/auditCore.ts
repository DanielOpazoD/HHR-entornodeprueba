import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import type { QueryOptions } from '@/services/infrastructure/db/types';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry, maskRut } from '@/types/auditLogTypes';
import {
  getAuditLogs as getIndexedDBAuditLogs,
  getAuditLogsForDate as getIndexedDBAuditLogsForDate,
  saveAuditLog,
} from '@/services/storage/indexeddb/indexedDbAuditLogService';
import {
  fetchAndCacheIpAddress,
  getCachedIpAddress,
  getCurrentUserDisplayName,
  getCurrentUserEmail,
  getCurrentUserUid,
} from './utils/auditUtils';
import { generateSummary } from './utils/auditSummaryGenerator';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { auditCoreLogger } from '@/services/admin/adminLoggers';
import {
  VIEW_THROTTLE_KEY,
  buildNextViewThrottleState,
  parseViewThrottleState,
  serializeViewThrottleState,
  shouldExcludeAuditEmail,
  shouldThrottleAuditViewAction,
  type ViewThrottleState,
} from '@/services/admin/auditViewThrottle';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

const COLLECTION_NAME = () => `hospitals/${getActiveHospitalId()}/auditLogs`;

export const shouldExcludeFromViewAudit = (): boolean => {
  const email = getCurrentUserEmail();
  return shouldExcludeAuditEmail(email);
};

const getViewThrottleState = (): ViewThrottleState => {
  if (typeof sessionStorage === 'undefined') return {};
  return parseViewThrottleState(sessionStorage.getItem(VIEW_THROTTLE_KEY));
};

const updateViewThrottleState = (action: string): void => {
  if (typeof sessionStorage === 'undefined') return;
  const nextState = buildNextViewThrottleState(
    action as AuditAction,
    getViewThrottleState(),
    new Date().toISOString()
  );
  sessionStorage.setItem(VIEW_THROTTLE_KEY, serializeViewThrottleState(nextState));
};

const shouldLogViewAction = (action: AuditAction): boolean => {
  return !shouldThrottleAuditViewAction(action, getViewThrottleState(), Date.now());
};

export const logThrottledViewEvent = async (
  action: AuditAction,
  entityId: string,
  details: Record<string, unknown>,
  recordDate?: string
): Promise<void> => {
  if (shouldExcludeFromViewAudit()) return;
  if (!shouldLogViewAction(action)) return;
  updateViewThrottleState(action);

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

const sanitizeDetails = (details: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (value instanceof Error) {
      sanitized[key] = {
        message: value.message,
        name: value.name,
        stack: value.stack,
        context: (value as { context?: unknown }).context,
      };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

interface AuditLocalStore {
  saveAuditLog: (entry: AuditLogEntry) => Promise<void>;
  getAuditLogs: (limitCount?: number | null) => Promise<AuditLogEntry[]>;
  getAuditLogsForDate: (date: string) => Promise<AuditLogEntry[]>;
}

interface AuditRuntimeSyncPolicy {
  shouldUseRemoteAuditSync: () => boolean;
}

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
  ) => Promise<void>;
  getAuditLogs: (limitCount?: number | null) => Promise<AuditLogEntry[]>;
  getAuditLogsForDate: (date: string) => Promise<AuditLogEntry[]>;
  logUserLogin: (email: string) => Promise<void>;
  logUserLogout: (email: string, reason?: 'manual' | 'automatic') => Promise<void>;
  logSystemError: (
    message: string,
    severity: 'medium' | 'high' | 'critical',
    details: Record<string, unknown>
  ) => Promise<void>;
}

const defaultAuditLocalStore: AuditLocalStore = {
  saveAuditLog,
  getAuditLogs: getIndexedDBAuditLogs,
  getAuditLogsForDate: getIndexedDBAuditLogsForDate,
};

const defaultAuditRuntimeSyncPolicy: AuditRuntimeSyncPolicy = {
  shouldUseRemoteAuditSync: isFirestoreEnabled,
};

const isPermissionDeniedAuditError = (error: unknown): boolean => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code || '')
      : '';

  return code.includes('permission-denied');
};

export const createAuditCoreService = (
  database: Pick<IDatabaseProvider, 'setDoc' | 'getDocs'> = firestoreDb,
  localStore: AuditLocalStore = defaultAuditLocalStore,
  syncPolicy: AuditRuntimeSyncPolicy = defaultAuditRuntimeSyncPolicy
): AuditCoreService => {
  const storeLocally = async (entry: AuditLogEntry): Promise<void> => {
    try {
      await localStore.saveAuditLog(entry);
    } catch (error) {
      auditCoreLogger.error('Failed to store audit log in IndexedDB', error);
    }
  };

  const logAuditEventToFirestore = async (entry: AuditLogEntry): Promise<void> => {
    if (!syncPolicy.shouldUseRemoteAuditSync()) {
      return;
    }

    try {
      await database.setDoc(COLLECTION_NAME(), entry.id, entry);
    } catch (error) {
      if (isPermissionDeniedAuditError(error)) {
        auditCoreLogger.warn(
          'Audit log persisted locally only because Firestore rejected the remote append',
          {
            action: entry.action,
            entryId: entry.id,
            code: (error as { code?: string }).code || 'permission-denied',
          }
        );
        return;
      }

      auditCoreLogger.error('Failed to save audit log to Firestore', error);
    }
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
  ): Promise<void> => {
    const entry: AuditLogEntry = {
      id: generateAuditId(),
      timestamp: new Date().toISOString(),
      userId,
      userDisplayName: getCurrentUserDisplayName(),
      userUid: getCurrentUserUid(),
      ipAddress: getCachedIpAddress(),
      action,
      entityType,
      entityId,
      summary: generateSummary(action, details, entityId),
      details: sanitizeDetails(details),
      patientIdentifier: patientRut ? maskRut(patientRut) : undefined,
      recordDate,
      authors,
    };

    storeLocally(entry);
    await logAuditEventToFirestore(entry);
  };

  return {
    logAuditEvent,
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
    getAuditLogsForDate: async (date: string): Promise<AuditLogEntry[]> => {
      if (!syncPolicy.shouldUseRemoteAuditSync()) {
        return await localStore.getAuditLogsForDate(date);
      }

      try {
        return await database.getDocs<AuditLogEntry>(COLLECTION_NAME(), {
          where: [{ field: 'recordDate', operator: '==', value: date }],
          orderBy: [{ field: 'timestamp', direction: 'desc' }],
        });
      } catch (error) {
        auditCoreLogger.error('Failed to fetch audit logs for date', error);
        return await localStore.getAuditLogsForDate(date);
      }
    },
    logUserLogin: async (email: string): Promise<void> => {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('hhr_session_start', new Date().toISOString());
      }

      fetchAndCacheIpAddress().catch((error: unknown) => {
        // Non-blocking: IP is best-effort for audit enrichment
        if (import.meta.env.DEV) {
          auditCoreLogger.warn('IP address fetch failed (non-blocking)', error);
        }
      });

      return logAuditEvent(email, 'USER_LOGIN', 'user', email, { event: 'login' });
    },
    logUserLogout: (email: string, reason: 'manual' | 'automatic' = 'manual'): Promise<void> => {
      let durationSec = 0;
      if (typeof sessionStorage !== 'undefined') {
        const start = sessionStorage.getItem('hhr_session_start');
        if (start) {
          durationSec = Math.floor((new Date().getTime() - new Date(start).getTime()) / 1000);
          sessionStorage.removeItem('hhr_session_start');
        }
      }

      return logAuditEvent(email, 'USER_LOGOUT', 'user', email, {
        event: 'logout',
        reason,
        durationSeconds: durationSec,
        durationFormatted:
          durationSec > 0 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : 'Unknown',
      });
    },
    logSystemError: (
      message: string,
      severity: 'medium' | 'high' | 'critical',
      details: Record<string, unknown>
    ): Promise<void> => {
      const email = getCurrentUserEmail() || 'system';
      const errorId = `err_${Date.now()}`;

      return logAuditEvent(email, 'SYSTEM_ERROR', 'system', errorId, {
        message,
        severity,
        ...details,
      });
    },
  };
};

const defaultAuditCoreService = createAuditCoreService();

export const logAuditEvent: AuditCoreService['logAuditEvent'] = (...args) =>
  defaultAuditCoreService.logAuditEvent(...args);

export const getAuditLogs: AuditCoreService['getAuditLogs'] = limitCount =>
  defaultAuditCoreService.getAuditLogs(limitCount);

export const getAuditLogsForDate: AuditCoreService['getAuditLogsForDate'] = date =>
  defaultAuditCoreService.getAuditLogsForDate(date);

export const logUserLogin: AuditCoreService['logUserLogin'] = email =>
  defaultAuditCoreService.logUserLogin(email);

export const logUserLogout: AuditCoreService['logUserLogout'] = (email, reason) =>
  defaultAuditCoreService.logUserLogout(email, reason);

export const logSystemError: AuditCoreService['logSystemError'] = (message, severity, details) =>
  defaultAuditCoreService.logSystemError(message, severity, details);
