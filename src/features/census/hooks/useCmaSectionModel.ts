import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
import { resolveCmaSectionState } from '@/features/census/controllers/censusCmaSectionController';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';
import { useCmaSectionActions } from '@/features/census/hooks/useCmaSectionActions';
import type { CensusMovementSectionModel } from '@/features/census/types/censusMovementSectionModelTypes';

interface UseCmaSectionModelParams {
  cma: CMAData[] | null | undefined;
  confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
  notifyError: (title: string, message: string) => void;
  updateCMA: (id: string, fields: Partial<CMAData>) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  deleteCMA: (id: string) => void;
  undoCMA?: (item: CMAData) => void;
  convertCmaToHomeDischarge: (id: string) => void;
}

interface UseCmaSectionModelResult extends CensusMovementSectionModel<CMAData> {
  handleUpdate: (id: string, updates: Partial<CMAData>) => void;
  handleUndo: (item: CMAData) => Promise<void>;
  handleDelete: (item: CMAData) => Promise<void>;
  handleConvertToDischarge: (item: CMAData) => Promise<void>;
}

export const useCmaSectionModel = ({
  cma,
  confirm,
  notifyError,
  updateCMA,
  updatePatientMultiple,
  deleteCMA,
  undoCMA,
  convertCmaToHomeDischarge,
}: UseCmaSectionModelParams): UseCmaSectionModelResult => {
  const sectionState = resolveCmaSectionState(cma);
  const { handleUpdate, handleUndo, handleDelete, handleConvertToDischarge } = useCmaSectionActions(
    {
      confirm,
      notifyError,
      updateCMA,
      updatePatientMultiple,
      deleteCMA,
      undoCMA,
      convertCmaToHomeDischarge,
    }
  );

  return {
    isRenderable: sectionState.isRenderable,
    isEmpty: sectionState.isEmpty,
    items: sectionState.cma,
    handleUpdate,
    handleUndo,
    handleDelete,
    handleConvertToDischarge,
  };
};
