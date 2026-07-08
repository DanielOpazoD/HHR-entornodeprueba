/**
 * Use case: re-assign (or clear) the patient associated with a prescription.
 *
 * Why this exists: the QR upload flow allows uploading "sin paciente
 * asignado" because some recipes are produced before admission. The visor
 * lets admins/clinicians later attach the prescription to the right bed +
 * patient as soon as the case is created. Same path also covers fixing
 * mistaken assignments and clearing a wrongly-assigned prescription.
 */

import {
  defaultPrescriptionPort,
  type PrescriptionPort,
} from '@/application/ports/prescriptionPort';
import type { PrescriptionAssignmentScope, PrescriptionRecord } from '@/types/prescriptionTypes';

export interface ReassignPrescriptionPatientInput {
  prescriptionId: string;
  hospitalId?: string;
  /**
   * Provide all three together to attach a patient. Provide all three as
   * `undefined` (or omit) to clear the existing assignment.
   */
  bedId?: string;
  patientName?: string;
  patientRut?: string;
  assignmentScope?: PrescriptionAssignmentScope;
  /** Email or display string of the actor making the change. */
  reassignedBy: string;
  /** Defaults to `new Date().toISOString()` when omitted. */
  reassignedAt?: string;
}

interface ReassignPrescriptionPatientDeps {
  prescriptionPort?: PrescriptionPort;
}

export const executeReassignPrescriptionPatient = async (
  input: ReassignPrescriptionPatientInput,
  dependencies: ReassignPrescriptionPatientDeps = {}
): Promise<PrescriptionRecord> => {
  const port = dependencies.prescriptionPort || defaultPrescriptionPort;
  return port.reassignPatient(
    input.prescriptionId,
    {
      bedId: input.bedId,
      patientName: input.patientName,
      patientRut: input.patientRut,
      assignmentScope: input.assignmentScope,
      reassignedBy: input.reassignedBy,
      reassignedAt: input.reassignedAt ?? new Date().toISOString(),
    },
    input.hospitalId
  );
};
