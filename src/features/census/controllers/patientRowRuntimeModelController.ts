import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';

import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { PatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';
import type { PatientRowDerivedState } from '@/features/census/controllers/patientRowStateController';

interface BuildPatientRowEditingRuntimeParamsInput {
  bed: Pick<BedDefinition, 'id'>;
  data: PatientData;
  currentDateString: string;
  isSubRow: boolean;
  dependencies: Pick<
    PatientRowDependencies,
    | 'updatePatient'
    | 'updatePatientMultiple'
    | 'clearPatient'
    | 'updateClinicalCrib'
    | 'updateClinicalCribMultiple'
  >;
}

export const buildPatientRowEditingRuntimeParams = ({
  bed,
  data,
  currentDateString,
  isSubRow,
  dependencies,
}: BuildPatientRowEditingRuntimeParamsInput) => ({
  bedId: bed.id,
  currentDateString,
  data,
  // The crib row's own data is the crib: its edits are scoped to that newborn's episode (ID-03).
  cribData: isSubRow ? data : data.clinicalCrib,
  documentType: data.documentType,
  updatePatient: dependencies.updatePatient,
  updatePatientMultiple: dependencies.updatePatientMultiple,
  clearPatient: dependencies.clearPatient,
  updateClinicalCrib: dependencies.updateClinicalCrib,
  updateClinicalCribMultiple: dependencies.updateClinicalCribMultiple,
});

interface BuildPatientRowInteractionRuntimeParamsInput {
  bed: Pick<BedDefinition, 'id'>;
  data: PatientData;
  getRecordLastUpdated?: () => string | undefined;
  isSubRow?: boolean;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  rowState: Pick<PatientRowDerivedState, 'isCunaMode' | 'hasCompanion' | 'hasClinicalCrib'>;
  dependencies: Pick<
    PatientRowDependencies,
    'updatePatient' | 'updateClinicalCrib' | 'toggleBedType' | 'confirm' | 'alert'
  >;
}

interface BuildPatientRowRuntimeHookParamsInput {
  bed: Pick<BedDefinition, 'id'>;
  data: PatientData;
  currentDateString: string;
  getRecordLastUpdated?: () => string | undefined;
  isSubRow?: boolean;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  rowState: Pick<PatientRowDerivedState, 'isCunaMode' | 'hasCompanion' | 'hasClinicalCrib'>;
  dependencies: Pick<
    PatientRowDependencies,
    | 'updatePatient'
    | 'updatePatientMultiple'
    | 'clearPatient'
    | 'updateClinicalCrib'
    | 'updateClinicalCribMultiple'
    | 'toggleBedType'
    | 'confirm'
    | 'alert'
  >;
}

export const buildPatientRowInteractionRuntimeParams = ({
  bed,
  data,
  getRecordLastUpdated,
  isSubRow = false,
  onAction,
  rowState,
  dependencies,
}: BuildPatientRowInteractionRuntimeParamsInput) => ({
  bedId: bed.id,
  data,
  getRecordLastUpdated,
  isSubRow,
  onAction,
  rowState,
  updatePatient: dependencies.updatePatient,
  updateClinicalCrib: dependencies.updateClinicalCrib,
  toggleBedType: dependencies.toggleBedType,
  confirm: dependencies.confirm,
  alert: dependencies.alert,
});

export const buildPatientRowRuntimeHookParams = ({
  bed,
  data,
  currentDateString,
  getRecordLastUpdated,
  isSubRow = false,
  onAction,
  rowState,
  dependencies,
}: BuildPatientRowRuntimeHookParamsInput) => ({
  editingRuntimeParams: buildPatientRowEditingRuntimeParams({
    bed,
    data,
    currentDateString,
    isSubRow,
    dependencies,
  }),
  interactionRuntimeParams: buildPatientRowInteractionRuntimeParams({
    bed,
    data,
    getRecordLastUpdated,
    isSubRow,
    onAction,
    rowState,
    dependencies,
  }),
});
