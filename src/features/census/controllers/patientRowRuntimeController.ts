import type { PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface BuildPatientRowActionDispatcherParams {
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  bedId: string;
  patient: PatientData;
}

export const buildPatientRowActionDispatcher =
  ({ onAction, bedId, patient }: BuildPatientRowActionDispatcherParams) =>
  (action: PatientRowAction): void =>
    onAction(action, bedId, patient);

interface BuildPatientRowBedTypeTogglesParams {
  bedId: string;
  toggleBedType: (bedId: string) => void;
  updateClinicalCrib: (bedId: string, action: 'remove') => void;
}

export const buildPatientRowBedTypeToggles = ({
  bedId,
  toggleBedType,
  updateClinicalCrib,
}: BuildPatientRowBedTypeTogglesParams): {
  onToggleBedType: () => void;
  onUpdateClinicalCrib: (action: 'remove') => void;
} => ({
  onToggleBedType: () => toggleBedType(bedId),
  onUpdateClinicalCrib: action => updateClinicalCrib(bedId, action),
});
