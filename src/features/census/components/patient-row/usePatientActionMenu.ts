import { useCallback, useMemo, useState } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import {
  buildPatientActionMenuModel,
  resolvePatientActionMenuCallbackAvailability,
} from '@/features/census/controllers/patientActionMenuController';
import { buildPatientActionMenuInteractionHandlers } from '@/features/census/controllers/patientActionMenuInteractionController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type {
  PatientActionMenuBinding,
  PatientActionMenuIndicators,
} from './patientRowActionContracts';
import type { RowMenuAlign } from './patientRowUiContracts';

interface UsePatientActionMenuParams {
  isBlocked: boolean;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  accessProfile?: CensusAccessProfile;
  hasPatientIdentity?: boolean;
  align?: RowMenuAlign;
  showCmaAction?: boolean;
  indicators?: Required<PatientActionMenuIndicators>;
  onAction: (action: PatientRowAction) => void;
  onViewHistory?: () => void;
  onViewClinicalDocuments?: () => void;
  onViewExamRequest?: () => void;
  onViewImagingRequest?: () => void;
  onViewMedicalIndications?: () => void;
}

interface UsePatientActionMenuResult {
  isOpen: boolean;
  isMedicalIndicationsOpen: boolean;
  menuRef: ReturnType<typeof useDropdownMenu>['menuRef'];
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
  toggle: () => void;
  close: () => void;
  openMedicalIndicationsDialog: () => void;
  closeMedicalIndicationsDialog: () => void;
  handleAction: (action: PatientRowAction) => void;
  handleViewHistory: () => void;
  handleViewClinicalDocuments: () => void;
  handleViewExamRequest: () => void;
  handleViewImagingRequest: () => void;
  handleViewMedicalIndications: () => void;
}

export const usePatientActionMenu = ({
  isBlocked,
  readOnly,
  clinicalEditingDisabled = false,
  accessProfile = 'default',
  hasPatientIdentity = true,
  align,
  showCmaAction,
  indicators,
  onAction,
  onViewHistory,
  onViewClinicalDocuments,
  onViewExamRequest,
  onViewImagingRequest,
  onViewMedicalIndications,
}: UsePatientActionMenuParams): UsePatientActionMenuResult => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const [isMedicalIndicationsOpen, setIsMedicalIndicationsOpen] = useState(false);

  const menuModel = useMemo(
    () =>
      buildPatientActionMenuModel({
        align,
        showCmaAction,
        isBlocked,
        readOnly,
        clinicalEditingDisabled,
        accessProfile,
        hasPatientIdentity,
        indicators,
        callbackAvailability: resolvePatientActionMenuCallbackAvailability({
          onViewHistory,
          onViewClinicalDocuments,
          onViewExamRequest,
          onViewImagingRequest,
          onViewMedicalIndications,
        }),
      }),
    [
      align,
      indicators,
      isBlocked,
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewImagingRequest,
      onViewMedicalIndications,
      onViewHistory,
      accessProfile,
      clinicalEditingDisabled,
      hasPatientIdentity,
      readOnly,
      showCmaAction,
    ]
  );

  const interactions = useMemo(
    () =>
      buildPatientActionMenuInteractionHandlers({
        onAction,
        onViewHistory,
        onViewClinicalDocuments,
        onViewExamRequest,
        onViewImagingRequest,
        onViewMedicalIndications,
        close,
      }),
    [
      close,
      onAction,
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewHistory,
      onViewImagingRequest,
      onViewMedicalIndications,
    ]
  );

  const openMedicalIndicationsDialog = useCallback(() => {
    interactions.handleViewMedicalIndications();
    setIsMedicalIndicationsOpen(true);
  }, [interactions]);

  const closeMedicalIndicationsDialog = useCallback(() => {
    setIsMedicalIndicationsOpen(false);
  }, []);

  return {
    isOpen,
    isMedicalIndicationsOpen,
    menuRef,
    binding: menuModel.binding,
    utilityActions: menuModel.utilityActions,
    toggle,
    close,
    openMedicalIndicationsDialog,
    closeMedicalIndicationsDialog,
    ...interactions,
  };
};
