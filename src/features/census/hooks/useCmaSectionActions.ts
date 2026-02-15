import React from 'react';

import type { CMAData, PatientData } from '@/types';
import { executeUndoCmaController } from '@/features/census/controllers/censusCmaController';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

interface UseCmaSectionActionsParams {
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  notifyError: (title: string, message: string) => void;
  updateCMA: (id: string, fields: Partial<CMAData>) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  deleteCMA: (id: string) => void;
}

interface UseCmaSectionActionsResult {
  handleUpdate: (id: string, field: keyof CMAData, value: CMAData[keyof CMAData]) => void;
  handleUndo: (item: CMAData) => Promise<void>;
  handleDelete: (id: string) => void;
}

export const useCmaSectionActions = ({
  confirm,
  notifyError,
  updateCMA,
  updatePatientMultiple,
  deleteCMA,
}: UseCmaSectionActionsParams): UseCmaSectionActionsResult => {
  const handleUpdate = React.useCallback(
    (id: string, field: keyof CMAData, value: CMAData[keyof CMAData]) => {
      updateCMA(id, { [field]: value });
    },
    [updateCMA]
  );

  const handleUndo = React.useCallback(
    async (item: CMAData) => {
      const result = await executeUndoCmaController(item, {
        confirm,
        updatePatientMultiple,
        deleteCMA,
      });

      if (!result.ok) {
        notifyError('No se pudo deshacer', result.error.message);
      }
    },
    [confirm, deleteCMA, notifyError, updatePatientMultiple]
  );

  const handleDelete = React.useCallback(
    (id: string) => {
      deleteCMA(id);
    },
    [deleteCMA]
  );

  return {
    handleUpdate,
    handleUndo,
    handleDelete,
  };
};
