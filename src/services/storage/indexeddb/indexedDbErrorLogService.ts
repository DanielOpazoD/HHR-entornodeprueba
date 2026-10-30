import { ErrorLog } from '@/services/logging/errorLogTypes';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveErrorLog = async (log: ErrorLog): Promise<void> => {
  try {
    await ensureDbReady();
    await db.errorLogs.add(log);
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_error_log', error, {
      code: 'indexeddb_save_error_log_failed',
      message: 'No fue posible guardar el log de errores local.',
      severity: 'warning',
      userSafeMessage: 'No fue posible guardar el log de errores local.',
      context: { logId: log.id, severity: log.severity },
    });
  }
};

export const getErrorLogs = async (limit = 50): Promise<ErrorLog[]> => {
  try {
    await ensureDbReady();
    return await db.errorLogs.orderBy('timestamp').reverse().limit(limit).toArray();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_error_logs', error, {
      code: 'indexeddb_get_error_logs_failed',
      message: 'No fue posible recuperar logs de errores locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar logs de errores locales.',
      context: { limit },
    });
    throw error;
  }
};

export const clearErrorLogs = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.errorLogs.clear();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_error_logs', error, {
      code: 'indexeddb_clear_error_logs_failed',
      message: 'No fue posible limpiar logs de errores locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar logs de errores locales.',
    });
    throw error;
  }
};
