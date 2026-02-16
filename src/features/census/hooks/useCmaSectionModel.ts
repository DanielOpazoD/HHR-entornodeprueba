import type { CMAData, PatientData } from '@/types';
import { resolveCmaSectionState } from '@/features/census/controllers/censusCmaSectionController';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import { useCmaSectionActions } from '@/features/census/hooks/useCmaSectionActions';
import type { CensusMovementSectionModel } from '@/features/census/types/censusMovementSectionModelTypes';

interface UseCmaSectionModelParams {
  cma: CMAData[] | null | undefined;
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  notifyError: (title: string, message: string) => void;
  updateCMA: (id: string, fields: Partial<CMAData>) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  deleteCMA: (id: string) => void;
}

interface UseCmaSectionModelResult extends CensusMovementSectionModel<CMAData> {
  handleUpdate: (id: string, field: keyof CMAData, value: CMAData[keyof CMAData]) => void;
  handleUndo: (item: CMAData) => Promise<void>;
  handleDelete: (id: string) => void;
}

export const useCmaSectionModel = ({
  cma,
  confirm,
  notifyError,
  updateCMA,
  updatePatientMultiple,
  deleteCMA,
}: UseCmaSectionModelParams): UseCmaSectionModelResult => {
  const sectionState = resolveCmaSectionState(cma);
  const { handleUpdate, handleUndo, handleDelete } = useCmaSectionActions({
    confirm,
    notifyError,
    updateCMA,
    updatePatientMultiple,
    deleteCMA,
  });

  return {
    isRenderable: sectionState.isRenderable,
    isEmpty: sectionState.isEmpty,
    items: sectionState.cma,
    handleUpdate,
    handleUndo,
    handleDelete,
  };
};
