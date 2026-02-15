import { useEmptyBedActivation } from '@/features/census/components/useEmptyBedActivation';
import { useCensusTableModel } from '@/features/census/hooks/useCensusTableModel';
import { useCensusColumnResize } from '@/features/census/hooks/useCensusColumnResize';
import { useCensusTableDependencies } from '@/features/census/hooks/useCensusTableDependencies';

interface UseCensusTableViewModelParams {
  currentDateString: string;
}

export const useCensusTableViewModel = ({ currentDateString }: UseCensusTableViewModelParams) => {
  const {
    beds,
    staff,
    overrides,
    resetDay,
    updatePatient,
    handleRowAction,
    confirm,
    warning,
    role,
    config,
    isEditMode,
    updateColumnWidth,
    diagnosisMode,
    toggleDiagnosisMode,
  } = useCensusTableDependencies();
  const { activateEmptyBed } = useEmptyBedActivation({ updatePatient });
  const { columns } = config;

  const model = useCensusTableModel({
    currentDateString,
    role,
    beds,
    activeExtraBeds: staff?.activeExtraBeds || [],
    overrides,
    columns,
    resetDay,
    confirm,
    warning,
  });

  const { handleColumnResize } = useCensusColumnResize({ updateColumnWidth });

  return {
    beds,
    handleRowAction,
    diagnosisMode,
    toggleDiagnosisMode,
    activateEmptyBed,
    columns,
    isEditMode,
    handleColumnResize,
    ...model,
  };
};
