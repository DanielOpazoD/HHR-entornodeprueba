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
import { clinicalValuesEqual } from './clinicalIncrementalSync';

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

const toScale = (entry: EvaluationScoreEntry): EvaluationScale => ({
  code: entry.code,
  name: entry.name,
  encounterEventId: entry.encounterEventId,
  ...(entry.sourceOrder != null ? { sourceOrder: entry.sourceOrder } : {}),
  total: entry.total,
  severity: entry.severity,
  recordedDate: entry.recordedDate,
  recordedAt: entry.recordedAt,
  author: entry.author ?? '',
  authorRole: entry.authorRole ?? '',
  items: entry.items ?? [],
  ...(entry.archived ? { archived: true } : {}),
});

const scaleLegacyIdentity = (scale: EvaluationScale): string =>
  JSON.stringify([
    scale.code,
    scale.recordedDate,
    scale.recordedAt,
    scale.total,
    scale.severity,
    scale.archived ?? false,
  ]);

const scaleStableIdentity = (scale: EvaluationScale): string | null =>
  scale.encounterEventId > 0
    ? `${scale.code}|event:${scale.encounterEventId}|${scale.sourceOrder ?? 0}`
    : null;

const scaleIdentity = (scale: EvaluationScale): string =>
  scaleStableIdentity(scale) ?? `legacy:${scaleLegacyIdentity(scale)}`;

const mergeScaleHistory = (
  patient: PatientData,
  incoming: EvaluationScale[],
  censusIsoDay: string
): EvaluationScale[] => {
  const scores = patient.evaluationScores;
  const existing = [
    ...(scores?.history ?? []).map(toScale),
    ...(scores?.braden ? [toScale(scores.braden)] : []),
    ...(scores?.downton ? [toScale(scores.downton)] : []),
  ];
  const byIdentity = new Map<string, EvaluationScale>();
  for (const scale of existing) {
    if (scale.recordedDate <= censusIsoDay) byIdentity.set(scaleIdentity(scale), scale);
  }
  // Source values replace a stable event identity even when a correction moves the event after the
  // requested census day. Otherwise the old eligible copy would survive as stale clinical truth.
  for (const scale of incoming) {
    const stableIdentity = scaleStableIdentity(scale);
    if (stableIdentity) {
      byIdentity.delete(stableIdentity);
      byIdentity.delete(`legacy:${scaleLegacyIdentity(scale)}`);
    }
    if (scale.recordedDate <= censusIsoDay) {
      byIdentity.set(stableIdentity ?? scaleIdentity(scale), scale);
    }
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      right.encounterEventId - left.encounterEventId ||
      (right.sourceOrder ?? 0) - (left.sourceOrder ?? 0)
  );
};

export const mergeReportScales = (
  patient: PatientData,
  scales: EvaluationScale[],
  ctx: MergeScalesContext
): PatientData => {
  const mergedScales = mergeScaleHistory(patient, scales, ctx.censusIsoDay);
  if (mergedScales.length === 0) {
    if (scales.length === 0 || !patient.evaluationScores) return patient;
    const evaluationScores: PatientEvaluationScores = {
      ...(patient.evaluationScores.cudyr ? { cudyr: patient.evaluationScores.cudyr } : {}),
      history: [],
    };
    if (clinicalValuesEqual(patient.evaluationScores, evaluationScores)) return patient;
    return { ...patient, evaluationScores };
  }

  // Clinical result and application time are kept separate. For the current result, Rayen's rule is
  // resolved per day: latest visible entry first; if all are archived, latest archived. Independently,
  // every complete entry proves application and can advance the reapplication clock.
  const current = evaluationScalesAsOf(mergedScales, ctx.censusIsoDay);
  const latestApplications = evaluationScaleApplicationsAsOf(mergedScales, ctx.censusIsoDay);
  const braden = current.find(scale => scale.code === 'BRADEN');
  const downton = current.find(scale => scale.code === 'DOWNTON');
  const bradenApplication = latestApplications.find(scale => scale.code === 'BRADEN');
  const downtonApplication = latestApplications.find(scale => scale.code === 'DOWNTON');

  // A census-day snapshot must not reveal assessments applied after that day. This also keeps a
  // delayed synchronization from making an old row look complete with future evidence.
  const history = mergedScales.map(scale => toEntry(scale, false));

  const evaluationScores: PatientEvaluationScores = {
    ...(patient.evaluationScores?.cudyr ? { cudyr: patient.evaluationScores.cudyr } : {}),
    ...(braden ? { braden: toEntry(braden, true, bradenApplication) } : {}),
    ...(downton ? { downton: toEntry(downton, true, downtonApplication) } : {}),
    history,
  };

  if (clinicalValuesEqual(patient.evaluationScores, evaluationScores)) return patient;
  return { ...patient, evaluationScores };
};
