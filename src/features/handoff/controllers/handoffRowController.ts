import type { PatientData } from '@/types/domain/patient';

interface HandoffRowMedicalActions {
  onCreatePrimaryEntry?: () => void;
  onEntryNoteChange?: (entryId: string, value: string) => void;
  onEntrySpecialtyChange?: (entryId: string, specialty: string) => void;
  onEntryAdd?: () => void;
  onEntryDelete?: (entryId: string) => void;
  onRefreshAsCurrent?: (entryId: string) => void;
}

export const hasActiveMedicalMutationPaths = ({
  isMedical,
  onNoteChange,
  medicalActions,
}: {
  isMedical: boolean;
  onNoteChange?: ((value: string) => void) | null;
  medicalActions?: HandoffRowMedicalActions;
}): boolean =>
  Boolean(
    isMedical &&
    (onNoteChange ||
      medicalActions?.onCreatePrimaryEntry ||
      medicalActions?.onEntryNoteChange ||
      medicalActions?.onEntrySpecialtyChange ||
      medicalActions?.onEntryAdd ||
      medicalActions?.onEntryDelete ||
      medicalActions?.onRefreshAsCurrent)
  );

export const resolveHandoffRowReadOnly = ({
  readOnly,
  noteField,
  canEditField,
  hasMedicalMutationPaths,
}: {
  readOnly: boolean;
  noteField: keyof PatientData;
  canEditField: (field: string) => boolean;
  hasMedicalMutationPaths: boolean;
}): boolean => readOnly || (!canEditField(noteField as string) && !hasMedicalMutationPaths);

export const resolveMedicalEntryNoteChangeHandler = (
  onEntryNoteChange?: (entryId: string, value: string) => void
) =>
  onEntryNoteChange ??
  (() => {
    return undefined;
  });
