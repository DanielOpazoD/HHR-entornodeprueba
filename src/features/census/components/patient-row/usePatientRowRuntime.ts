import { useCallback } from 'react';

import type { BedDefinition, BedType, PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import { usePatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';
import { usePatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';

interface UsePatientRowRuntimeParams {
  bed: BedDefinition;
  data: PatientData;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export interface PatientRowRuntime {
  bedTypeToggles: {
    onToggleBedType: () => void;
    onUpdateClinicalCrib: (action: 'remove') => void;
  };
  rowState: ReturnType<typeof derivePatientRowState>;
  uiState: ReturnType<typeof usePatientRowUiState>;
  handlers: ReturnType<typeof usePatientRowChangeHandlers>;
  modalSavers: {
    onSaveDemographics: (fields: Partial<PatientData>) => void;
    onSaveCribDemographics: (fields: Partial<PatientData>) => void;
  };
  bedConfigActions: ReturnType<typeof usePatientRowBedConfigActions>;
  handleAction: (action: PatientRowAction) => void;
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

  const {
    handleTextChange,
    handleCheckboxChange,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleDeviceHistoryChange,
    handleDemographicsSave,
    toggleDocumentType,
    handleDeliveryRouteChange,
  } = usePatientRowMainInputHandlers({
    bedId: bed.id,
    documentType: data?.documentType,
    updatePatient,
    updatePatientMultiple,
  });

  const {
    handleCribTextChange,
    handleCribCheckboxChange,
    handleCribDevicesChange,
    handleCribDeviceDetailsChange,
    handleCribDeviceHistoryChange,
    handleCribDemographicsSave,
  } = usePatientRowCribInputHandlers({
    bedId: bed.id,
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
    (action: PatientRowAction) => {
      onAction(action, bed.id, data);
    },
    [onAction, bed.id, data]
  );

  const handlers = usePatientRowChangeHandlers({
    handleTextChange,
    handleCheckboxChange,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleDeviceHistoryChange,
    handleDemographicsSave,
    toggleDocumentType,
    handleDeliveryRouteChange,
    handleCribTextChange,
    handleCribCheckboxChange,
    handleCribDevicesChange,
    handleCribDeviceDetailsChange,
    handleCribDeviceHistoryChange,
    handleCribDemographicsSave,
  });

  const onToggleBedType = useCallback(() => toggleBedType(bed.id), [bed.id, toggleBedType]);
  const onUpdateClinicalCrib = useCallback(
    (action: 'remove') => {
      updateClinicalCrib(bed.id, action);
    },
    [bed.id, updateClinicalCrib]
  );

  return {
    bedTypeToggles: {
      onToggleBedType,
      onUpdateClinicalCrib,
    },
    rowState,
    uiState,
    handlers,
    modalSavers: {
      onSaveDemographics: handleDemographicsSave,
      onSaveCribDemographics: handleCribDemographicsSave,
    },
    bedConfigActions,
    handleAction,
  };
};
