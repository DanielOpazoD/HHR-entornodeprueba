import type { Dispatch, SetStateAction } from 'react';
import type { UseExportManagerProps } from '@/hooks/useExportManager';
import type { useConfirmDialog, useNotification } from '@/context/UIContext';
import type { prepareRecordExport } from '@/hooks/controllers/exportReadinessController';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { BackupHandoffPdfOutput } from '@/application/backup-export/backupExportArchiveContracts';

interface ExportManagerActionContext extends UseExportManagerProps {
  prepare: () => ReturnType<typeof prepareRecordExport>;
  isArchived: boolean;
  setIsArchived: (value: boolean) => void;
  setIsBackingUp: Dispatch<SetStateAction<boolean>>;
  confirm: ReturnType<typeof useConfirmDialog>['confirm'];
  success: ReturnType<typeof useNotification>['success'];
  warning: ReturnType<typeof useNotification>['warning'];
  notifyError: ReturnType<typeof useNotification>['error'];
}
const loadBackupArchiveUseCases = () =>
  import('@/application/backup-export/backupExportArchiveUseCases');
const loadBackupExportPresentation = async () => {
  const [{ presentBackupExportOutcome }, { dispatchExportManagerNotice }] = await Promise.all([
    import('@/hooks/controllers/backupExportOutcomeController'),
    import('@/hooks/controllers/exportManagerNoticeController'),
  ]);

  return {
    presentBackupExportOutcome,
    dispatchExportManagerNotice,
  };
};
const loadBackupHandoffConfirmDescriptor = async () =>
  import('@/hooks/controllers/exportManagerConfirmController').then(
    module => module.buildBackupHandoffConfirmDescriptor
  );

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

export const createExportManagerActions = ({
  prepare,
  selectedShift,
  currentModule,
  currentDateString,
  selectedYear,
  selectedMonth,
  selectedDay,
  setIsBackingUp,
  setIsArchived,
  getStableRecordForExport,
  record,
  isArchived,
  success,
  warning,
  notifyError,
  confirm,
}: ExportManagerActionContext) => {
  const handleExportPDF = async () => {
    const prepared = await prepare();
    if (!prepared?.record) return;
    const exportRecord = prepared.record;
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

    const { presentBackupExportOutcome, dispatchExportManagerNotice } =
      await loadBackupExportPresentation();
    const notice = presentBackupExportOutcome(outcome, {
      successTitle: 'PDF generado',
      partialTitle: 'Impresión abierta con observaciones',
      failedTitle: 'Error al abrir la impresión',
      fallbackErrorMessage: 'Error al abrir la impresión. Por favor intente nuevamente.',
    });
    dispatchExportManagerNotice(notice, { success, warning, error: notifyError });
  };

  const handlePrintWithBrowserOptions = async () => {
    const prepared = await prepare();
    if (!prepared?.record) return;
    window.setTimeout(() => {
      if (prepared.canPrint()) window.print();
    }, 100);
  };

  const handleBackupExcel = async () => {
    try {
      const prepared = await prepare();
      if (!prepared?.record) return;
      const exportRecord = prepared.record;
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
      const { presentBackupExportOutcome, dispatchExportManagerNotice } =
        await loadBackupExportPresentation();
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
  };

  const handleBackupHandoff = async (skipConfirmation = false) => {
    const exportRecord = getStableRecordForExport ? getStableRecordForExport() : record;
    if (!exportRecord) return;

    if (!skipConfirmation) {
      const buildBackupHandoffConfirmDescriptor = await loadBackupHandoffConfirmDescriptor();
      const confirmed = await confirm(
        buildBackupHandoffConfirmDescriptor({
          recordDate: exportRecord.date,
          selectedShift,
          isArchived,
        })
      );

      if (!confirmed) return;
    }

    setIsBackingUp(true);
    try {
      const prepared = await prepare();
      if (!prepared?.record) return;
      const stableRecord = prepared.record;
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
      const { presentBackupExportOutcome, dispatchExportManagerNotice } =
        await loadBackupExportPresentation();
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
  };

  return { handleExportPDF, handlePrintWithBrowserOptions, handleBackupExcel, handleBackupHandoff };
};
