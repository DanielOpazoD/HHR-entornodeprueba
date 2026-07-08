import type {
  PatientActionMenuBinding,
  PatientActionMenuIndicators,
} from '@/features/census/components/patient-row/patientRowActionContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import { EMPTY_PATIENT_ROW_INDICATORS } from '@/features/census/controllers/patientRowIndicatorsController';
import {
  resolvePatientActionMenuViewState,
  type ResolvePatientActionMenuViewParams,
} from '@/features/census/controllers/patientActionMenuViewController';

interface ResolvePatientActionMenuBindingParams extends ResolvePatientActionMenuViewParams {
  align?: RowMenuAlign;
  showCmaAction?: boolean;
  indicators?: Required<PatientActionMenuIndicators>;
}

export const resolvePatientActionMenuBinding = ({
  align = 'top',
  isBlocked,
  readOnly,
  clinicalEditingDisabled,
  accessProfile,
  showCmaAction = true,
  hasPatientIdentity,
  hasHistoryAction,
  hasClinicalDocumentsAction,
  hasExamRequestAction,
  hasImagingRequestAction,
  hasMedicalIndicationsAction,
  indicators,
}: ResolvePatientActionMenuBindingParams): PatientActionMenuBinding => ({
  align,
  isBlocked,
  readOnly,
  showCmaAction,
  accessProfile,
  indicators: indicators || EMPTY_PATIENT_ROW_INDICATORS,
  availability: resolvePatientActionMenuViewState({
    isBlocked,
    readOnly,
    clinicalEditingDisabled,
    accessProfile,
    hasPatientIdentity,
    hasHistoryAction,
    hasClinicalDocumentsAction,
    hasExamRequestAction,
    hasImagingRequestAction,
    hasMedicalIndicationsAction,
  }),
});
