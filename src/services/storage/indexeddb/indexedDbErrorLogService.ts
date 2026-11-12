import { getStoredSessionOwnerKey } from '../sessionOwnerKey';
import { getSessionEpoch } from '../sessionStorageTransition';
import { ErrorLog } from '@/services/logging/errorLogTypes';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveErrorLog = async (log: ErrorLog): Promise<void> => {
  const storedLog = { ...log, localOwnerKey: getStoredSessionOwnerKey() };
  try {
    await ensureDbReady();
    await db.errorLogs.add(storedLog);
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
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  try {
    await ensureDbReady();
    if (!owner) return [];
    const logs = await db.errorLogs
      .orderBy('timestamp')
      .reverse()
      .filter(log => 'localOwnerKey' in log && log.localOwnerKey === owner)
      .limit(limit)
      .toArray();
    if (epoch !== getSessionEpoch() || owner !== getStoredSessionOwnerKey()) {
      throw new Error('La sesión cambió durante la lectura de errores locales.');
    }
    return logs;
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
