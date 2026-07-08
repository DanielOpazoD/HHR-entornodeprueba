import React from 'react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { SyncWatcher } from '@/components/shared/SyncWatcher';
import StorageStatusBadge from '@/components/layout/StorageStatusBadge';
import { PinLockScreen } from '@/components/security/PinLockScreen';
import { CensusEmailConfigModal } from '@/views/LazyViews';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import { buildAppContentOverlayState } from '@/components/layout/app-content/appContentOverlaysController';
import { usePatientSearchShortcut } from '@/components/layout/app-content/usePatientSearchShortcut';
import { useReminderCenter } from '@/hooks/useReminders';

const TestAgent = lazyWithRetry(() =>
  import('@/components/debug/TestAgent').then(m => ({ default: m.TestAgent }))
);
const ReminderModal = lazyWithRetry(() =>
  import('@/components/reminders/ReminderModal').then(m => ({ default: m.ReminderModal }))
);
const GlobalPatientSearchModal = lazyWithRetry(() =>
  import('@/features/census/public-components').then(m => ({
    default: m.GlobalPatientSearchModal,
  }))
);

export interface AppContentOverlaysProps {
  ui: UseUIStateReturn;
  runtime: AppContentRuntime;
  onOpenCensusDate?: (isoDate: string) => void;
}

export const AppContentOverlays: React.FC<AppContentOverlaysProps> = ({
  ui,
  runtime,
  onOpenCensusDate,
}) => {
  usePatientSearchShortcut(ui.patientSearchModal.toggle);
  const { isOpen: isReminderCenterOpen } = useReminderCenter();
  const overlayState = buildAppContentOverlayState({
    ui,
    runtime,
    onOpenCensusDate,
  });

  return (
    <>
      {isReminderCenterOpen && (
        <React.Suspense fallback={null}>
          <ReminderModal />
        </React.Suspense>
      )}

      {overlayState.shouldRenderCensusEmailConfigModal && (
        <React.Suspense fallback={null}>
          <CensusEmailConfigModal {...overlayState.censusEmailModalProps} />
        </React.Suspense>
      )}

      {overlayState.shouldRenderTestAgent && (
        <React.Suspense fallback={null}>
          <TestAgent {...overlayState.testAgentProps} />
        </React.Suspense>
      )}

      {overlayState.shouldRenderPatientSearchModal && (
        <React.Suspense fallback={null}>
          <GlobalPatientSearchModal {...overlayState.patientSearchModalProps} />
        </React.Suspense>
      )}

      <SyncWatcher />
      <PinLockScreen />
      <StorageStatusBadge />
    </>
  );
};
