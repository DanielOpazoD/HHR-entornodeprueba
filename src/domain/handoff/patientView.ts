import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';
import type { MedicalHandoffEntry, PatientData } from '@/domain/handoff/patientContracts';
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

export interface MedicalEntryMetadataViewModel {
  primaryLabel: string;
  printLabel: string;
  detailLines: string[];
  showInfoButton: boolean;
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

const resolveFormattedActorAndTimestamp = (
  actor: MedicalHandoffEntry['updatedBy'] | undefined,
  timestamp: string | undefined
): string =>
  [
    formatMedicalHandoffActorLabel(actor?.displayName || actor?.email),
    formatMedicalHandoffTimestamp(timestamp),
  ]
    .filter(Boolean)
    .join(' · ');

const areSameAuditActors = (
  left: MedicalHandoffEntry['updatedBy'] | undefined,
  right: MedicalHandoffEntry['updatedBy'] | undefined
): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.uid === right.uid || left.email === right.email;
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

export const resolveMedicalEntryMetadataViewModel = (
  entry: MedicalHandoffEntry,
  reportDate: string
): MedicalEntryMetadataViewModel => {
  const originalActor = entry.originalNoteBy || entry.updatedBy;
  const originalAt = entry.originalNoteAt || entry.updatedAt;
  const wasUpdatedToday = entry.updatedAt
    ? readClinicalTimestamp(entry.updatedAt)?.iso === reportDate
    : false;
  const currentActor =
    entry.currentStatusDate === reportDate
      ? entry.currentStatusBy || entry.updatedBy
      : wasUpdatedToday
        ? entry.updatedBy
        : undefined;
  const currentAt =
    entry.currentStatusDate === reportDate
      ? entry.currentStatusAt || entry.updatedAt
      : wasUpdatedToday
        ? entry.updatedAt
        : undefined;

  const originalLabel = resolveFormattedActorAndTimestamp(originalActor, originalAt);
  const currentLabel = resolveFormattedActorAndTimestamp(currentActor, currentAt);
  const hasDistinctCurrentEvent =
    Boolean(currentLabel) &&
    Boolean(originalLabel) &&
    (!areSameAuditActors(originalActor, currentActor) || originalAt !== currentAt);

  if (!hasDistinctCurrentEvent) {
    const primaryLabel = originalLabel || currentLabel;
    return {
      primaryLabel,
      printLabel: primaryLabel,
      detailLines: [],
      showInfoButton: false,
    };
  }

  return {
    primaryLabel: `Nota base: ${originalLabel}`,
    printLabel: `Nota base: ${originalLabel} | Vigente por: ${currentLabel}`,
    detailLines: [`Nota original: ${originalLabel}`, `Marcada como actual por: ${currentLabel}`],
    showInfoButton: true,
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
