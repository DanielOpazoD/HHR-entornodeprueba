import { useEffect, useState } from 'react';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

/** Where a split day keeps this episode's vitals history (D10). */
export interface ClinicalDerivedVitalsSource {
  date: string;
  clinicalEpisodeId: string;
  layoutGeneration: string;
}

/** The detail history: the stored history, or the latest reading alone when there is none. */
export const resolveVitalsDetailHistory = (
  vitalSignsHistory: PatientVitalSigns[] | undefined,
  latestReading: PatientVitalSigns | undefined
): PatientVitalSigns[] =>
  vitalSignsHistory?.length ? vitalSignsHistory : latestReading ? [latestReading] : [];

/**
 * The vitals window reads its episode document once when it opens: no listener, SDK default
 * source. Returns the document's `vitalSignsHistory` (`null` when the document clears it) or
 * `undefined` while there is no such answer. No document, a document without the field, an
 * offline read without a cached copy or any failure keep the day's embedded copy, as before.
 */
export const useClinicalDerivedVitalsHistory = (
  source: ClinicalDerivedVitalsSource | undefined
): PatientVitalSigns[] | null | undefined => {
  const date = source?.date;
  const clinicalEpisodeId = source?.clinicalEpisodeId;
  const layoutGeneration = source?.layoutGeneration;
  const key =
    date && clinicalEpisodeId && layoutGeneration
      ? `${date}|${layoutGeneration}|${clinicalEpisodeId}`
      : '';
  const [answer, setAnswer] = useState<{
    key: string;
    history: PatientVitalSigns[] | null;
  } | null>(null);

  useEffect(() => {
    if (!date || !clinicalEpisodeId || !layoutGeneration) return undefined;
    let active = true;
    const requestKey = `${date}|${layoutGeneration}|${clinicalEpisodeId}`;
    import('@/services/repositories/dailyRecordClinicalDerivedReadService')
      .then(service =>
        service.readClinicalDerivedEpisodeForDisplay(date, layoutGeneration, clinicalEpisodeId)
      )
      .then(result => {
        const history = result.status === 'resolved' ? result.doc?.vitalSignsHistory : undefined;
        if (active && history !== undefined) setAnswer({ key: requestKey, history });
      })
      // A read path that fails to load keeps the embedded copy too.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [date, clinicalEpisodeId, layoutGeneration]);

  return answer?.key === key ? answer.history : undefined;
};
