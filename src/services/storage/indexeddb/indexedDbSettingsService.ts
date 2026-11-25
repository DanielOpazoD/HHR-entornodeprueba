import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';

import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';

export const saveSetting = async (id: string, value: unknown): Promise<void> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      localPersistence.settings.save(id, value);
      return;
    }
    await db.settings.put({ id, value });
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_setting', error, {
      code: 'indexeddb_save_setting_failed',
      message: `No fue posible guardar la configuracion ${id}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible guardar una configuracion local.',
      context: { settingId: id },
    });
  }
};

export const getSetting = async <T>(id: string, defaultValue: T): Promise<T> => {
  try {
    await ensureDbReady();

    if (isDatabaseInFallbackMode()) {
      return localPersistence.settings.get(id, defaultValue);
    }

    const item = await db.settings.get(id);
    return item ? (item.value as T) : defaultValue;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      (error as { name?: string }).name !== 'DatabaseClosedError'
    ) {
      recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_setting', error, {
        code: 'indexeddb_get_setting_failed',
        message: `No fue posible obtener la configuracion ${id}.`,
        severity: 'warning',
        userSafeMessage: 'No fue posible recuperar una configuracion local.',
        context: { settingId: id },
      });
    }
    return defaultValue;
  }
};
