import React, { useState, useCallback } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useNotification } from '@/context/UIContext';
import { buildJsonImportNotifications } from '@/hooks/controllers/fileImportFeedbackController';
import {
  buildExportCsvNotification,
  buildExportJsonNotification,
  buildImportFileErrorNotification,
} from '@/hooks/controllers/fileOperationsFeedbackController';
import {
  isJsonImportFile,
  shouldRefreshAfterJsonImport,
} from '@/hooks/controllers/fileOperationsController';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { createScopedLogger } from '@/services/utils/loggerScope';

const logger = createScopedLogger('useFileOperations');
const loadExportService = () => import('@/services/exporters/exportService');
const loadBackupImportUseCase = () =>
  import('@/application/backup-export/backupExportMaintenanceUseCases').then(
    module => module.executeImportJsonBackup
  );
const loadBackupExportOutcomePresenter = () =>
  import('@/hooks/controllers/backupExportOutcomeController').then(
    module => module.presentBackupExportOutcome
  );

export interface UseFileOperationsReturn {
  handleExportJSON: () => void;
  handleExportCSV: () => void;
  handleImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportFile: (file: File) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook to manage file import/export operations
 * Extracts file handling logic from App.tsx for cleaner separation of concerns
 */
export const useFileOperations = (
  record: DailyRecord | null,
  onRefresh: () => void
): UseFileOperationsReturn => {
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const { success, error: notifyError, warning } = useNotification();
  const dispatchNotification = (notification: {
    channel: 'success' | 'warning' | 'error';
    title: string;
    message?: string;
  }) => {
    if (notification.channel === 'success') {
      success(notification.title, notification.message);
    } else if (notification.channel === 'warning') {
      warning(notification.title, notification.message);
    } else {
      notifyError(notification.title, notification.message);
    }
  };

  const handleExportJSON = () => {
    void loadExportService()
      .then(exportService => exportService.exportDataJSONWithResult())
      .then(outcome => {
        if (outcome.status === 'success') {
          dispatchNotification(buildExportJsonNotification('success'));
          return;
        }
        dispatchNotification(buildExportJsonNotification('error'));
      })
      .catch(error => {
        logger.error('JSON export failed', error);
        dispatchNotification(buildExportJsonNotification('error'));
      });
  };

  const handleExportCSV = () => {
    void loadExportService()
      .then(exportService => {
        const outcome = exportService.exportDataCSVWithResult(record);
        if (outcome.status === 'success') {
          dispatchNotification(buildExportCsvNotification('success'));
          return;
        }

        dispatchNotification(buildExportCsvNotification('error'));
      })
      .catch(error => {
        logger.error('CSV export failed', error);
        dispatchNotification(buildExportCsvNotification('error'));
      });
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    if (isJsonImportFile(file)) {
      const executeImportJsonBackup = await loadBackupImportUseCase();
      const outcome = await executeImportJsonBackup(file);
      recordOperationalOutcome('backup', 'import_json_backup', outcome, {
        context: { fileName: file.name },
        allowSuccess: true,
      });
      if (outcome.status === 'success' || outcome.status === 'partial') {
        for (const notification of buildJsonImportNotifications(outcome.data)) {
          dispatchNotification(notification);
        }
        if (shouldRefreshAfterJsonImport(outcome.data)) {
          onRefresh();
        }
      } else {
        const presentBackupExportOutcome = await loadBackupExportOutcomePresenter();
        const notice = presentBackupExportOutcome(outcome, {
          successTitle: 'Importación completada',
          partialTitle: 'Importación completada con observaciones',
          failedTitle: 'Error al importar',
          fallbackErrorMessage: 'No se pudo importar el archivo JSON.',
        });
        const message = notice.message ? `${notice.title}: ${notice.message}` : notice.title;
        setError(message);
        dispatchNotification({
          channel: notice.channel === 'info' ? 'warning' : notice.channel,
          title: notice.title,
          message: notice.message,
        });
      }
    } else {
      recordOperationalTelemetry({
        category: 'backup',
        status: 'failed',
        operation: 'import_json_backup',
        issues: ['Se intentó importar un formato no compatible.'],
        context: { fileName: file.name, mimeType: file.type || 'unknown' },
      });
      const notification = buildImportFileErrorNotification('invalid_format');
      setError(notification.message ?? notification.title);
      dispatchNotification(notification);
    }
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleImportFile(e.target.files[0]);
      // Reset input
      e.target.value = '';
    }
  };

  return {
    handleExportJSON,
    handleExportCSV,
    handleImportJSON,
    handleImportFile,
    error,
    clearError,
  };
};
