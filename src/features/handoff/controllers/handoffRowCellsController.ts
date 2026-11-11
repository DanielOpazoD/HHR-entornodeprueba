import type { MedicalHandoffEntry, PatientData } from '@/types/domain/patient';

import { resolveMedicalObservationEntries } from '@/domain/handoff/patientView';
import { createMedicalHandoffEntry } from '@/domain/handoff/patientEntries';
import { PatientStatus } from '@/domain/handoff/patientContracts';
import type { MedicalBadgeVariant } from '@/shared/ui/medicalBadgeContracts';

export interface PendingMedicalEntryDraft {
  entry: MedicalHandoffEntry;
  expiresAt: number;
}

export const resolveHandoffStatusVariant = (
  status: PatientStatus | string | undefined
): MedicalBadgeVariant =>
  status === PatientStatus.GRAVE ? 'red' : status === PatientStatus.DE_CUIDADO ? 'orange' : 'green';

export const canToggleClinicalEvents = ({
  isSubRow,
  hasEvents,
  canEditEvents,
}: {
  isSubRow: boolean;
  hasEvents: boolean;
  canEditEvents: boolean;
}): boolean => !isSubRow && (canEditEvents || hasEvents);

export const shouldRenderClinicalEventsPanel = ({
  showEvents,
  canAdd,
  canUpdate,
  canDelete,
}: {
  showEvents: boolean;
  canAdd: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}): boolean => showEvents && canAdd && canUpdate && canDelete;

export interface ClinicalEventsCellState {
  statusVariant: MedicalBadgeVariant;
  canToggleEvents: boolean;
  shouldRenderEventsPanel: boolean;
  showStatusBadge: boolean;
}

export const resolveClinicalEventsCellState = ({
  patientStatus,
  isSubRow,
  hasEvents,
  canAdd,
  canUpdate,
  canDelete,
  showEvents,
  isMedical,
}: {
  patientStatus: PatientStatus | string | undefined;
  isSubRow: boolean;
  hasEvents: boolean;
  canAdd: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  showEvents: boolean;
  isMedical: boolean;
}): ClinicalEventsCellState => {
  const canToggleEvents = canToggleClinicalEvents({
    isSubRow,
    hasEvents,
    canEditEvents: canAdd,
  });
  const shouldRenderEventsPanel = shouldRenderClinicalEventsPanel({
    showEvents,
    canAdd,
    canUpdate,
    canDelete,
  });

  return {
    statusVariant: resolveHandoffStatusVariant(patientStatus),
    canToggleEvents,
    shouldRenderEventsPanel,
    showStatusBadge: !showEvents && !isMedical,
  };
};

export const pruneResolvedPendingMedicalEntryDrafts = ({
  entries,
  pendingEntryDrafts,
  now,
}: {
  entries: MedicalHandoffEntry[];
  pendingEntryDrafts: Record<string, PendingMedicalEntryDraft>;
  now: number;
}): Record<string, PendingMedicalEntryDraft> => {
  const next: Record<string, PendingMedicalEntryDraft> = {};

  for (const [entryId, pendingDraft] of Object.entries(pendingEntryDrafts)) {
    const matchingEntry = entries.find(entry => entry.id === entryId);
    const isResolved = matchingEntry?.note === pendingDraft.entry.note;
    const isExpired = pendingDraft.expiresAt <= now;
    if (!isResolved && !isExpired) {
      next[entryId] = pendingDraft;
    }
  }

  return next;
};

export const shouldAttemptPendingMedicalDraftPrune = (
  pendingEntryDrafts: Record<string, PendingMedicalEntryDraft>
): boolean => Object.keys(pendingEntryDrafts).length > 0;

export const resolveDisplayMedicalObservationEntries = ({
  entries,
  isFieldReadOnly,
  pendingEntryDrafts,
  now,
}: {
  entries: MedicalHandoffEntry[];
  isFieldReadOnly: boolean;
  pendingEntryDrafts: Record<string, PendingMedicalEntryDraft>;
  now: number;
}): MedicalHandoffEntry[] => {
  const activePendingDrafts = Object.values(pendingEntryDrafts).filter(
    pendingDraft => pendingDraft.expiresAt > now
  );

  if (entries.length === 0) {
    return !isFieldReadOnly && activePendingDrafts.length > 0
      ? activePendingDrafts.map(pendingDraft => pendingDraft.entry)
      : entries;
  }

  const pendingById = new Map(
    activePendingDrafts.map(pendingDraft => [pendingDraft.entry.id, pendingDraft.entry])
  );

  return entries.map(entry => {
    const pendingDraft = pendingById.get(entry.id);
    if (!pendingDraft || pendingDraft.note === entry.note) {
      return entry;
    }

    return {
      ...entry,
      note: pendingDraft.note,
    };
  });
};

