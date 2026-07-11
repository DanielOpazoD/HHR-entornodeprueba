/**
 * Merges the evaluation scales parsed from Ficha Médico into a patient's HHR `evaluationScores`.
 * Self-contained (like `mergeReportDevices`) to avoid a circular feature dependency.
 *
 * The stored current value per scale is the latest recorded AS OF the census day (so a day with no
 * new assessment keeps the last known score, which drives the reapplication reminder; a late sync of
 * a past census never picks up a later score). The full history is kept — most-recent-first, compact
 * (without the per-item breakdown) — to feed the unified risk view over the hospitalization.
 *
 * Ownership is `remoteCanonical` (Ficha Médico is the source of truth), so the sync replaces the
 * whole `evaluationScores` object rather than merging field-by-field.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type {
  EvaluationScoreEntry,
  PatientEvaluationScores,
} from '@/types/domain/evaluationScores';
import { evaluationScalesAsOf, type EvaluationScale } from '../mapping/parseEvaluationScales';

export interface MergeScalesContext {
  /** The census day being synced (YYYY-MM-DD, Rapa Nui local). */
  censusIsoDay: string;
}

const toEntry = (scale: EvaluationScale, includeItems: boolean): EvaluationScoreEntry => ({
  code: scale.code,
  name: scale.name,
  encounterEventId: scale.encounterEventId,
  total: scale.total,
  severity: scale.severity,
  recordedDate: scale.recordedDate,
  recordedAt: scale.recordedAt,
  ...(includeItems && scale.items ? { items: scale.items } : {}),
});

export const mergeReportScales = (
  patient: PatientData,
  scales: EvaluationScale[],
  ctx: MergeScalesContext
): PatientData => {
  if (scales.length === 0) return patient;

  const current = evaluationScalesAsOf(scales, ctx.censusIsoDay);
  const braden = current.find(scale => scale.code === 'BRADEN');
  const downton = current.find(scale => scale.code === 'DOWNTON');

  const history = [...scales]
    .sort((a, b) => b.encounterEventId - a.encounterEventId)
    .map(scale => toEntry(scale, false));

  const evaluationScores: PatientEvaluationScores = {
    ...(braden ? { braden: toEntry(braden, true) } : {}),
    ...(downton ? { downton: toEntry(downton, true) } : {}),
    history,
  };

  return { ...patient, evaluationScores };
};
