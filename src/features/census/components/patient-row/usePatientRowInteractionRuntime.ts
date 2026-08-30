import { useMemo } from 'react';

import { usePatientRowUiState } from './usePatientRowUiState';
import { usePatientRowBedConfigActions } from './usePatientRowBedConfigActions';
import { buildPatientRowInteractionRuntime } from '../../controllers/patientRowRuntimeController';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { PatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';

interface UsePatientRowInteractionRuntimeParams {
  bedId: string;
  data: PatientData;
  recordLastUpdated?: string;
  isSubRow?: boolean;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  rowState: {
    isCunaMode: boolean;
    hasCompanion: boolean;
    hasClinicalCrib: boolean;
  };
  updatePatient: (
    bedId: string,
    field: 'bedMode' | 'hasCompanionCrib',
    value: 'Cama' | 'Cuna' | boolean
  ) => void;
  updateClinicalCrib: PatientRowDependencies['updateClinicalCrib'];
  toggleBedType: (bedId: string) => void;
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
}

export const usePatientRowInteractionRuntime = ({
  bedId,
  data,
  recordLastUpdated,
  isSubRow = false,
  onAction,
  rowState,
  updatePatient,
  updateClinicalCrib,
  toggleBedType,
  confirm,
  alert,
}: UsePatientRowInteractionRuntimeParams) => {
  const uiState = usePatientRowUiState();

  const bedConfigActions = usePatientRowBedConfigActions({
    bedId,
    isCunaMode: rowState.isCunaMode,
    hasCompanion: rowState.hasCompanion,
    hasClinicalCrib: rowState.hasClinicalCrib,
    clinicalCrib: isSubRow ? data : data.clinicalCrib,
    confirmedLastUpdated: recordLastUpdated,
    updatePatient,
    updateClinicalCrib,
    confirm,
    alert,
  });

  return useMemo(
    () =>
      buildPatientRowInteractionRuntime({
        uiState,
        bedConfigActions,
        onAction,
        bedId,
        patient: data,
        toggleBedType,
        updateClinicalCrib,
      }),
    [bedConfigActions, bedId, data, onAction, toggleBedType, uiState, updateClinicalCrib]
  );
};
