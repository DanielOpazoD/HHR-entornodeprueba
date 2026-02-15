import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecord, DailyRecordPatch } from '@/types';
import { vi } from 'vitest';

interface DailyRecordRepositoryMockLike {
    getForDate: (date: string) => Promise<DailyRecord | null>;
    save: (record: DailyRecord) => Promise<void>;
    updatePartial: (date: string, partial: DailyRecordPatch) => Promise<void>;
    syncWithFirestore?: (date: string) => Promise<unknown>;
}

interface StatefulWireOptions {
    getCurrentRecord: () => DailyRecord | null;
    setCurrentRecord: (record: DailyRecord | null) => void;
}

const cloneRecord = (record: DailyRecord): DailyRecord => JSON.parse(JSON.stringify(record));

export const wireStatefulDailyRecordRepoMock = (
    repo: DailyRecordRepositoryMockLike,
    options: StatefulWireOptions
): void => {
    vi.mocked(repo.getForDate).mockImplementation(async () => options.getCurrentRecord());

    vi.mocked(repo.save).mockImplementation(async (record: DailyRecord) => {
        options.setCurrentRecord(cloneRecord(record));
    });

    vi.mocked(repo.updatePartial).mockImplementation(async (_date: string, partial: DailyRecordPatch) => {
        const currentRecord = options.getCurrentRecord();
        if (!currentRecord) return;
        const nextRecord = applyPatches(cloneRecord(currentRecord), partial);
        options.setCurrentRecord(nextRecord);
    });

    if (repo.syncWithFirestore) {
        vi.mocked(repo.syncWithFirestore).mockResolvedValue(null);
    }
};
