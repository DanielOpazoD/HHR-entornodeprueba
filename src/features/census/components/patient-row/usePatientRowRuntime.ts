import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { derivePatientRowState } from '../../controllers/patientRowStateController';
import { usePatientRowDependencies } from './usePatientRowDependencies';
import type { PatientRowRuntime } from './patientRowRuntimeContracts';
import { usePatientRowEditingRuntime } from './usePatientRowEditingRuntime';
import { usePatientRowInteractionRuntime } from './usePatientRowInteractionRuntime';
import { buildPatientRowRuntime } from '../../controllers/patientRowRuntimeController';
import { buildPatientRowRuntimeHookParams } from '../../controllers/patientRowRuntimeModelController';

interface UsePatientRowRuntimeParams {
  bed: BedDefinition;
  data: PatientData;
  currentDateString: string;
  recordLastUpdated?: string;
  isSubRow?: boolean;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export const usePatientRowRuntime = ({
  bed,
  data,
  currentDateString,
  recordLastUpdated,
  isSubRow = false,
  onAction,
}: UsePatientRowRuntimeParams): PatientRowRuntime => {
  const {
    updatePatient,
    updatePatientMultiple,
    clearPatient,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    toggleBedType,
    confirm,
    alert,
  } = usePatientRowDependencies();
  const rowState = derivePatientRowState(data);
  const runtimeHookParams = buildPatientRowRuntimeHookParams({
    bed,
    data,
    currentDateString,
    recordLastUpdated,
    isSubRow,
    onAction,
    rowState,
    dependencies: {
      updatePatient,
      updatePatientMultiple,
      clearPatient,
      updateClinicalCrib,
      updateClinicalCribMultiple,
      toggleBedType,
      confirm,
      alert,
    },
  });
  const editingRuntime = usePatientRowEditingRuntime(runtimeHookParams.editingRuntimeParams);
  const interactionRuntime = usePatientRowInteractionRuntime(
    runtimeHookParams.interactionRuntimeParams
  );

  return buildPatientRowRuntime({
    rowState,
    interactionRuntime,
    editingRuntime,
  });
};
