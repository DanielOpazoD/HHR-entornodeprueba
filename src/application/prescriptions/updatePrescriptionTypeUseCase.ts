/**
 * Use case: change the prescription type of an already-uploaded prescription. Useful when the
 * uploader picked the wrong category at scan time and a clinician corrects
 * it later from the visor.
 */

import {
  defaultPrescriptionPort,
  type PrescriptionPort,
} from '@/application/ports/prescriptionPort';
import type { PrescriptionRecord, PrescriptionType } from '@/types/prescriptionTypes';

export interface UpdatePrescriptionTypeInput {
  prescriptionId: string;
  prescriptionType: PrescriptionType;
  hospitalId?: string;
  /** Email or display string of the actor making the change. */
  updatedBy: string;
  /** Defaults to `new Date().toISOString()` when omitted. */
  updatedAt?: string;
}

interface UpdatePrescriptionTypeDeps {
  prescriptionPort?: PrescriptionPort;
}

export const executeUpdatePrescriptionType = async (
  input: UpdatePrescriptionTypeInput,
  dependencies: UpdatePrescriptionTypeDeps = {}
): Promise<PrescriptionRecord> => {
  const port = dependencies.prescriptionPort || defaultPrescriptionPort;
  return port.updateType(
    input.prescriptionId,
    {
      prescriptionType: input.prescriptionType,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    },
    input.hospitalId
  );
};
