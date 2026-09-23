import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';
import { isFeatureEnabled } from '@/services/utils/featureFlags';

/** Translate an existing bed edit to an episode-bound request; the server remains authoritative. */
export const resolveManualSpecialtyIntent = (
  action: BedAction,
  record: DailyRecord
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
  const patient = isCrib
    ? record.beds[action.bedId]?.clinicalCrib
    : record.beds[action.bedId];
  if (!patient?.clinicalEpisodeId) return null;
  return { kind: 'manual', bedId: action.bedId,
    target: isCrib ? 'clinicalCrib' : 'bed', episodeId: patient.clinicalEpisodeId,
    value, expectedDecisionId: patient.specialtyAssignment?.decisionId ?? null };
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

export const blocksUnanchoredSpecialtyEdit = (
  action: BedAction,
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent | null
): boolean => isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT') && isSpecialtyEditAction(action) &&
  (!intent || changesSpecialtyEpisode(patch, intent));

/** An intentional empty choice is a write even when the visible scalar was already empty. */
export const preserveExplicitEmptySpecialtyChoice = (
  patch: DailyRecordPatch,
  intent: SpecialtyManualIntent | null,
  record: DailyRecord
): DailyRecordPatch => {
  if (Object.keys(patch).length || !intent) return patch;
  const patient = intent.target === 'clinicalCrib'
    ? record.beds[intent.bedId]?.clinicalCrib : record.beds[intent.bedId];
  if (intent.value === '' && patient?.specialtyAssignment?.source === 'manual') return patch;
  const path = intent.target === 'clinicalCrib'
    ? `beds.${intent.bedId}.clinicalCrib.specialty`
    : `beds.${intent.bedId}.specialty`;
  return { [path]: intent.value } as DailyRecordPatch;
};
