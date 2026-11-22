import { useCallback, useState } from 'react';
import { findMonthIndexByName } from '@/constants/export';
import type { BaseStoredFile, StoredPdfFile } from '@/types/backupArtifacts';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import type { BackupType } from '@/hooks/backupFileBrowserContracts';
import { resolveBackupModuleLabel } from '@/features/backup/hooks/backupFileBrowserController';
import type { ConfirmOptions } from '@/context/uiContracts';
import { executeDeleteBackupFile } from '@/application/backup-export/backupExportStorageUseCases';
import { executeRunMonthlyBackfill } from '@/application/backup-export/backupExportMaintenanceUseCases';
import { presentBackupExportOutcome } from '@/hooks/controllers/backupExportOutcomeController';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { canUseAdminMaintenanceActions } from '@/shared/access/operationalAccessPolicy';

interface MagicBackfillProgressState {
  completed: number;
  total: number;
  currentLabel?: string;
}

interface NotificationApi {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

interface ConfirmApi {
  (options: ConfirmOptions): Promise<boolean>;
}

interface UseBackupFileBrowserActionsParams {
  selectedBackupType: BackupType;
  path: string[];
  role?: string;
  items: Array<{ type: 'folder' | 'file'; data: unknown }>;
  refetch: () => Promise<unknown> | unknown;
  notifications: NotificationApi;
  confirm: ConfirmApi;
}

export interface BackupFileBrowserActionHandlers {
  handleDelete: (file: BaseStoredFile | StoredPdfFile) => Promise<void>;
  handleDownload: (file: BaseStoredFile | StoredPdfFile) => void;
  handleMagicMonthBackfill: () => Promise<void>;
}

export const useBackupFileBrowserActions = ({
  selectedBackupType,
  path,
  role,
  items,
  refetch,
  notifications,
  confirm,
}: UseBackupFileBrowserActionsParams): BackupFileBrowserActionHandlers & {
  isMagicBackfilling: boolean;
  magicBackfillProgress: MagicBackfillProgressState | null;
} => {
  const [isMagicBackfilling, setIsMagicBackfilling] = useState(false);
  const [magicBackfillProgress, setMagicBackfillProgress] =
    useState<MagicBackfillProgressState | null>(null);

  const handleDelete = useCallback(
    async (file: BaseStoredFile | StoredPdfFile) => {
      const confirmed = await confirm({
        title: 'Eliminar Archivo',
        message: `¿Está seguro de eliminar "${file.name}"?\nEsta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        variant: 'danger',
      });

      if (!confirmed) return;

      const outcome = await executeDeleteBackupFile({
        backupType: selectedBackupType,
        file,
      });
      recordOperationalOutcome('backup', 'delete_backup_file', outcome, {
        date: file.date,
        context: { backupType: selectedBackupType, filePath: file.fullPath },
        allowSuccess: true,
      });
      const notice = presentBackupExportOutcome(outcome, {
        successTitle: 'Archivo eliminado',
        partialTitle: 'Archivo eliminado con observaciones',
        failedTitle: 'Error al eliminar archivo',
        fallbackErrorMessage: 'Error al eliminar archivo',
      });
      if (notice.channel === 'success') {
        notifications.success(notice.title, notice.message);
      } else if (notice.channel === 'warning') {
        notifications.warning(notice.title, notice.message);
      } else {
        notifications.error(notice.title, notice.message);
        return;
      }
      await refetch();
    },
    [confirm, notifications, refetch, selectedBackupType]
  );

  const handleDownload = useCallback((file: BaseStoredFile | StoredPdfFile) => {
    if (file.downloadUrl) {
      defaultBrowserWindowRuntime.open(file.downloadUrl, '_blank');
    }
  }, []);

  const handleMagicMonthBackfill = useCallback(async () => {
    if (!canUseAdminMaintenanceActions(role)) {
      notifications.warning('No tienes permisos para ejecutar respaldo masivo');
      return;
    }

    if (path.length !== 2) {
      notifications.warning('Selecciona un mes para ejecutar respaldo masivo');
      return;
    }

    const [yearRaw, monthName] = path;
    const year = Number(yearRaw);
    const monthNumber = monthName ? findMonthIndexByName(monthName) + 1 : 0;

    if (!Number.isInteger(year) || monthNumber < 1) {
      notifications.error('No se pudo interpretar el mes seleccionado');
      return;
    }

    const confirmed = await confirm({
      title: `Respaldo masivo ${resolveBackupModuleLabel(selectedBackupType)}`,
      message: `Se respaldarán todas las fechas faltantes de ${monthName} ${year} para ${resolveBackupModuleLabel(selectedBackupType)}.\n\nEste proceso puede tardar algunos minutos.`,
      confirmText: 'Ejecutar',
      cancelText: 'Cancelar',
      variant: 'info',
    });

    if (!confirmed) return;

    setIsMagicBackfilling(true);
    setMagicBackfillProgress({ completed: 0, total: 0, currentLabel: undefined });

    try {
      const monthFiles = items
        .filter(item => item.type === 'file')
        .map(item => item.data as BaseStoredFile | StoredPdfFile);

      const outcome = await executeRunMonthlyBackfill({
        backupType: selectedBackupType,
        year,
        monthNumber,
        existingFiles: monthFiles,
        onProgress: progress => setMagicBackfillProgress(progress),
      });
      recordOperationalOutcome('backup', 'run_monthly_backfill', outcome, {
        context: { backupType: selectedBackupType, year, monthNumber },
        allowSuccess: true,
      });
      const result = outcome.data;

      await refetch();

      if (outcome.status === 'failed' || !result) {
        const notice = presentBackupExportOutcome(outcome, {
          successTitle: 'Respaldo masivo completado',
          partialTitle: 'Respaldo masivo completado con observaciones',
          failedTitle: 'Error al ejecutar respaldo masivo del mes',
          fallbackErrorMessage: 'Error al ejecutar respaldo masivo del mes',
        });
        notifications.error(notice.title, notice.message);
        return;
      }

      if (result.totalPlanned === 0) {
        const message =
          result.skippedNoRecord > 0
            ? `No hay registros clínicos para ${result.skippedNoRecord} fecha(s) del mes.`
            : 'No hay pendientes; todas las fechas con registros ya tienen respaldo.';
        notifications.info('Respaldo masivo sin pendientes', message);
        return;
      }

      const summary = [
        `Generados: ${result.created}`,
        `Fallidos: ${result.failed}`,
        `Sin registro diario: ${result.skippedNoRecord}`,
      ].join(' · ');

      if (outcome.status === 'partial' || result.failed > 0) {
        notifications.warning('Respaldo masivo completado con observaciones', summary);
      } else {
        notifications.success('Respaldo masivo completado', summary);
      }

      if (result.errors.length > 0) {
        notifications.error(
          'Errores detectados durante el respaldo masivo',
          result.errors.slice(0, 3).join('\n')
        );
      }
    } finally {
      setIsMagicBackfilling(false);
      setMagicBackfillProgress(null);
    }
  }, [confirm, items, notifications, path, refetch, role, selectedBackupType]);

  return {
    isMagicBackfilling,
    magicBackfillProgress,
    handleDelete,
    handleDownload,
    handleMagicMonthBackfill,
  };
};
