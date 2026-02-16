import { useDailyRecordBedActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';

export interface PatientRowDependencies {
  updatePatient: ReturnType<typeof useDailyRecordBedActions>['updatePatient'];
  updatePatientMultiple: ReturnType<typeof useDailyRecordBedActions>['updatePatientMultiple'];
  updateClinicalCrib: ReturnType<typeof useDailyRecordBedActions>['updateClinicalCrib'];
  updateClinicalCribMultiple: ReturnType<
    typeof useDailyRecordBedActions
  >['updateClinicalCribMultiple'];
  toggleBedType: ReturnType<typeof useDailyRecordBedActions>['toggleBedType'];
  confirm: ReturnType<typeof useConfirmDialog>['confirm'];
  alert: ReturnType<typeof useConfirmDialog>['alert'];
}

export const usePatientRowDependencies = (): PatientRowDependencies => {
  const {
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    toggleBedType,
  } = useDailyRecordBedActions();
  const { confirm, alert } = useConfirmDialog();

  return {
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    toggleBedType,
    confirm,
    alert,
  };
};
