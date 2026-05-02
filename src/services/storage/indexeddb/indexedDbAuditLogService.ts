import { AuditLogEntry } from '@/types/auditLogTypes';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveAuditLog = async (log: AuditLogEntry): Promise<void> => {
  try {
    await ensureDbReady();
    await db.auditLogs.put(log);
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_audit_log', error, {
      code: 'indexeddb_save_audit_log_failed',
      message: 'No fue posible guardar el log de auditoria local.',
      severity: 'warning',
      userSafeMessage: 'No fue posible guardar el log de auditoria local.',
      context: { logId: log.id, action: log.action },
    });
  }
};

export const getAuditLogs = async (limitCount?: number | null): Promise<AuditLogEntry[]> => {
  try {
    await ensureDbReady();
    const orderedLogs = db.auditLogs.orderBy('timestamp').reverse();
    if (typeof limitCount === 'number') {
      return await orderedLogs.limit(limitCount).toArray();
    }

    return await orderedLogs.toArray();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_audit_logs', error, {
      code: 'indexeddb_get_audit_logs_failed',
      message: 'No fue posible recuperar logs de auditoria locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar logs de auditoria locales.',
      context: { limitCount },
    });
    return [];
  }
};

export const clearAuditLogs = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.auditLogs.clear();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_audit_logs', error, {
      code: 'indexeddb_clear_audit_logs_failed',
      message: 'No fue posible limpiar logs de auditoria locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar logs de auditoria locales.',
    });
  }
};

export const getAuditLogsForDate = async (date: string): Promise<AuditLogEntry[]> => {
  try {
    await ensureDbReady();
    return await db.auditLogs.where('recordDate').equals(date).toArray();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_audit_logs_for_date', error, {
      code: 'indexeddb_get_audit_logs_for_date_failed',
      message: `No fue posible recuperar logs de auditoria para ${date}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar logs de auditoria del dia solicitado.',
      context: { date },
    });
    return [];
  }
};
