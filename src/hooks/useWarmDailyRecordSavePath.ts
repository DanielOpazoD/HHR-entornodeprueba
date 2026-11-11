import { createSavePathRuntimeLoader } from '@/services/runtime/createSavePathRuntimeLoader';
import { useEffect } from 'react';
import { loadDailyRecordWriteService } from '@/application/ports/dailyRecordPort';
import { loadDailyRecordOutbox } from '@/services/storage/sync/dexieSyncQueueStore';
import { dailyRecordWriteLogger } from '@/services/repositories/repositoryLoggers';

export const loadDailyRecordSavePersistence = createSavePathRuntimeLoader(
  'save-controller',
  () => import('@/hooks/controllers/dailyRecordSavePersistenceController')
);

// Use the save path's loaders, including its transitive static imports, before editing.
export const warmDailyRecordSavePath = async (): Promise<boolean> => {
  try {
    await Promise.all([
      loadDailyRecordSavePersistence(),
      loadDailyRecordWriteService(),
      loadDailyRecordOutbox(),
      import('@/application/audit/writeAuditEventUseCase'),
    ]);
    return true;
  } catch {
    dailyRecordWriteLogger.warn('Daily record save path preload failed; retrying when online.');
    return false;
  }
};

export const useWarmDailyRecordSavePath = () => {
  useEffect(() => {
    let ready = false;
    let pending = false;
    const warm = async () => {
      if (ready || pending) return;
      pending = true;
      ready = await warmDailyRecordSavePath();
      pending = false;
    };
    void warm();
    window.addEventListener('online', warm);
    return () => window.removeEventListener('online', warm);
  }, []);
};
