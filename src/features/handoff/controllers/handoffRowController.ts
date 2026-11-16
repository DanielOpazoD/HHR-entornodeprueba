import type { PatientData } from '@/types/domain/patient';

export const resolveHandoffRowReadOnly = ({
  readOnly,
  noteField,
  canEditField,
}: {
  readOnly: boolean;
  noteField: keyof PatientData;
  canEditField: (field: string) => boolean;
}): boolean => readOnly || !canEditField(noteField as string);
