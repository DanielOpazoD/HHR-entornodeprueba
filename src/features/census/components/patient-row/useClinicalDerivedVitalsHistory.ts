import { useCallback, useEffect, useState } from 'react';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

/** Where a split day keeps this episode's vitals history (D10). */
export interface ClinicalDerivedVitalsSource {
  date: string;
  clinicalEpisodeId: string;
  layoutGeneration: string;
  dayRevision?: number;
}

type ResolvedVitalsHistory = {
  status: 'resolved';
  history: PatientVitalSigns[] | null | undefined;
};

type VitalsHistoryReadState =
  | ResolvedVitalsHistory
  | { status: 'loading' | 'unavailable'; previous: ResolvedVitalsHistory | null };

/** The detail history: the stored history, or the latest reading alone when there is none. */
export const resolveVitalsDetailHistory = (
  vitalSignsHistory: PatientVitalSigns[] | undefined,
  latestReading: PatientVitalSigns | undefined
): PatientVitalSigns[] =>
  vitalSignsHistory?.length ? vitalSignsHistory : latestReading ? [latestReading] : [];

/** Read on opening, revision change or retry; a failed read never means absent history. */
export const useClinicalDerivedVitalsHistory = (
  source: ClinicalDerivedVitalsSource | undefined
): VitalsHistoryReadState & { retry: () => void } => {
  const date = source?.date;
  const clinicalEpisodeId = source?.clinicalEpisodeId;
  const layoutGeneration = source?.layoutGeneration;
  const dayRevision = source?.dayRevision;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const sourceKey = JSON.stringify([date, layoutGeneration, clinicalEpisodeId]);
  const key = JSON.stringify([date, layoutGeneration, clinicalEpisodeId, dayRevision, attempt]);
  const [answer, setAnswer] = useState<{
    key: string;
    sourceKey: string;
    state: VitalsHistoryReadState;
  } | null>(null);

  useEffect(() => {
    if (!date || !clinicalEpisodeId || !layoutGeneration) return undefined;
    let active = true;
    const resolve = (state: ResolvedVitalsHistory | { status: 'unavailable' }) => {
      if (active)
        setAnswer(previous => ({
          key,
          sourceKey,
          state:
            state.status === 'resolved'
              ? state
              : {
                  status: 'unavailable',
                  previous:
                    previous?.sourceKey === sourceKey
                      ? previous.state.status === 'resolved'
                        ? previous.state
                        : previous.state.previous
                      : null,
                },
        }));
    };
    import('@/services/repositories/dailyRecordClinicalDerivedReadService')
      .then(service =>
        service.readClinicalDerivedEpisodeForDisplay(date, layoutGeneration, clinicalEpisodeId)
      )
      .then(result =>
        resolve(
          result.status === 'resolved'
            ? { status: 'resolved', history: result.doc?.vitalSignsHistory }
            : { status: 'unavailable' }
        )
      )
      .catch(() => resolve({ status: 'unavailable' }));
    return () => {
      active = false;
    };
  }, [date, clinicalEpisodeId, layoutGeneration, sourceKey, key]);

  if (!source) return { status: 'resolved', history: undefined, retry };
  if (answer?.key === key) return { ...answer.state, retry };
  return {
    status: 'loading',
    previous:
      answer?.sourceKey === sourceKey
        ? answer.state.status === 'resolved'
          ? answer.state
          : answer.state.previous
        : null,
    retry,
  };
};
