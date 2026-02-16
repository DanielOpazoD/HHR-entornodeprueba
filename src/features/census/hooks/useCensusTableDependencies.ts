import {
  useDailyRecordBedActions,
  useDailyRecordBeds,
  useDailyRecordDayActions,
  useDailyRecordOverrides,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useDiagnosisMode } from '@/features/census/hooks/useDiagnosisMode';

export interface CensusTableDependencies {
  beds: ReturnType<typeof useDailyRecordBeds>;
  staff: ReturnType<typeof useDailyRecordStaff>;
  overrides: ReturnType<typeof useDailyRecordOverrides>;
  resetDay: ReturnType<typeof useDailyRecordDayActions>['resetDay'];
  updatePatient: ReturnType<typeof useDailyRecordBedActions>['updatePatient'];
  handleRowAction: ReturnType<typeof useCensusActionCommands>['handleRowAction'];
  confirm: ReturnType<typeof useConfirmDialog>['confirm'];
  warning: ReturnType<typeof useNotification>['warning'];
  role: ReturnType<typeof useAuth>['role'];
  config: ReturnType<typeof useTableConfig>['config'];
  isEditMode: ReturnType<typeof useTableConfig>['isEditMode'];
  updateColumnWidth: ReturnType<typeof useTableConfig>['updateColumnWidth'];
  diagnosisMode: ReturnType<typeof useDiagnosisMode>['diagnosisMode'];
  toggleDiagnosisMode: ReturnType<typeof useDiagnosisMode>['toggleDiagnosisMode'];
}

export const useCensusTableDependencies = (): CensusTableDependencies => {
  const beds = useDailyRecordBeds();
  const staff = useDailyRecordStaff();
  const overrides = useDailyRecordOverrides();
  const { resetDay } = useDailyRecordDayActions();
  const { updatePatient } = useDailyRecordBedActions();
  const { handleRowAction } = useCensusActionCommands();
  const { confirm } = useConfirmDialog();
  const { warning } = useNotification();
  const { role } = useAuth();
  const { config, isEditMode, updateColumnWidth } = useTableConfig();
  const { diagnosisMode, toggleDiagnosisMode } = useDiagnosisMode();

  return {
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
  };
};
