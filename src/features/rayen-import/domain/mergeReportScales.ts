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
  EvaluationScaleApplicationEvidence,
  EvaluationScoreEntry,
  PatientEvaluationScores,
} from '@/types/domain/evaluationScores';
import {
  evaluationScaleApplicationsAsOf,
  evaluationScalesAsOf,
  type EvaluationScale,
} from '../mapping/parseEvaluationScales';

export interface MergeScalesContext {
  /** The census day being synced (YYYY-MM-DD, Rapa Nui local). */
  censusIsoDay: string;
}

const toApplicationEvidence = (scale: EvaluationScale): EvaluationScaleApplicationEvidence => ({
  recordedDate: scale.recordedDate,
  recordedAt: scale.recordedAt,
  ...(scale.author ? { author: scale.author } : {}),
  ...(scale.authorRole ? { authorRole: scale.authorRole } : {}),
  ...(scale.archived ? { archived: true } : {}),
});

const toEntry = (
  scale: EvaluationScale,
  includeItems: boolean,
  latestApplication?: EvaluationScale
): EvaluationScoreEntry => ({
  code: scale.code,
  name: scale.name,
  encounterEventId: scale.encounterEventId,
  ...(scale.sourceOrder != null ? { sourceOrder: scale.sourceOrder } : {}),
  total: scale.total,
  severity: scale.severity,
  recordedDate: scale.recordedDate,
  recordedAt: scale.recordedAt,
  // Who applied it — feeds the census hover card ("aplicada por"). Kept optional: old stored
  // entries predate this field and Firestore rejects `undefined`, so blank means absent.
  ...(scale.author ? { author: scale.author } : {}),
  ...(scale.authorRole ? { authorRole: scale.authorRole } : {}),
  ...(scale.archived ? { archived: true } : {}),
  ...(latestApplication ? { latestApplication: toApplicationEvidence(latestApplication) } : {}),
  ...(includeItems && scale.items ? { items: scale.items } : {}),
});

export const mergeReportScales = (
  patient: PatientData,
  scales: EvaluationScale[],
  ctx: MergeScalesContext
): PatientData => {
  if (scales.length === 0) return patient;

  // Clinical result and application time are kept separate. For the current result, Rayen's rule is
  // resolved per day: latest visible entry first; if all are archived, latest archived. Independently,
  // every complete entry proves application and can advance the reapplication clock.
  const current = evaluationScalesAsOf(scales, ctx.censusIsoDay);
  const latestApplications = evaluationScaleApplicationsAsOf(scales, ctx.censusIsoDay);
  const braden = current.find(scale => scale.code === 'BRADEN');
  const downton = current.find(scale => scale.code === 'DOWNTON');
  const bradenApplication = latestApplications.find(scale => scale.code === 'BRADEN');
  const downtonApplication = latestApplications.find(scale => scale.code === 'DOWNTON');

  // A census-day snapshot must not reveal assessments applied after that day. This also keeps a
  // delayed synchronization from making an old row look complete with future evidence.
  const history = scales
    .filter(scale => scale.recordedDate <= ctx.censusIsoDay)
    .sort(
      (a, b) =>
        b.encounterEventId - a.encounterEventId || (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0)
    )
    .map(scale => toEntry(scale, false));

  const evaluationScores: PatientEvaluationScores = {
    ...(braden ? { braden: toEntry(braden, true, bradenApplication) } : {}),
    ...(downton ? { downton: toEntry(downton, true, downtonApplication) } : {}),
    history,
  };

  return { ...patient, evaluationScores };
};
