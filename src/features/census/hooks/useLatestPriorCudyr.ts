import { useEffect, useState } from 'react';
import { useOptionalRepositories } from '@/context/RepositoryContext';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

const MAX_PRIOR_DAYS_TO_INSPECT = 2;

export interface LatestPriorCudyrState {
  status: 'idle' | 'loading' | 'resolved' | 'unavailable';
  cudyr: ImportedCudyr | null;
}

const findEpisodeCudyr = (record: DailyRecord, clinicalEpisodeId: string): ImportedCudyr | null => {
  for (const patient of Object.values(record.beds)) {
    if (patient.clinicalEpisodeId === clinicalEpisodeId && patient.evaluationScores?.cudyr) {
      return patient.evaluationScores.cudyr;
    }
    if (
      patient.clinicalCrib?.clinicalEpisodeId === clinicalEpisodeId &&
      patient.clinicalCrib.evaluationScores?.cudyr
    ) {
      return patient.clinicalCrib.evaluationScores.cudyr;
    }
  }
  return null;
};

/**
 * Looks up the latest prior CUDYR for an episode only on demand when the user opens the detail
 * dialog on a census day without a current CUDYR result (e.g. a post-midnight categorization that
 * belonged to the preceding night shift).
 */
export const useLatestPriorCudyr = ({
  enabled,
  censusDate,
  clinicalEpisodeId,
}: {
  enabled: boolean;
  censusDate?: string;
  clinicalEpisodeId?: string;
}): LatestPriorCudyrState => {
  const repositories = useOptionalRepositories();
  const dailyRecord = repositories?.dailyRecord;
  const requestKey =
    enabled && censusDate && clinicalEpisodeId && dailyRecord
      ? `${censusDate}|${clinicalEpisodeId}`
      : null;
  const [result, setResult] = useState<{
    key: string;
    status: 'resolved' | 'unavailable';
    cudyr: ImportedCudyr | null;
  } | null>(null);

  useEffect(() => {
    if (!requestKey || !censusDate || !clinicalEpisodeId || !dailyRecord) return;

    let cancelled = false;

    const load = async () => {
      let targetDay = previousCensusIsoDay(censusDate);
      for (let step = 0; step < MAX_PRIOR_DAYS_TO_INSPECT; step += 1) {
        const read = await dailyRecord.getForDateWithMeta(targetDay, true);
        if (cancelled) return;
        if (read.consistencyState === 'unavailable') {
          setResult({ key: requestKey, status: 'unavailable', cudyr: null });
          return;
        }
        if (read.record) {
          const found = findEpisodeCudyr(read.record, clinicalEpisodeId);
          if (found) {
            setResult({ key: requestKey, status: 'resolved', cudyr: found });
            return;
          }
        }
        targetDay = previousCensusIsoDay(targetDay);
      }
      if (!cancelled) {
        setResult({ key: requestKey, status: 'resolved', cudyr: null });
      }
    };

    void load().catch(() => {
      if (!cancelled) {
        setResult({ key: requestKey, status: 'unavailable', cudyr: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [censusDate, clinicalEpisodeId, dailyRecord, requestKey]);

  if (!requestKey) return { status: 'idle', cudyr: null };
  if (result?.key === requestKey) return { status: result.status, cudyr: result.cudyr };
  return { status: 'loading', cudyr: null };
};