export const shouldShowMedicalPrimaryNoteFallback = ({
  entriesCount,
  isFieldReadOnly,
  hasCreatePrimaryEntryAction,
}: {
  entriesCount: number;
  isFieldReadOnly: boolean;
  hasCreatePrimaryEntryAction: boolean;
}): boolean => entriesCount === 0 && !isFieldReadOnly && !hasCreatePrimaryEntryAction;

export type MedicalObservationEmptyState = 'create-entry' | 'primary-note' | 'empty';

export interface MedicalObservationCellState {
  displayEntries: MedicalHandoffEntry[];
  emptyState: MedicalObservationEmptyState;
  showPrimaryNoteFallback: boolean;
}

export const resolveMedicalObservationEmptyState = ({
  displayEntriesCount,
  isFieldReadOnly,
  hasCreatePrimaryEntryAction,
}: {
  displayEntriesCount: number;
  isFieldReadOnly: boolean;
  hasCreatePrimaryEntryAction: boolean;
}): MedicalObservationEmptyState => {
  if (displayEntriesCount > 0) {
    return 'empty';
  }

  if (!isFieldReadOnly && hasCreatePrimaryEntryAction) {
    return 'create-entry';
  }

  return shouldShowMedicalPrimaryNoteFallback({
    entriesCount: displayEntriesCount,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction,
  })
    ? 'primary-note'
    : 'empty';
};

export const resolveMedicalObservationCellState = ({
  entries,
  isFieldReadOnly,
  pendingEntryDrafts,
  hasCreatePrimaryEntryAction,
  now,
}: {
  entries: MedicalHandoffEntry[];
  isFieldReadOnly: boolean;
  pendingEntryDrafts: Record<string, PendingMedicalEntryDraft>;
  hasCreatePrimaryEntryAction: boolean;
  now: number;
}): MedicalObservationCellState => {
  const displayEntries = resolveDisplayMedicalObservationEntries({
    entries,
    isFieldReadOnly,
    pendingEntryDrafts,
    now,
  });
  const emptyState = resolveMedicalObservationEmptyState({
    displayEntriesCount: displayEntries.length,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction,
  });

  return {
    displayEntries,
    emptyState,
    showPrimaryNoteFallback: emptyState === 'primary-note',
  };
};

export const buildPendingMedicalEntryDraft = ({
  entryId,
  value,
  entries,
  pendingEntryDrafts,
  patient,
  specialtyOptions,
  expiresAt,
}: {
  entryId: string;
  value: string;
  entries: MedicalHandoffEntry[];
  pendingEntryDrafts: Record<string, PendingMedicalEntryDraft>;
  patient: PatientData;
  specialtyOptions: string[];
  expiresAt: number;
}): PendingMedicalEntryDraft => {
  const baseEntry =
    entries.find(entry => entry.id === entryId) ||
    pendingEntryDrafts[entryId]?.entry ||
    createMedicalHandoffEntry(patient.specialty || specialtyOptions[0] || '', {
      id: entryId,
    });

  return {
    expiresAt,
    entry: {
      ...baseEntry,
      id: entryId,
      specialty: baseEntry.specialty || patient.specialty || specialtyOptions[0] || '',
      note: value,
    },
  };
};

export const resolveNextPendingMedicalEntryDrafts = ({
  currentDrafts,
  entryId,
  value,
  entries,
  patient,
  specialtyOptions,
  expiresAt,
}: {
  currentDrafts: Record<string, PendingMedicalEntryDraft>;
  entryId: string;
  value: string;
  entries: MedicalHandoffEntry[];
  patient: PatientData;
  specialtyOptions: string[];
  expiresAt: number;
}): Record<string, PendingMedicalEntryDraft> => ({
  ...currentDrafts,
  [entryId]: buildPendingMedicalEntryDraft({
    entryId,
    value,
    entries,
    pendingEntryDrafts: currentDrafts,
    patient,
    specialtyOptions,
    expiresAt,
  }),
});

export { resolveMedicalObservationEntries };
