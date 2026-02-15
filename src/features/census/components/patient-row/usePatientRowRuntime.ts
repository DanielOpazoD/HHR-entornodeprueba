import { useCallback, useMemo } from 'react';

import type { BedDefinition, PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import { usePatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import { usePatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';
import {
  buildPatientRowActionDispatcher,
  buildPatientRowBedTypeToggles,
} from '@/features/census/controllers/patientRowRuntimeController';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';

interface UsePatientRowRuntimeParams {
  bed: BedDefinition;
  data: PatientData;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export const usePatientRowRuntime = ({
  bed,
  data,
  onAction,
}: UsePatientRowRuntimeParams): PatientRowRuntime => {
  const {
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    toggleBedType,
    confirm,
    alert,
  } = usePatientRowDependencies();
  const uiState = usePatientRowUiState();
  const { handlers, modalSavers } = usePatientRowHandlersModel({
    bedId: bed.id,
    documentType: data?.documentType,
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
  });

  const rowState = derivePatientRowState(data);

  const bedConfigActions = usePatientRowBedConfigActions({
    bedId: bed.id,
    isCunaMode: rowState.isCunaMode,
    hasCompanion: rowState.hasCompanion,
    hasClinicalCrib: rowState.hasClinicalCrib,
    updatePatient,
    updateClinicalCrib,
    confirm,
    alert,
  });

  const handleAction = useCallback(
    (action: PatientRowAction) =>
      buildPatientRowActionDispatcher({ onAction, bedId: bed.id, patient: data })(action),
    [onAction, bed.id, data]
  );

  const bedTypeToggles = useMemo(
    () =>
      buildPatientRowBedTypeToggles({
        bedId: bed.id,
        toggleBedType,
        updateClinicalCrib,
      }),
    [bed.id, toggleBedType, updateClinicalCrib]
  );

  return {
    bedTypeToggles,
    rowState,
    uiState,
    handlers,
    modalSavers,
    bedConfigActions,
    handleAction,
  };
};
