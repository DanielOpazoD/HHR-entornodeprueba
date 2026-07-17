import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

export interface HistoricalCudyrPatchResolution {
  matched: boolean;
  patch: DailyRecordPatch | null;
}

/**
 * Builds the narrow historical patch for an official CUDYR result.
 * A different local copy is stale and must be replaced, not treated as an already-filled field.
 */
export const resolveHistoricalCudyrPatch = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  cudyr: ImportedCudyr
): HistoricalCudyrPatchResolution => {
  for (const [bedId, patient] of Object.entries(record.beds)) {
    const isPatient = String(patient?.clinicalEpisodeId || '') === clinicalEpisodeId;
    const isClinicalCrib =
      String(patient?.clinicalCrib?.clinicalEpisodeId || '') === clinicalEpisodeId;
    const target = isPatient ? patient : isClinicalCrib ? patient.clinicalCrib : null;
    if (!target) continue;

    const current = target.evaluationScores?.cudyr;
    if (
      current &&
      current.recordedDate === cudyr.recordedDate &&
      current.recordedAt === cudyr.recordedAt &&
      current.category === cudyr.category &&
      current.author === cudyr.author &&
      current.authorRole === cudyr.authorRole &&
      current.dependencyScore === cudyr.dependencyScore &&
      current.riskScore === cudyr.riskScore &&
      current.source === cudyr.source &&
      JSON.stringify(current.items ?? []) === JSON.stringify(cudyr.items ?? []) &&
      JSON.stringify(current.history ?? []) === JSON.stringify(cudyr.history ?? [])
    ) {
      return { matched: true, patch: null };
    }

    const path = isPatient
      ? `beds.${bedId}.evaluationScores.cudyr`
      : `beds.${bedId}.clinicalCrib.evaluationScores.cudyr`;
    const patch: DailyRecordPatch = {};
    patch[path] = cudyr;
    return { matched: true, patch };
  }

  return { matched: false, patch: null };
};
