import type { MedicalHandoffEntry, PatientData } from '@/types/domain/patient';

import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';

import {
  formatMedicalHandoffActorLabel,
  formatMedicalHandoffTimestamp,
  getPatientMedicalHandoffEntries,
} from './patientEntries';

export interface MedicalHandoffValidityViewModel {
  statusLabel: string;
  canRefreshAsCurrent: boolean;
  isActiveToday: boolean;
  isMuted: boolean;
  tooltipLabel: string;
  canConfirm: boolean;
}

export const resolveMedicalEntryInlineMeta = (entry: MedicalHandoffEntry): string => {
  // After validation, show the most recent actor and timestamp (updatedBy/updatedAt),
  // not the original. This makes a validated note look like it was written now.
  const actor = formatMedicalHandoffActorLabel(
    entry.updatedBy?.displayName ||
      entry.updatedBy?.email ||
      entry.originalNoteBy?.displayName ||
      entry.originalNoteBy?.email
  );
  const timestamp = formatMedicalHandoffTimestamp(entry.updatedAt || entry.originalNoteAt);
  return [actor, timestamp].filter(Boolean).join(' · ');
};

export const resolveMedicalHandoffValidityViewModel = (
  entry: MedicalHandoffEntry,
  reportDate: string
): MedicalHandoffValidityViewModel => {
  // A note is "active today" if either:
  // 1. updatedAt matches the reportDate (note was written/edited on this day), OR
  // 2. currentStatusDate matches the reportDate (note was validated for this day)
  const wasUpdatedToday =
    readClinicalTimestamp(entry.updatedAt || '')?.iso === reportDate ||
    entry.currentStatusDate === reportDate;
  const statusLabel = wasUpdatedToday ? 'Nota vigente' : 'Nota: pendiente de actualizar';
  const canRefreshAsCurrent = Boolean(entry.note.trim());

  return {
    statusLabel,
    canRefreshAsCurrent,
    isActiveToday: wasUpdatedToday,
    isMuted: !wasUpdatedToday,
    tooltipLabel: statusLabel,
    canConfirm: canRefreshAsCurrent,
  };
};

export const resolveMedicalObservationEntries = ({
  patient,
  isFieldReadOnly: _isFieldReadOnly,
  hasCreatePrimaryEntryAction: _hasCreatePrimaryEntryAction,
}: {
  patient: PatientData;
  isFieldReadOnly: boolean;
  hasCreatePrimaryEntryAction: boolean;
}): MedicalHandoffEntry[] => {
  const persistedEntries = getPatientMedicalHandoffEntries(patient);
  if (persistedEntries.length > 0) {
    return persistedEntries;
  }

  return [];
};
