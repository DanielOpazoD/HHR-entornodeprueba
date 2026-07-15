import React from 'react';

import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
import {
  executeDeleteCmaController,
  executeUndoCmaController,
} from '@/features/census/controllers/censusCmaController';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';
import { buildMovementTypeConversionConfirmDialog } from '@/features/census/controllers/censusMovementActionConfirmController';

interface UseCmaSectionActionsParams {
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  notifyError: (title: string, message: string) => void;
  updateCMA: (id: string, fields: Partial<CMAData>) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  deleteCMA: (id: string) => void;
  undoCMA?: (item: CMAData) => void;
  convertCmaToHomeDischarge: (id: string) => void;
  convertCmaToTransfer?: (id: string) => void;
}

interface UseCmaSectionActionsResult {
  handleUpdate: (id: string, updates: Partial<CMAData>) => void;
  handleUndo: (item: CMAData) => Promise<void>;
  handleDelete: (item: CMAData) => Promise<void>;
  handleConvertToDischarge: (item: CMAData) => Promise<void>;
  handleConvertToTransfer: (item: CMAData) => Promise<void>;
}

export const useCmaSectionActions = ({
  confirm,
  notifyError,
  updateCMA,
  updatePatientMultiple,
  deleteCMA,
  undoCMA,
  convertCmaToHomeDischarge,
  convertCmaToTransfer,
}: UseCmaSectionActionsParams): UseCmaSectionActionsResult => {
  const handleUpdate = React.useCallback(
    (id: string, updates: Partial<CMAData>) => {
      updateCMA(id, updates);
    },
    [updateCMA]
  );

  const handleUndo = React.useCallback(
    async (item: CMAData) => {
      const result = await executeUndoCmaController(item, {
        confirm,
        updatePatientMultiple,
        deleteCMA,
        undoCMA,
      });

      if (!result.ok) {
        notifyError('No se pudo deshacer', result.error.message);
      }
    },
    [confirm, deleteCMA, notifyError, undoCMA, updatePatientMultiple]
  );

  const handleDelete = React.useCallback(
    async (item: CMAData) => {
      const result = await executeDeleteCmaController(item, {
        confirm,
        deleteCMA,
      });

      if (!result.ok) {
        notifyError('No se pudo eliminar', result.error.message);
      }
    },
    [confirm, deleteCMA, notifyError]
  );

  const handleConvertToDischarge = React.useCallback(
    async (item: CMAData) => {
      let confirmed = false;
      try {
        confirmed = await confirm(
          buildMovementTypeConversionConfirmDialog('CMA', 'alta domicilio', item.patientName)
        );
      } catch {
        notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
        return;
      }

      if (confirmed) {
        convertCmaToHomeDischarge(item.id);
      }
    },
    [confirm, convertCmaToHomeDischarge, notifyError]
  );

  const handleConvertToTransfer = React.useCallback(
    async (item: CMAData) => {
      try {
        if (
          await confirm(
            buildMovementTypeConversionConfirmDialog('CMA', 'traslado', item.patientName)
          )
        ) {
          convertCmaToTransfer?.(item.id);
        }
      } catch {
        notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
      }
    },
    [confirm, convertCmaToTransfer, notifyError]
  );

  return {
    handleUpdate,
    handleUndo,
    handleDelete,
    handleConvertToDischarge,
    handleConvertToTransfer,
  };
};
