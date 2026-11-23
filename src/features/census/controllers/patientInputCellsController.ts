import type { ChangeEvent } from 'react';
import type { PatientData } from '@/types/domain/patient';

import { PatientInputSchema } from '@/schemas/inputSchemas';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';

type TextChangeDispatcher<TField extends string> = (
  field: TField
) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

export const buildSyntheticTextChangeEvent = (value: string): ChangeEvent<HTMLInputElement> =>
  ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

export const dispatchTextChangeValue = <TField extends string>(
  textChange: TextChangeDispatcher<TField>,
  field: TField,
  value: string
): void => {
  textChange(field)(buildSyntheticTextChangeEvent(value));
};

interface ResolvePatientInputCellsLockParams {
  readOnly: boolean;
  canEditField: ((field: keyof PatientData) => boolean) | null | undefined;
}

interface ResolvePatientRutErrorParams {
  documentType: PatientData['documentType'];
  rut: PatientData['rut'];
}

export const resolvePatientInputCellsLock = ({
  readOnly,
  canEditField,
}: ResolvePatientInputCellsLockParams): boolean => {
  if (isE2EEditableRecordOverrideEnabled()) {
    return false;
  }

  if (readOnly) {
    return true;
  }

  if (!canEditField) {
    return true;
  }

  return !canEditField('patientName');
};

export const resolvePatientRutValidationError = ({
  documentType,
  rut,
}: ResolvePatientRutErrorParams): boolean => {
  if (rut === '-') {
    return false;
  }

  if (documentType !== 'RUT' || !rut) {
    return false;
  }

  return !PatientInputSchema.shape.rut.safeParse(rut).success;
};
