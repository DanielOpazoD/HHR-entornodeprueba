import {
  admitLocalRecords,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export type RemoteDailyRecordCandidate = LocalRecordAdmissionCandidate & {
  remoteRecord: DailyRecord | null;
};

export type RemoteDailyRecordAdmission = LocalRecordAdmissionResult & {
  remoteRecord: DailyRecord | null;
};

/** All confirmed observations share one admission; remote evidence never acknowledges retained work. */
export const admitRemoteDailyRecords = async (
  candidates: readonly RemoteDailyRecordCandidate[]
): Promise<RemoteDailyRecordAdmission[]> => {
  const byDate = new Map(candidates.map(candidate => [candidate.record.date, candidate]));
  const results = await admitLocalRecords([...byDate.values()]);
  return results.map(result => ({
    ...result,
    remoteRecord: byDate.get(result.date)?.remoteRecord ?? null,
  }));
};
