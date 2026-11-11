import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/domain/handoff/patientContracts';

export interface HandoffPatientTableRowPlan {
  basePatient: PatientData;
  shouldRender: boolean;
  shouldRenderMainRow: boolean;
  shouldRenderClinicalCrib: boolean;
}

const createEmptyPatient = (): PatientData =>
  ({
    bedId: '',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: Specialty.EMPTY,
    status: PatientStatus.EMPTY,
    admissionDate: '',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
  }) as PatientData;

export const resolveHandoffPatientRowPlan = (
  bed: BedDefinition,
  patient: PatientData | undefined,
  options: {
    isMedical: boolean;
    shouldShowPatient: (bedId: string) => boolean;
  }
): HandoffPatientTableRowPlan => {
  if (!patient) {
    return {
      basePatient: createEmptyPatient(),
      shouldRender: true,
      shouldRenderMainRow: true,
      shouldRenderClinicalCrib: false,
    };
  }

  if (options.isMedical && patient.isBlocked) {
    return {
      basePatient: patient,
      shouldRender: false,
      shouldRenderMainRow: false,
      shouldRenderClinicalCrib: false,
    };
  }

  const shouldShowMainRow =
    patient.isBlocked || !patient.patientName || options.shouldShowPatient(bed.id);

  if (!shouldShowMainRow) {
    return {
      basePatient: createEmptyPatient(),
      shouldRender: true,
      shouldRenderMainRow: true,
      shouldRenderClinicalCrib: false,
    };
  }

  return {
    basePatient: patient,
    shouldRender: true,
    shouldRenderMainRow: true,
    shouldRenderClinicalCrib: Boolean(patient.clinicalCrib?.patientName),
  };
};
