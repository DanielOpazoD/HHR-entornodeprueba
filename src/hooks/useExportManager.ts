import { useState, useCallback } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { dispatchExportManagerNotice } from '@/hooks/controllers/exportManagerNoticeController';
import { presentBackupExportOutcome } from '@/hooks/controllers/backupExportOutcomeController';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { useBackupArchiveStatus } from '@/hooks/useBackupArchiveStatus';
import { formatBackupShiftLabel } from '@/shared/backup/backupPresentation';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { BackupHandoffPdfOutput } from '@/application/backup-export/backupExportArchiveContracts';

const loadBackupArchiveUseCases = () =>
  import('@/application/backup-export/backupExportArchiveUseCases');

interface UseExportManagerProps {
  currentDateString: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  record: DailyRecord | null;
  currentModule: string;
  selectedShift: 'day' | 'night';
  canVerifyArchiveStatus?: boolean;
  flushBeforeExport?: () => Promise<void>;
  getStableRecordForExport?: () => DailyRecord | null;
}

export interface UseExportManagerReturn {
  isArchived: boolean;
  isBackingUp: boolean;
  handleExportPDF: () => Promise<void>;
  handleBackupExcel: () => Promise<void>;
  handleBackupHandoff: (skipConfirmation?: boolean) => Promise<void>;
}

const resolveBackupHandoffNoticeOptions = (
  outcome: ApplicationOutcome<BackupHandoffPdfOutput | null>,
  selectedShift: 'day' | 'night'
) => ({
  successTitle: selectedShift === 'night' ? 'Respaldos guardados' : 'Respaldo PDF guardado',
  successMessage: selectedShift === 'night' ? 'PDF + CUDYR mensual' : undefined,
  partialTitle:
    outcome.reason === 'backup_handoff_cudyr_storage_failed'
      ? 'PDF guardado; CUDYR pendiente'
      : 'Respaldo PDF guardado con observaciones',
  failedTitle:
    outcome.reason === 'backup_handoff_pdf_storage_failed'
      ? 'No se guardó el respaldo PDF'
      : 'Error al guardar el respaldo PDF',
  fallbackErrorMessage: 'Error al guardar el respaldo PDF',
});

