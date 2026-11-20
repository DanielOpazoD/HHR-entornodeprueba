import { useMemo } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import type { UtilityActionConfig } from '@/features/census/components/patient-row/patientActionMenuConfig';
import {
  buildPatientActionMenuModel,
  resolvePatientActionMenuCallbackAvailability,
} from '@/features/census/controllers/patientActionMenuController';
import { buildPatientActionMenuInteractionHandlers } from '@/features/census/controllers/patientActionMenuInteractionController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
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
  allowedActions?: readonly PatientRowAction[];
}

interface UsePatientActionMenuResult {
  isOpen: boolean;
  menuRef: ReturnType<typeof useDropdownMenu>['menuRef'];
  binding: PatientActionMenuBinding;
  utilityActions: UtilityActionConfig[];
  toggle: () => void;
  close: () => void;
  handleAction: (action: PatientRowAction) => void;
  handleViewHistory: () => void;
  handleViewClinicalDocuments: () => void;
  handleViewExamRequest: () => void;
  handleViewImagingRequest: () => void;
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
  allowedActions,
}: UsePatientActionMenuParams): UsePatientActionMenuResult => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();

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
        }),
        allowedActions,
      }),
    [
      align,
      allowedActions,
      indicators,
      isBlocked,
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewImagingRequest,
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
        close,
      }),
    [
      close,
      onAction,
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewHistory,
      onViewImagingRequest,
    ]
  );

  return {
    isOpen,
    menuRef,
    binding: menuModel.binding,
    utilityActions: menuModel.utilityActions,
    toggle,
    close,
    ...interactions,
  };
};
