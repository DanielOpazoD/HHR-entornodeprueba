export interface ResolvePatientActionMenuViewParams {
  isBlocked: boolean;
  readOnly: boolean;
  hasHistoryAction: boolean;
  hasExamRequestAction: boolean;
}

export interface PatientActionMenuViewState {
  showDemographicsAction: boolean;
  showMenuTrigger: boolean;
  showHistoryAction: boolean;
  showClinicalSection: boolean;
  showExamRequestAction: boolean;
}

export const resolvePatientActionMenuViewState = ({
  isBlocked,
  readOnly,
  hasHistoryAction,
  hasExamRequestAction,
}: ResolvePatientActionMenuViewParams): PatientActionMenuViewState => {
  const showMenuTrigger = !readOnly;
  const showDemographicsAction = !isBlocked && !readOnly;
  const showClinicalSection = !isBlocked && !readOnly;
  const showHistoryAction = !readOnly && hasHistoryAction;

  return {
    showDemographicsAction,
    showMenuTrigger,
    showHistoryAction,
    showClinicalSection,
    showExamRequestAction: showClinicalSection && hasExamRequestAction,
  };
};

export const resolvePatientActionMenuPanelClassName = (align: 'top' | 'bottom'): string =>
  align === 'top' ? 'top-0' : 'bottom-0';
