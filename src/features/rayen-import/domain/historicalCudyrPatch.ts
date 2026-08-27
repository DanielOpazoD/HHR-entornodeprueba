import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '../contracts/clinicalFillContracts';

export interface HistoricalCudyrPatchResolution {
  matched: boolean;
  patch: DailyRecordPatch | null;
}

interface LocatedHistoricalCudyrTarget {
  bedId: string;
  clinicalCrib?: true;
  evaluationScores: DailyRecord['beds'][string]['evaluationScores'];
}

const locateHistoricalCudyrTarget = (
  record: DailyRecord,
  clinicalEpisodeId: string
): LocatedHistoricalCudyrTarget | null => {
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (String(patient?.clinicalEpisodeId || '') === clinicalEpisodeId) {
      return { bedId, evaluationScores: patient.evaluationScores };
    }
    if (String(patient?.clinicalCrib?.clinicalEpisodeId || '') === clinicalEpisodeId) {
      return {
        bedId,
        clinicalCrib: true,
        evaluationScores: patient.clinicalCrib?.evaluationScores,
      };
    }
  }
  return null;
};

const sameCudyr = (current: ImportedCudyr | undefined, cudyr: ImportedCudyr): boolean =>
  Boolean(
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
  );

/**
 * Builds the narrow historical patch for an official CUDYR result.
 * A different local copy is stale and must be replaced, not treated as an already-filled field.
 */
export const resolveHistoricalCudyrPatch = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  cudyr: ImportedCudyr
): HistoricalCudyrPatchResolution => {
  const target = locateHistoricalCudyrTarget(record, clinicalEpisodeId);
  if (!target) return { matched: false, patch: null };
  if (sameCudyr(target.evaluationScores?.cudyr, cudyr)) return { matched: true, patch: null };

  const path = target.clinicalCrib
    ? `beds.${target.bedId}.clinicalCrib.evaluationScores.cudyr`
    : `beds.${target.bedId}.evaluationScores.cudyr`;
  const patch: DailyRecordPatch = {};
  patch[path] = cudyr;
  return { matched: true, patch };
};

/**
 * Builds the narrow historical CUDYR delta accepted by the backend authority.
 * The server merges it into its current score object so a normalized client read cannot erase or
 * appear to modify adjacent scales such as Braden or Downton.
 */
export const resolveHistoricalCudyrBatchOperation = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  cudyr: ImportedCudyr
): { matched: boolean; operation: ClinicalFillPatchOperation | null } => {
  const target = locateHistoricalCudyrTarget(record, clinicalEpisodeId);
  if (!target) return { matched: false, operation: null };
  if (sameCudyr(target.evaluationScores?.cudyr, cudyr)) {
    return { matched: true, operation: null };
  }
  const prefix = `beds.${target.bedId}${target.clinicalCrib ? '.clinicalCrib' : ''}`;
  const patch = {
    [`${prefix}.evaluationScores`]: { cudyr },
  } as DailyRecordPatch;
  return {
    matched: true,
    operation: {
      patch,
      target: {
        censusDate: record.date,
        bedId: target.bedId,
        clinicalEpisodeId,
        ...(target.clinicalCrib ? { clinicalCrib: true } : {}),
      },
      clinicalFieldCount: 1,
    },
  };
};
