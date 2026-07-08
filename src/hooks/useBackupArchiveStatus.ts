import { useEffect, useState } from 'react';

import {
  buildArchiveStatusState,
  shouldCheckArchiveStatus,
} from '@/hooks/controllers/backupArchiveStatusController';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';

const loadBackupStorageUseCases = () =>
  import('@/application/backup-export/backupExportStorageUseCases');
const loadBackupLookupOutcomePresenter = () =>
  import('@/hooks/controllers/backupStorageOutcomeController').then(
    module => module.presentBackupLookupOutcome
  );

interface UseBackupArchiveStatusParams {
  currentDateString: string;
  currentModule: string;
  selectedShift: 'day' | 'night';
  canVerifyArchiveStatus: boolean;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

export const useBackupArchiveStatus = ({
  currentDateString,
  currentModule,
  selectedShift,
  canVerifyArchiveStatus,
  warning,
  error,
}: UseBackupArchiveStatusParams) => {
  const archiveStatusKey = `${currentDateString}|${currentModule}|${selectedShift}|${canVerifyArchiveStatus ? '1' : '0'}`;
  const [archiveState, setArchiveState] = useState<{
    key: string;
    isArchived: boolean;
  }>({
    key: archiveStatusKey,
    isArchived: false,
  });
  const isArchived = archiveState.key === archiveStatusKey ? archiveState.isArchived : false;
  const setIsArchived = (nextIsArchived: boolean) => {
    setArchiveState({
      key: archiveStatusKey,
      isArchived: nextIsArchived,
    });
  };

  useEffect(() => {
    if (!canVerifyArchiveStatus || !shouldCheckArchiveStatus(currentDateString, currentModule)) {
      return;
    }

    const backupType = currentModule === 'CENSUS' ? 'census' : 'handoff';
    let isDisposed = false;
    let timeoutId: number | undefined;
    let idleCallbackId: number | undefined;

    const runLookup = () => {
      void (async () => {
        const { executeLookupBackupArchiveStatus } = await loadBackupStorageUseCases();
        const outcome = await executeLookupBackupArchiveStatus({
          backupType,
          date: currentDateString,
          shift: selectedShift,
        });
        if (isDisposed) {
          return;
        }

        recordOperationalOutcome('backup', 'lookup_archive_status', outcome, {
          date: currentDateString,
          context: { backupType, shift: selectedShift },
        });
        setArchiveState({
          key: archiveStatusKey,
          isArchived: buildArchiveStatusState(outcome.data.lookup),
        });
        const presentBackupLookupOutcome = await loadBackupLookupOutcomePresenter();
        const notice = presentBackupLookupOutcome(outcome);
        // Background archive verification is opportunistic. Timeouts should stay silent and rely on
        // telemetry instead of interrupting the user when the main data flow is already healthy.
        if (notice?.channel === 'warning' && notice.state !== 'retrying') {
          warning(notice.title || 'Respaldo', notice.message);
        } else if (notice?.channel === 'error') {
          error(notice.title || 'Respaldo', notice.message);
        }
      })().catch(caughtError => {
        if (isDisposed) {
          return;
        }
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : 'No se pudo cargar la verificación remota de respaldo.';
        error('Verificación de respaldo fallida', message);
      });
    };

    if (typeof window === 'undefined') {
      runLookup();
      return;
    }

    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof browserWindow.requestIdleCallback === 'function') {
      idleCallbackId = browserWindow.requestIdleCallback(() => {
        runLookup();
      });
    } else {
      timeoutId = window.setTimeout(() => {
        runLookup();
      }, 150);
    }

    return () => {
      isDisposed = true;
      if (typeof timeoutId === 'number') {
        window.clearTimeout(timeoutId);
      }
      if (
        typeof idleCallbackId === 'number' &&
        typeof browserWindow.cancelIdleCallback === 'function'
      ) {
        browserWindow.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [
    archiveStatusKey,
    canVerifyArchiveStatus,
    currentDateString,
    currentModule,
    error,
    selectedShift,
    warning,
  ]);

  return {
    isArchived,
    setIsArchived,
  };
};
