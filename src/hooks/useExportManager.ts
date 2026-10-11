import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { useBackupArchiveStatus } from '@/hooks/useBackupArchiveStatus';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { BackupHandoffPdfOutput } from '@/application/backup-export/backupExportArchiveContracts';
import {
  prepareRecordExport,
  type ExportReadiness,
} from '@/hooks/controllers/exportReadinessController';

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

interface UseExportManagerProps {
  currentDateString: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  record: DailyRecord | null;
  currentModule: string;
  selectedShift: 'day' | 'night';
  canVerifyArchiveStatus?: boolean;
  flushBeforeExport?: () => Promise<ExportReadiness>;
  getStableRecordForExport?: () => DailyRecord | null;
}

export interface UseExportManagerReturn {
  isArchived: boolean;
  isBackingUp: boolean;
  handleExportPDF: () => Promise<void>;
  handlePrintWithBrowserOptions: () => Promise<void>;
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
  const currentRecordRef = useRef({ date: currentDateString, record });
  useLayoutEffect(() => {
    currentRecordRef.current = { date: currentDateString, record };
    return () => {
      currentRecordRef.current = { date: '', record: null };
    };
  }, [currentDateString, record]);

  const [isBackingUp, setIsBackingUp] = useState(false);
  const { isArchived, setIsArchived } = useBackupArchiveStatus({
    currentDateString,
    currentModule,
    selectedShift,
    canVerifyArchiveStatus,
    warning,
    error: notifyError,
  });
  const prepare = useCallback(
    () =>
      prepareRecordExport({
        expectedDate: currentDateString,
        flushBeforeExport,
        readRecord: () =>
          getStableRecordForExport ? getStableRecordForExport() : currentRecordRef.current.record,
        readDate: () => currentRecordRef.current.date,
        warning,
      }),
    [currentDateString, flushBeforeExport, getStableRecordForExport, warning]
  );

  const handleExportPDF = useCallback(async () => {
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
  }, [currentModule, prepare, notifyError, selectedShift, success, warning]);

  const handlePrintWithBrowserOptions = useCallback(async () => {
    const prepared = await prepare();
    if (!prepared?.record) return;
    window.setTimeout(() => {
      if (prepared.canPrint()) window.print();
    }, 100);
  }, [prepare]);

  const handleBackupExcel = useCallback(async () => {
    setIsBackingUp(true);
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
  }, [
    currentDateString,
    prepare,
    setIsArchived,
    selectedDay,
    selectedMonth,
    selectedYear,
    success,
    warning,
    notifyError,
  ]);

  const handleBackupHandoff = useCallback(
    async (skipConfirmation = false) => {
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
    },
    [
      confirm,
      prepare,
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
    handlePrintWithBrowserOptions,
    handleBackupExcel,
    handleBackupHandoff,
  };
};
