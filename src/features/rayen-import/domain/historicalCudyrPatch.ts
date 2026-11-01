import { clinicalValuesEqual } from './clinicalIncrementalSync';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '../contracts/clinicalFillContracts';
import { isAdministrativeCudyrAdjustment } from '@/domain/evaluationScales/importedCudyr';
import {
  assertDocumentaryCudyrTarget,
  CUDYR_DOCUMENTARY_SOURCE,
  hasAcceptedCudyr,
} from '@/domain/evaluationScales/documentaryCudyr';

interface LocatedHistoricalCudyrTarget {
  bedId: string;
  clinicalCrib?: true;
  evaluationScores: DailyRecord['beds'][string]['evaluationScores'];
  patient: DailyRecord['beds'][string];
}

const locateHistoricalCudyrTarget = (
  record: DailyRecord,
  clinicalEpisodeId: string
): LocatedHistoricalCudyrTarget | null => {
  const matches: LocatedHistoricalCudyrTarget[] = [];
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (String(patient?.clinicalEpisodeId || '') === clinicalEpisodeId) {
      matches.push({ bedId, patient, evaluationScores: patient.evaluationScores });
    }
    const crib = patient?.clinicalCrib;
    if (crib && String(crib.clinicalEpisodeId || '') === clinicalEpisodeId) {
      matches.push({
        bedId,
        clinicalCrib: true,
        evaluationScores: patient.clinicalCrib?.evaluationScores,
        patient: crib,
      });
    }
  }
  return matches.length === 1 ? matches[0] : null;
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
    clinicalValuesEqual(current.items ?? [], cudyr.items ?? []) &&
    clinicalValuesEqual(current.history ?? [], cudyr.history ?? [])
  );

/**
 * Builds the narrow historical CUDYR delta accepted by the backend authority.
 * The server merges it into its current score object so a normalized client read cannot erase or
 * appear to modify adjacent scales such as Braden or Downton.
 */
export const resolveHistoricalCudyrBatchOperation = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  cudyr: ImportedCudyr
): {
  matched: boolean;
  operation: ClinicalFillPatchOperation | null;
  administrativeOverridePreserved?: boolean;
} => {
  const target = locateHistoricalCudyrTarget(record, clinicalEpisodeId);
  if (!target) return { matched: false, operation: null };
  if (
    target.evaluationScores?.cudyr?.source === CUDYR_DOCUMENTARY_SOURCE ||
    (cudyr.source === CUDYR_DOCUMENTARY_SOURCE && hasAcceptedCudyr(target.patient))
  )
    return {
      matched: true,
      operation: null,
      ...(isAdministrativeCudyrAdjustment(target.evaluationScores?.cudyr)
        ? { administrativeOverridePreserved: true }
        : {}),
    };
  assertDocumentaryCudyrTarget(record, target.patient, cudyr);
  if (sameCudyr(target.evaluationScores?.cudyr, cudyr)) {
    return { matched: true, operation: null };
  }
  if (isAdministrativeCudyrAdjustment(target.evaluationScores?.cudyr)) {
    return { matched: true, operation: null, administrativeOverridePreserved: true };
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
