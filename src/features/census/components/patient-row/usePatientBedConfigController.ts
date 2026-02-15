import { MouseEvent, useCallback } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import type { MaybePromiseVoid, PatientBedConfigCallbacks } from './patientRowContracts';
import { runPatientRowAsyncActionSafely } from '@/features/census/controllers/patientRowAsyncActionController';
import { buildPatientBedConfigCardState } from '@/features/census/controllers/patientBedConfigCardController';

interface UsePatientBedConfigControllerParams extends PatientBedConfigCallbacks {
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
  onToggleMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onUpdateClinicalCrib,
}: UsePatientBedConfigControllerParams) => {
  const { isOpen: isMenuOpen, menuRef, toggle } = useDropdownMenu();

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

  const handleToggleMode = useCallback(() => {
    runAsyncSafe(onToggleMode);
  }, [onToggleMode, runAsyncSafe]);

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
    viewState,
    handleToggleMode,
    handleToggleCompanion,
    handleToggleClinicalCrib,
    handleRemoveClinicalCrib,
  };
};
