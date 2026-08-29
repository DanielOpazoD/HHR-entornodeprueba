import { useCallback } from 'react';
import {
  executeToggleBedModeController,
  executeToggleClinicalCribController,
  executeToggleCompanionCribController,
} from '@/features/census/controllers/patientRowBedConfigRuntimeController';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';

interface UsePatientRowBedConfigActionsParams {
  bedId: string;
  isCunaMode: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  updatePatient: (
    bedId: string,
    field: 'bedMode' | 'hasCompanionCrib',
    value: 'Cama' | 'Cuna' | boolean
  ) => void;
  updateClinicalCrib: (bedId: string, field: 'create' | 'remove') => void;
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
}

export interface PatientRowBedConfigActions {
  toggleBedMode: () => Promise<void>;
  toggleCompanionCrib: () => Promise<void>;
  toggleClinicalCrib: () => void;
  removeClinicalCrib: () => Promise<void>;
}

export const usePatientRowBedConfigActions = ({
  bedId,
  isCunaMode,
  hasCompanion,
  hasClinicalCrib,
  updatePatient,
  updateClinicalCrib,
  confirm,
  alert,
}: UsePatientRowBedConfigActionsParams): PatientRowBedConfigActions => {
  const toggleBedMode = useCallback(async () => {
    await executeToggleBedModeController({
      bedId,
      isCunaMode,
      hasCompanion,
      actions: { updatePatient },
      dialogs: { confirm },
    });
  }, [bedId, confirm, hasCompanion, isCunaMode, updatePatient]);

  const toggleCompanionCrib = useCallback(async () => {
    await executeToggleCompanionCribController({
      bedId,
      isCunaMode,
      hasCompanion,
      actions: { updatePatient },
      dialogs: { alert },
    });
  }, [alert, bedId, hasCompanion, isCunaMode, updatePatient]);

  const toggleClinicalCrib = useCallback(() => {
    executeToggleClinicalCribController({
      bedId,
      hasClinicalCrib,
      actions: { updateClinicalCrib },
    });
  }, [bedId, hasClinicalCrib, updateClinicalCrib]);

  const removeClinicalCrib = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Limpiar cuna',
      message: '¿Está seguro de limpiar los datos de esta cuna?',
      confirmText: 'Sí, limpiar',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
    if (confirmed) {
      updateClinicalCrib(bedId, 'remove');
    }
  }, [bedId, confirm, updateClinicalCrib]);

  return {
    toggleBedMode,
    toggleCompanionCrib,
    toggleClinicalCrib,
    removeClinicalCrib,
  };
};
