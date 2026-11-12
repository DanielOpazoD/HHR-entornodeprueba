import type { UserRole } from '@/types/authRoleTypes';
import { getSessionEpoch, getSessionOwner } from '../sessionStorageTransition';
import { ErrorLog } from '@/services/logging/errorLogTypes';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveErrorLog = async (log: ErrorLog): Promise<void> => {
  const storedLog = { ...log, localOwnerKey: getSessionOwner() };
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

export const getErrorLogs = async (limit = 50, role?: UserRole): Promise<ErrorLog[]> => {
  const owner = getSessionOwner();
  const epoch = getSessionEpoch();
  try {
    await ensureDbReady();
    if (!owner) return [];
    const logs = await db.errorLogs
      .orderBy('timestamp')
      .reverse()
      .filter(log => role === 'admin' || ('localOwnerKey' in log && log.localOwnerKey === owner))
      .limit(limit)
      .toArray();
    if (epoch !== getSessionEpoch() || owner !== getSessionOwner()) {
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

/** Clears exactly what `getErrorLogs` shows this person: the team's for an admin, otherwise their own. */
export const clearErrorLogs = async (role?: UserRole): Promise<void> => {
  const owner = getSessionOwner();
  try {
    await ensureDbReady();
    if (role === 'admin') await db.errorLogs.clear();
    else if (owner)
      await db.errorLogs
        .filter(log => 'localOwnerKey' in log && log.localOwnerKey === owner)
        .delete();
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
