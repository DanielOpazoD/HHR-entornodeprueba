import React, { Suspense, lazy } from 'react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import {
  buildPatientRowOrbitalQuickActionItems,
  dispatchPatientRowOrbitalQuickAction,
  hasPatientRowOrbitalQuickActions,
  type PatientRowOrbitalQuickActionCallbacks,
  type PatientRowOrbitalQuickActionsAvailability,
  type PatientRowOrbitalQuickActionBadges,
} from '@/features/census/controllers/patientRowOrbitalQuickActionsController';
import {
  ACTION_ROW_HEIGHT,
  ACTION_STACK_GAP,
  ACTION_STACK_TOP,
  CLOSED_WRAPPER_SIZE,
  OPEN_WRAPPER_WIDTH,
  TRIGGER_CENTER_OFFSET,
  TRIGGER_CENTER_Y_OPEN,
} from '@/features/census/components/patient-row/patientRowOrbitalQuickActionLayout';
import { usePatientRowOrbitalLauncherRuntime } from '@/features/census/components/patient-row/usePatientRowOrbitalLauncherRuntime';

const LazyPatientRowOrbitalQuickActionsPortal = lazy(() =>
  import('@/features/census/components/patient-row/PatientRowOrbitalQuickActionsPortal').then(
    module => ({
      default: module.PatientRowOrbitalQuickActionsPortal,
    })
  )
);

interface PatientRowOrbitalQuickActionsProps
  extends PatientRowOrbitalQuickActionsAvailability, PatientRowOrbitalQuickActionCallbacks {
  badges?: PatientRowOrbitalQuickActionBadges;
  /** Names the turtle of one bed, e.g. `clinical-topics-trigger-R1`. */
  triggerTestId?: string;
}

export const PatientRowOrbitalQuickActions: React.FC<PatientRowOrbitalQuickActionsProps> = ({
  showClinicalPanelAction,
  showLaboratoryAction,
  showImagingAction,
  showClinicalDocumentsAction,
  showClinicalExplorerAction,
  badges,
  triggerTestId,
  ...callbacks
}) => {
  const { isOpen, menuRef, setIsOpen, toggle, close } = useDropdownMenu();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const actionButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [activeActionIndex, setActiveActionIndex] = React.useState(0);

  const availability = React.useMemo(
    () => ({
      showClinicalPanelAction,
      showLaboratoryAction,
      showImagingAction,
      showClinicalDocumentsAction,
      showClinicalExplorerAction,
    }),
    [
      showClinicalPanelAction,
      showLaboratoryAction,
      showImagingAction,
      showClinicalDocumentsAction,
      showClinicalExplorerAction,
    ]
  );

  const orbitalItems = React.useMemo(
    () => buildPatientRowOrbitalQuickActionItems(availability, badges),
    [availability, badges]
  );

  const hasQuickActions = hasPatientRowOrbitalQuickActions(availability);
  const openWrapperHeight =
    ACTION_STACK_TOP +
    orbitalItems.length * ACTION_ROW_HEIGHT +
    Math.max(0, orbitalItems.length - 1) * ACTION_STACK_GAP +
    20;
  const launcherWrapperWidth = isOpen ? OPEN_WRAPPER_WIDTH : CLOSED_WRAPPER_SIZE;
  const launcherWrapperHeight = isOpen ? openWrapperHeight : CLOSED_WRAPPER_SIZE;
  const triggerCenterX = CLOSED_WRAPPER_SIZE / 2;
  const triggerCenterY = isOpen ? TRIGGER_CENTER_Y_OPEN : CLOSED_WRAPPER_SIZE / 2;
  const {
    anchorRef,
    phase,
    position,
    showTrigger,
    handleLauncherMouseEnter,
    handleLauncherMouseLeave,
  } = usePatientRowOrbitalLauncherRuntime({
    hasQuickActions,
    isOpen,
    launcherOffset: TRIGGER_CENTER_OFFSET,
    wrapperWidth: launcherWrapperWidth,
    wrapperHeight: launcherWrapperHeight,
    triggerCenterX,
    triggerCenterY,
  });

  React.useEffect(() => {
    if (!isOpen) {
      setActiveActionIndex(0);
      actionButtonRefs.current = [];
    }
  }, [isOpen]);

  const focusActionAtIndex = React.useCallback(
    (index: number) => {
      if (!orbitalItems.length) {
        return;
      }

      const nextIndex = (index + orbitalItems.length) % orbitalItems.length;
      setActiveActionIndex(nextIndex);
      window.requestAnimationFrame(() => {
        actionButtonRefs.current[nextIndex]?.focus();
      });
    },
    [orbitalItems.length]
  );

  const openMenuAndFocus = React.useCallback(
    (targetIndex = 0) => {
      setIsOpen(true);
      focusActionAtIndex(targetIndex);
    },
    [focusActionAtIndex, setIsOpen]
  );

  const handleItemClick = (itemId: (typeof orbitalItems)[number]['id']) => {
    dispatchPatientRowOrbitalQuickAction(itemId, callbacks);
    close();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!orbitalItems.length) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      openMenuAndFocus(0);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      openMenuAndFocus(orbitalItems.length - 1);
    }
  };

  const handleActionKeyDown = (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!orbitalItems.length) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusActionAtIndex(index + 1);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      focusActionAtIndex(index - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusActionAtIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusActionAtIndex(orbitalItems.length - 1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      window.requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  };

  if (!hasQuickActions) {
    return null;
  }

  return (
    <>
      <span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      <Suspense fallback={null}>
        <LazyPatientRowOrbitalQuickActionsPortal
          actionButtonRefs={actionButtonRefs}
          activeActionIndex={activeActionIndex}
          close={close}
          handleActionKeyDown={handleActionKeyDown}
          handleItemClick={handleItemClick}
          handleLauncherMouseEnter={handleLauncherMouseEnter}
          handleLauncherMouseLeave={handleLauncherMouseLeave}
          handleTriggerKeyDown={handleTriggerKeyDown}
          isOpen={isOpen}
          launcherWrapperHeight={launcherWrapperHeight}
          launcherWrapperWidth={launcherWrapperWidth}
          menuRef={menuRef}
          orbitalItems={orbitalItems}
          phase={phase}
          position={position}
          showTrigger={showTrigger}
          toggle={toggle}
          triggerCenterX={triggerCenterX}
          triggerCenterY={triggerCenterY}
          triggerRef={triggerRef}
          triggerTestId={triggerTestId}
        />
      </Suspense>
    </>
  );
};
