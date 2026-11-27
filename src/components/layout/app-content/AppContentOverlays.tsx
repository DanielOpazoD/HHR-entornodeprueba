import React from 'react';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import StorageStatusBadge from '@/components/layout/StorageStatusBadge';
import { PinLockScreen } from '@/components/security/PinLockScreen';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import { buildAppContentOverlayState } from '@/components/layout/app-content/appContentOverlaysController';
import { useReminderCenter } from '@/hooks/useReminders';

type OverlayState = ReturnType<typeof buildAppContentOverlayState>;

export interface AppContentOverlayViews {
  CensusEmailConfigModal: React.ComponentType<OverlayState['censusEmailModalProps']>;
  GlobalPatientSearchModal: React.ComponentType<OverlayState['patientSearchModalProps']>;
}

const ReminderModal = lazyWithRetry(() =>
  import('@/components/reminders/ReminderModal').then(m => ({ default: m.ReminderModal }))
);

const usePatientSearchShortcut = (togglePatientSearch: () => void): void => {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        togglePatientSearch();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePatientSearch]);
};

export interface AppContentOverlaysProps {
  ui: UseUIStateReturn;
  runtime: AppContentRuntime;
  onOpenCensusDate?: (isoDate: string) => void;
  overlayViews?: AppContentOverlayViews;
}

export const AppContentOverlays: React.FC<AppContentOverlaysProps> = ({
  ui,
  runtime,
  onOpenCensusDate,
  overlayViews,
}) => {
  usePatientSearchShortcut(ui.patientSearchModal.toggle);
  const { isOpen: isReminderCenterOpen } = useReminderCenter();
  const overlayState = buildAppContentOverlayState({
    ui,
    runtime,
    onOpenCensusDate,
  });
  const CensusEmailConfigModal = overlayViews?.CensusEmailConfigModal;
  const GlobalPatientSearchModal = overlayViews?.GlobalPatientSearchModal;

  return (
    <>
      {isReminderCenterOpen && (
        <React.Suspense fallback={null}>
          <ReminderModal />
        </React.Suspense>
      )}

      {overlayState.shouldRenderCensusEmailConfigModal && CensusEmailConfigModal && (
        <React.Suspense fallback={null}>
          <CensusEmailConfigModal {...overlayState.censusEmailModalProps} />
        </React.Suspense>
      )}

      {overlayState.shouldRenderPatientSearchModal && GlobalPatientSearchModal && (
        <React.Suspense fallback={null}>
          <GlobalPatientSearchModal {...overlayState.patientSearchModalProps} />
        </React.Suspense>
      )}

      <PinLockScreen />
      <StorageStatusBadge />
    </>
  );
};
