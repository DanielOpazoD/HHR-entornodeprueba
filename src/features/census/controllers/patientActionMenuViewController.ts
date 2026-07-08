export interface ResolvePatientActionMenuViewParams {
  isBlocked: boolean;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  accessProfile?: 'default' | 'specialist';
  hasPatientIdentity?: boolean;
  hasHistoryAction: boolean;
  hasClinicalDocumentsAction: boolean;
  hasExamRequestAction: boolean;
  hasImagingRequestAction: boolean;
  hasMedicalIndicationsAction?: boolean;
}

export interface PatientActionMenuViewState {
  showDemographicsAction: boolean;
  showMenuTrigger: boolean;
  showHistoryAction: boolean;
  showUtilityActions: boolean;
  showClinicalSection: boolean;
  showBuiltInClinicalActions: boolean;
  showClinicalDocumentsAction: boolean;
  showExamRequestAction: boolean;
  showImagingRequestAction: boolean;
  showMedicalIndicationsAction: boolean;
}

export const resolvePatientActionMenuViewState = ({
  isBlocked,
  readOnly,
  clinicalEditingDisabled = false,
  accessProfile = 'default',
  hasPatientIdentity = true,
  hasHistoryAction,
  hasClinicalDocumentsAction,
  hasExamRequestAction,
  hasImagingRequestAction,
  hasMedicalIndicationsAction,
}: ResolvePatientActionMenuViewParams): PatientActionMenuViewState => {
  if (accessProfile === 'specialist') {
    const showClinicalSection = !isBlocked;
    const showClinicalDocumentsAction = showClinicalSection && hasClinicalDocumentsAction;
    const showExamRequestAction = showClinicalSection && hasExamRequestAction;
    const showImagingRequestAction = showClinicalSection && hasImagingRequestAction;
    const showMedicalIndicationsAction =
      showClinicalSection && Boolean(hasMedicalIndicationsAction);

    return {
      showDemographicsAction: !isBlocked,
      showMenuTrigger: false,
      showHistoryAction: false,
      showUtilityActions: false,
      showClinicalSection,
      showBuiltInClinicalActions: false,
      showClinicalDocumentsAction,
      showExamRequestAction,
      showImagingRequestAction,
      showMedicalIndicationsAction,
    };
  }

  const canEditClinical = !readOnly && !clinicalEditingDisabled;
  const showUtilityActions = canEditClinical;
  const showMenuTrigger =
    !readOnly &&
    hasPatientIdentity &&
    (canEditClinical || hasHistoryAction || hasClinicalDocumentsAction);
  const showDemographicsAction = !isBlocked && canEditClinical;
  const showClinicalSection = !isBlocked && (canEditClinical || hasClinicalDocumentsAction);
  const showHistoryAction = !readOnly && hasHistoryAction;

  return {
    showDemographicsAction,
    showMenuTrigger,
    showHistoryAction,
    showUtilityActions,
    showClinicalSection,
    showBuiltInClinicalActions: showClinicalSection && canEditClinical,
    showClinicalDocumentsAction: showClinicalSection && hasClinicalDocumentsAction,
    showExamRequestAction: canEditClinical && showClinicalSection && hasExamRequestAction,
    showImagingRequestAction: canEditClinical && showClinicalSection && hasImagingRequestAction,
    showMedicalIndicationsAction:
      canEditClinical && showClinicalSection && Boolean(hasMedicalIndicationsAction),
  };
};

export const resolvePatientActionMenuPanelClassName = (align: 'top' | 'bottom'): string =>
  align === 'top' ? 'top-0' : 'bottom-0';
