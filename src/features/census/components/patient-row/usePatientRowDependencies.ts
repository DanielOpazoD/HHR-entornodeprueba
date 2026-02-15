import { useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';

export interface PatientRowDependencies {
  updatePatient: ReturnType<typeof useDailyRecordActions>['updatePatient'];
  updatePatientMultiple: ReturnType<typeof useDailyRecordActions>['updatePatientMultiple'];
  updateClinicalCrib: ReturnType<typeof useDailyRecordActions>['updateClinicalCrib'];
  updateClinicalCribMultiple: ReturnType<
    typeof useDailyRecordActions
  >['updateClinicalCribMultiple'];
  toggleBedType: ReturnType<typeof useDailyRecordActions>['toggleBedType'];
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
  } = useDailyRecordActions();
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