export const useExportManager = ({
  currentDateString,
  selectedYear,
  selectedMonth,
  selectedDay,
  record,
  currentModule,
  selectedShift,
  canVerifyArchiveStatus = false,
  flushBeforeExport,
  getStableRecordForExport,
}: UseExportManagerProps): UseExportManagerReturn => {
  const { success, error: notifyError, warning } = useNotification();
  const { confirm } = useConfirmDialog();

  const [isBackingUp, setIsBackingUp] = useState(false);
  const { isArchived, setIsArchived } = useBackupArchiveStatus({
    currentDateString,
    currentModule,
    selectedShift,
    canVerifyArchiveStatus,
    warning,
    error: notifyError,
  });

  const handleExportPDF = useCallback(async () => {
    await flushBeforeExport?.();
    const exportRecord = getStableRecordForExport?.() ?? record;
    const { executeExportHandoffPdf } = await loadBackupArchiveUseCases();

    const outcome = await executeExportHandoffPdf({
      record: exportRecord,
      selectedShift,
      isMedical: currentModule === 'MEDICAL_HANDOFF',
    });
    recordOperationalOutcome('export', 'export_handoff_pdf', outcome, {
      date: exportRecord?.date,
      context: { shift: selectedShift, module: currentModule },
      allowSuccess: true,
    });
    if (outcome.status === 'success') {
      return;
    }

    const notice = presentBackupExportOutcome(outcome, {
      successTitle: 'PDF generado',
      partialTitle: 'Impresión abierta con observaciones',
      failedTitle: 'Error al abrir la impresión',
      fallbackErrorMessage: 'Error al abrir la impresión. Por favor intente nuevamente.',
    });
    dispatchExportManagerNotice(notice, { success, warning, error: notifyError });
  }, [
    currentModule,
    flushBeforeExport,
    getStableRecordForExport,
    notifyError,
    record,
    selectedShift,
    success,
    warning,
  ]);

  const handleBackupExcel = useCallback(async () => {
    setIsBackingUp(true);
    try {
      await flushBeforeExport?.();
      const exportRecord = getStableRecordForExport?.() ?? record;
      const { executeBackupCensusExcel } = await loadBackupArchiveUseCases();
      const outcome = await executeBackupCensusExcel({
        selectedYear,
        selectedMonth,
        selectedDay,
        currentDateString,
        record: exportRecord,
      });
      recordOperationalOutcome('backup', 'backup_census_excel', outcome, {
        date: currentDateString,
        allowSuccess: true,
      });
      const notice = presentBackupExportOutcome(outcome, {
        successTitle: 'Excel archivado',
        successMessage: `Guardado para ${currentDateString}`,
        partialTitle: 'Excel archivado con observaciones',
        failedTitle: 'Error al realizar el respaldo en la nube',
        fallbackErrorMessage: 'Error al realizar el respaldo en la nube',
      });
      if (outcome.status === 'success' || outcome.status === 'partial') {
        setIsArchived(true);
      }
      dispatchExportManagerNotice(notice, { success, warning, error: notifyError });
    } finally {
      setIsBackingUp(false);
    }
  }, [
    currentDateString,
    flushBeforeExport,
    getStableRecordForExport,
    setIsArchived,
    selectedDay,
    selectedMonth,
    selectedYear,
    success,
    warning,
    notifyError,
    record,
  ]);

  const handleBackupHandoff = useCallback(
    async (skipConfirmation = false) => {
      const exportRecord = getStableRecordForExport?.() ?? record;
      if (!exportRecord) return;

      const [year, month, day] = exportRecord.date.split('-');
      const formattedDate = `${day}-${month}-${year}`;
      const shiftLabel = formatBackupShiftLabel(selectedShift);
      const actionLabel = isArchived ? 'Actualizar' : 'Guardar';

      if (!skipConfirmation) {
        const confirmed = await confirm({
          title: `💾 ${actionLabel} Respaldo PDF`,
          message: isArchived
            ? `Ya existe un respaldo para ${shiftLabel} del ${formattedDate}.\n\n¿Desea sobrescribirlo con los datos actuales?`
            : `¿Desea guardar esta entrega de turno como archivo PDF?\n\nFecha: ${formattedDate}\nTurno: ${shiftLabel}`,
          confirmText: actionLabel,
          cancelText: 'Cancelar',
          variant: isArchived ? 'warning' : 'info',
        });

        if (!confirmed) return;
      }

      setIsBackingUp(true);
      try {
        await flushBeforeExport?.();
        const stableRecord = getStableRecordForExport?.() ?? exportRecord;
        const { executeBackupHandoffPdf } = await loadBackupArchiveUseCases();
        const outcome = await executeBackupHandoffPdf({
          record: stableRecord,
          selectedShift,
        });
        recordOperationalOutcome('backup', 'backup_handoff_pdf', outcome, {
          date: stableRecord?.date,
          context: { shift: selectedShift },
          allowSuccess: true,
        });
        const notice = presentBackupExportOutcome(
          outcome,
          resolveBackupHandoffNoticeOptions(outcome, selectedShift)
        );
        if (outcome.status === 'success' || outcome.status === 'partial') {
          setIsArchived(true);
        }
        dispatchExportManagerNotice(notice, { success, warning, error: notifyError });
      } finally {
        setIsBackingUp(false);
      }
    },
    [
      confirm,
      flushBeforeExport,
      getStableRecordForExport,
      isArchived,
      notifyError,
      record,
      selectedShift,
      setIsArchived,
      success,
      warning,
    ]
  );

  return {
    isArchived,
    isBackingUp,
    handleExportPDF,
    handleBackupExcel,
    handleBackupHandoff,
  };
};
