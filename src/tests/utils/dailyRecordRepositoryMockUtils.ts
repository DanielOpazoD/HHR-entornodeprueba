import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { vi } from 'vitest';
import { deepClone } from '@/utils/deepClone';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

interface DailyRecordRepositoryMockLike {
  getForDate: (date: string) => Promise<DailyRecord | null>;
  getForDateWithMeta?: (date: string, syncFromRemote?: boolean) => Promise<unknown>;
  getAuthoritativeForDate?: (date: string) => Promise<DailyRecord>;
  save: (record: DailyRecord) => Promise<void>;
  saveDetailed?: (record: DailyRecord) => Promise<unknown>;
  updatePartial: (date: string, partial: DailyRecordPatch) => Promise<void>;
  updatePartialDetailed?: (
    date: string,
    partial: DailyRecordPatch,
    options?: { requireConfirmedRecord?: boolean }
  ) => Promise<unknown>;
  initializeDay?: (date: string, copyFromDate?: string) => Promise<unknown>;
  initializeDayDetailed?: (date: string, copyFromDate?: string) => Promise<unknown>;
  syncWithFirestore?: (date: string) => Promise<unknown>;
}

interface StatefulWireOptions {
  getCurrentRecord: () => DailyRecord | null;
  setCurrentRecord: (record: DailyRecord | null) => void;
}

const cloneRecord = (record: DailyRecord): DailyRecord => deepClone(record);

export const wireStatefulDailyRecordRepoMock = (
  repo: DailyRecordRepositoryMockLike,
  options: StatefulWireOptions
): void => {
  vi.mocked(repo.getForDate).mockImplementation(async () => options.getCurrentRecord());

  if (repo.getAuthoritativeForDate) {
    vi.mocked(repo.getAuthoritativeForDate).mockImplementation(async () => {
      const record = options.getCurrentRecord();
      if (!record) throw new Error('No authoritative test record is available.');
      return cloneRecord(record);
    });
  }

  if (repo.getForDateWithMeta) {
    vi.mocked(repo.getForDateWithMeta).mockImplementation(async (date: string) => {
      const record = options.getCurrentRecord();
      return {
        date,
        record,
        source: record ? 'indexeddb' : 'not_found',
        compatibilityTier: 'none',
        compatibilityIntensity: 'none',
        migrationRulesApplied: [],
        consistencyState: record ? 'local_only' : 'missing',
        sourceOfTruth: record ? 'local' : 'none',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      };
    });
  }

  vi.mocked(repo.save).mockImplementation(async (record: DailyRecord) => {
    options.setCurrentRecord(cloneRecord(record));
  });

  if (repo.saveDetailed) {
    vi.mocked(repo.saveDetailed).mockImplementation(async (record: DailyRecord) => {
      options.setCurrentRecord(cloneRecord(record));
      return null;
    });
  }

  vi.mocked(repo.updatePartial).mockImplementation(
    async (_date: string, partial: DailyRecordPatch) => {
      const currentRecord = options.getCurrentRecord();
      if (!currentRecord) return;
      const nextRecord = applyPatches(cloneRecord(currentRecord), partial);
      options.setCurrentRecord(nextRecord);
    }
  );

  if (repo.updatePartialDetailed) {
    vi.mocked(repo.updatePartialDetailed).mockImplementation(
      async (date: string, partial: DailyRecordPatch, writeOptions) => {
        const currentRecord = options.getCurrentRecord();
        if (!currentRecord) return null;
        const nextRecord = applyPatches(cloneRecord(currentRecord), partial);
        options.setCurrentRecord(nextRecord);
        return writeOptions?.requireConfirmedRecord
          ? createUpdatePartialDailyRecordResult({
              date,
              outcome: 'clean',
              savedLocally: true,
              updatedRemotely: true,
              queuedForRetry: false,
              autoMerged: false,
              patchedFields: Object.keys(partial).length,
              confirmedRecord: cloneRecord(nextRecord),
            })
          : null;
      }
    );
  }

  if (repo.initializeDayDetailed && repo.initializeDay) {
    vi.mocked(repo.initializeDayDetailed).mockImplementation(
      async (date: string, copyFromDate?: string) => {
        return repo.initializeDay?.(date, copyFromDate);
      }
    );
  }

  if (repo.syncWithFirestore) {
    vi.mocked(repo.syncWithFirestore).mockResolvedValue(null);
  }
};
