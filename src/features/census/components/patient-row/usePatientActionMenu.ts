import { useCallback, useMemo } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import {
  getVisibleUtilityActions,
  type UtilityActionConfig,
} from '@/features/census/components/patient-row/patientActionMenuConfig';
import { resolvePatientActionMenuViewState } from '@/features/census/controllers/patientActionMenuViewController';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

interface UsePatientActionMenuParams {
  isBlocked: boolean;
  readOnly: boolean;
  onAction: (action: PatientRowAction) => void;
  onViewHistory?: () => void;
  onViewExamRequest?: () => void;
}

interface UsePatientActionMenuResult {
  isOpen: boolean;
  menuRef: ReturnType<typeof useDropdownMenu>['menuRef'];
  viewState: ReturnType<typeof resolvePatientActionMenuViewState>;
  utilityActions: UtilityActionConfig[];
  toggle: () => void;
  close: () => void;
  handleAction: (action: PatientRowAction) => void;
  handleViewHistory: () => void;
  handleViewExamRequest: () => void;
}

export const usePatientActionMenu = ({
  isBlocked,
  readOnly,
  onAction,
  onViewHistory,
  onViewExamRequest,
}: UsePatientActionMenuParams): UsePatientActionMenuResult => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();

  const utilityActions = useMemo(() => getVisibleUtilityActions(isBlocked), [isBlocked]);
  const viewState = useMemo(
    () =>
      resolvePatientActionMenuViewState({
        isBlocked,
        readOnly,
        hasHistoryAction: typeof onViewHistory === 'function',
        hasExamRequestAction: typeof onViewExamRequest === 'function',
      }),
    [isBlocked, onViewExamRequest, onViewHistory, readOnly]
  );

  const handleAction = useCallback(
    (action: PatientRowAction) => {
      onAction(action);
      close();
    },
    [close, onAction]
  );

  const handleViewHistory = useCallback(() => {
    onViewHistory?.();
    close();
  }, [close, onViewHistory]);

  const handleViewExamRequest = useCallback(() => {
    onViewExamRequest?.();
    close();
  }, [close, onViewExamRequest]);

  return {
    isOpen,
    menuRef,
    viewState,
    utilityActions,
    toggle,
    close,
    handleAction,
    handleViewHistory,
    handleViewExamRequest,
  };
};
