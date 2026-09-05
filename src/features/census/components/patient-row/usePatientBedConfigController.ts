import { MouseEvent, useCallback } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import type { PatientBedConfigCallbacks } from './patientRowBedConfigContracts';
import type { MaybePromiseVoid } from './patientRowUiContracts';
import { runPatientRowAsyncActionSafely } from '@/features/census/controllers/patientRowAsyncActionController';
import { buildPatientBedConfigCardState } from '@/features/census/controllers/patientBedConfigCardController';

interface UsePatientBedConfigControllerParams extends Omit<
  PatientBedConfigCallbacks,
  'onToggleMode'
> {
  admissionDate?: string;
  currentDateString: string;
  patientName?: string;
  isBlocked: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  isCunaMode: boolean;
  readOnly: boolean;
}

export const usePatientBedConfigController = ({
  admissionDate,
  currentDateString,
  patientName,
  isBlocked,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  readOnly,
  onToggleCompanion,
  onToggleClinicalCrib,
  onUpdateClinicalCrib,
}: UsePatientBedConfigControllerParams) => {
  const { isOpen: isMenuOpen, menuRef, toggle, close } = useDropdownMenu();

  const viewState = buildPatientBedConfigCardState({
    admissionDate,
    currentDateString,
    patientName,
    isBlocked,
    hasCompanion,
    hasClinicalCrib,
    isCunaMode,
    readOnly,
  });

  const runAsyncSafe = useCallback(
    (action: () => MaybePromiseVoid) => runPatientRowAsyncActionSafely(action),
    []
  );

  const handleToggleCompanion = useCallback(() => {
    runAsyncSafe(onToggleCompanion);
  }, [onToggleCompanion, runAsyncSafe]);

  const handleToggleClinicalCrib = useCallback(() => {
    onToggleClinicalCrib();
  }, [onToggleClinicalCrib]);

  const handleRemoveClinicalCrib = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onUpdateClinicalCrib('remove');
    },
    [onUpdateClinicalCrib]
  );

  return {
    isMenuOpen,
    menuRef,
    toggleMenu: toggle,
    closeMenu: close,
    viewState,
    handleToggleCompanion,
    handleToggleClinicalCrib,
    handleRemoveClinicalCrib,
  };
};
