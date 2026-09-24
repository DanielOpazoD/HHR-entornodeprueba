import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';
import type { PatientData } from '@/types/domain/patient';
import { isFeatureEnabled } from '@/services/utils/featureFlags';

const currentSpecialtyDecision = (patient: PatientData | undefined) => {
  const decision = patient?.specialtyAssignment;
  return patient?.clinicalEpisodeId && decision?.schemaVersion === 3 &&
    decision.episodeId === patient.clinicalEpisodeId &&
    typeof decision.decisionId === 'string' && decision.decisionId.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(decision.recordDate)
    ? decision : null;
};

/** Translate an existing bed edit to an episode-bound request; the server remains authoritative. */
export const resolveManualSpecialtyIntent = (
  action: BedAction,
  record: DailyRecord,
  patch?: DailyRecordPatch
): SpecialtyManualIntent | null => {
  if (!isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT')) return null;
  const isCrib = action.type === 'UPDATE_CLINICAL_CRIB' ||
    action.type === 'UPDATE_CLINICAL_CRIB_MULTIPLE';
  const isBed = action.type === 'UPDATE_PATIENT' || action.type === 'UPDATE_PATIENT_MULTIPLE';
  if (!isCrib && !isBed) return null;
  const value = 'field' in action
    ? action.field === 'specialty' ? action.value : undefined
    : 'fields' in action ? action.fields.specialty : undefined;
  if (typeof value !== 'string') return null;
  // Multi-field forms may resend an unchanged specialty. Only a scalar that
  // survived the reducer's diff represents a new explicit decision.
  if (patch && 'fields' in action) {
    const scalarPath = isCrib
      ? `beds.${action.bedId}.clinicalCrib.specialty`
      : `beds.${action.bedId}.specialty`;
    if (!Object.prototype.hasOwnProperty.call(patch, scalarPath)) return null;
  }
  const patient = isCrib
    ? record.beds[action.bedId]?.clinicalCrib
    : record.beds[action.bedId];
  if (!patient?.clinicalEpisodeId) return null;
  const currentDecision = currentSpecialtyDecision(patient);
  if (currentDecision?.source === 'manual' && value === patient.specialty) return null;
  return { kind: 'manual', bedId: action.bedId,
    target: isCrib ? 'clinicalCrib' : 'bed', episodeId: patient.clinicalEpisodeId,
    value, expectedDecisionId: currentDecision?.decisionId ?? null };
};

export const isSpecialtyEditAction = (action: BedAction): boolean =>
  ((action.type === 'UPDATE_PATIENT' || action.type === 'UPDATE_CLINICAL_CRIB') &&
    action.field === 'specialty') ||
  ((action.type === 'UPDATE_PATIENT_MULTIPLE' || action.type === 'UPDATE_CLINICAL_CRIB_MULTIPLE') &&
    Object.prototype.hasOwnProperty.call(action.fields, 'specialty'));

export const changesSpecialtyEpisode = (
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent
): boolean => {
  const path = intent.target === 'clinicalCrib'
    ? `beds.${intent.bedId}.clinicalCrib.clinicalEpisodeId`
    : `beds.${intent.bedId}.clinicalEpisodeId`;
  return Object.prototype.hasOwnProperty.call(patch, path) &&
    (patch as Record<string, unknown>)[path] !== intent.episodeId;
};

/** A confirmed decision never shares a patch with another patient field. */
export const isExclusiveSpecialtyIntentPatch = (
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent
): boolean => {
  const scalarPath = intent.target === 'clinicalCrib'
    ? `beds.${intent.bedId}.clinicalCrib.specialty`
    : `beds.${intent.bedId}.specialty`;
  return Object.keys(patch).length === 1 &&
    Object.prototype.hasOwnProperty.call(patch, scalarPath);
};

export const blocksUnanchoredSpecialtyEdit = (
  action: BedAction,
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent | null
): boolean => {
  if (!isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT') || !isSpecialtyEditAction(action)) return false;
  if (action.type !== 'UPDATE_PATIENT' && action.type !== 'UPDATE_PATIENT_MULTIPLE' &&
      action.type !== 'UPDATE_CLINICAL_CRIB' && action.type !== 'UPDATE_CLINICAL_CRIB_MULTIPLE') return false;
  const scalarPath = (action.type === 'UPDATE_CLINICAL_CRIB' || action.type === 'UPDATE_CLINICAL_CRIB_MULTIPLE')
    ? `beds.${action.bedId}.clinicalCrib.specialty` : `beds.${action.bedId}.specialty`;
  return (Boolean(intent) || Object.prototype.hasOwnProperty.call(patch, scalarPath)) &&
    (!intent || changesSpecialtyEpisode(patch, intent));
};

/** An intentional empty choice is a write even when the visible scalar was already empty. */
export const preserveExplicitEmptySpecialtyChoice = (
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent | null,
  record: DailyRecord
): DailyRecordPatch => {
  if (Object.keys(patch).length || !intent) return patch;
  const patient = intent.target === 'clinicalCrib'
    ? record.beds[intent.bedId]?.clinicalCrib : record.beds[intent.bedId];
  if (intent.value === '' && currentSpecialtyDecision(patient)?.source === 'manual') return patch;
  const path = intent.target === 'clinicalCrib'
    ? `beds.${intent.bedId}.clinicalCrib.specialty`
    : `beds.${intent.bedId}.specialty`;
  return { [path]: intent.value } as DailyRecordPatch;
};
