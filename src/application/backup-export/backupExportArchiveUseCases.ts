import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type {
  BackupStorageMutationResult,
  BackupStorageMutationStatus,
} from '@/services/backup/backupStorageRuntimeSupport';

import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { defaultCensusEmailDeliveryPort } from '@/application/ports/censusEmailPort';
import { mergeMonthlyRecordsForBackup, resolveHandoffBackupStaff } from './backupExportSupport';
import { getShiftSchedule } from '@/utils/clinicalDayUtils';
import { validateCriticalFields } from '@/services/validation/criticalFieldsValidator';
import {
  type BackupCensusExcelInput,
  type BackupHandoffPdfInput,
  type BackupHandoffPdfOutput,
  type ExportHandoffPdfInput,
  normalizeBackupHandoffPdfInput,
  normalizeBackupCensusExcelInput,
  normalizeExportHandoffPdfInput,
  validateBackupHandoffPdfInput,
  validateBackupCensusExcelInput,
  validateExportHandoffPdfInput,
} from './backupExportArchiveContracts';

export interface BackupCensusExcelOutput {
  archivedDate: string;
  recordCount: number;
}

export const executeBackupCensusExcel = async (
  input: BackupCensusExcelInput
): Promise<ApplicationOutcome<BackupCensusExcelOutput | null>> => {
  const normalizedInput = normalizeBackupCensusExcelInput(input);
  const inputIssues = validateBackupCensusExcelInput(normalizedInput);
  if (inputIssues.length > 0) {
    return createApplicationFailed(null, inputIssues, {
      reason: 'backup_census_excel_invalid_input',
      userSafeMessage: 'Revisa la fecha seleccionada antes de guardar el respaldo.',
      retryable: false,
      severity: 'info',
    });
  }

  try {
    const monthRecords = await defaultDailyRecordReadPort.getMonthRecords(
      normalizedInput.selectedYear,
      normalizedInput.selectedMonth
    );
    const limitDate = `${normalizedInput.selectedYear}-${String(normalizedInput.selectedMonth + 1).padStart(2, '0')}-${String(
      normalizedInput.selectedDay
    ).padStart(2, '0')}`;

    const filteredRecords = mergeMonthlyRecordsForBackup(
      monthRecords,
      normalizedInput.record,
      normalizedInput.currentDateString,
      limitDate
    );

    if (filteredRecords.length === 0) {
      return createApplicationFailed(null, [
        { kind: 'validation', message: 'No hay registros para archivar.' },
      ]);
    }

    const { buildCensusMasterBinary } = await import('@/services/exporters/censusMasterWorkbook');
    const binary = await buildCensusMasterBinary(filteredRecords);
    const blob = new Blob([binary], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await defaultCensusEmailDeliveryPort.uploadBackup(blob, normalizedInput.currentDateString);

    return createApplicationSuccess({
      archivedDate: normalizedInput.currentDateString,
      recordCount: filteredRecords.length,
    });
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'Error al realizar el respaldo en la nube',
      },
    ]);
  }
};

export const executeExportHandoffPdf = async (
  input: ExportHandoffPdfInput
): Promise<ApplicationOutcome<null>> => {
  const normalizedInput = normalizeExportHandoffPdfInput(input);
  const inputIssues = validateExportHandoffPdfInput(normalizedInput);
  if (inputIssues.length > 0) {
    return createApplicationFailed(null, inputIssues, {
      reason: 'backup_export_handoff_pdf_invalid_input',
      userSafeMessage: 'Revisa el registro seleccionado antes de exportar el PDF.',
      retryable: false,
      severity: 'info',
    });
  }
  if (!normalizedInput.record) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'validation',
          code: 'backup/handoff-export-missing-record',
          message: 'No handoff record is available for PDF export.',
        },
      ],
      {
        reason: 'backup_export_handoff_pdf_invalid_input',
        userSafeMessage: 'Revisa el registro seleccionado antes de exportar el PDF.',
        retryable: false,
        severity: 'info',
      }
    );
  }

  try {
    // Handoff local export must use the generated PDF pipeline instead of window.print()
    // so pagination stays stable ("Pagina X de Y") across localhost/Netlify/browser contexts.
    const { generateHandoffPdf } = await import('@/services/pdf/handoffPdfGenerator');
    const schedule = getShiftSchedule(normalizedInput.record.date);
    await generateHandoffPdf(
      normalizedInput.record,
      Boolean(normalizedInput.isMedical),
      normalizedInput.selectedShift,
      schedule
    );
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al generar el PDF.',
      },
    ]);
  }
};

const BACKUP_STORAGE_MESSAGES: Record<
  BackupStorageMutationStatus,
  { message: string; retryable: boolean }
> = {
  success: {
    message: 'Respaldo guardado correctamente.',
    retryable: false,
  },
  permission_denied: {
    message: 'No tienes permisos para guardar este respaldo.',
    retryable: false,
  },
  not_found: {
    message: 'No se encontró el destino del respaldo.',
    retryable: true,
  },
  invalid_date: {
    message: 'La fecha del respaldo no es válida.',
    retryable: false,
  },
  timeout: {
    message: 'El respaldo tardó demasiado en responder.',
    retryable: true,
  },
  unknown: {
    message: 'No fue posible guardar el respaldo.',
    retryable: true,
  },
};

const backupStorageIssueKind = (status: BackupStorageMutationStatus) => {
  if (status === 'permission_denied') return 'permission';
  if (status === 'invalid_date') return 'validation';
  if (status === 'not_found') return 'not_found';
  if (status === 'timeout') return 'remote_blocked';
  return 'unknown';
};

const createBackupStorageIssue = (
  code: string,
  result: Exclude<BackupStorageMutationResult<unknown>, { status: 'success' }>,
  userSafeMessage: string
) => {
  const fallback = BACKUP_STORAGE_MESSAGES[result.status];
  return {
    kind: backupStorageIssueKind(result.status),
    code,
    message: result.error instanceof Error ? result.error.message : fallback.message,
    userSafeMessage,
    retryable: fallback.retryable,
    severity:
      result.status === 'permission_denied' || result.status === 'invalid_date'
        ? 'warning'
        : 'error',
    technicalContext: { storageStatus: result.status },
  } as const;
};

const isBackupStorageFailure = <T>(
  result: BackupStorageMutationResult<T>
): result is Exclude<BackupStorageMutationResult<T>, { status: 'success' }> =>
  result.status !== 'success';

export const executeBackupHandoffPdf = async (
  input: BackupHandoffPdfInput
): Promise<ApplicationOutcome<BackupHandoffPdfOutput | null>> => {
  const normalizedInput = normalizeBackupHandoffPdfInput(input);
  const inputIssues = validateBackupHandoffPdfInput(normalizedInput);
  if (inputIssues.length > 0) {
    return createApplicationFailed(null, inputIssues, {
      reason: 'backup_handoff_pdf_invalid_input',
      userSafeMessage: 'Revisa el registro y la fecha antes de guardar el respaldo.',
      retryable: false,
      severity: 'info',
    });
  }
  if (!normalizedInput.record) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'validation',
          code: 'backup/handoff-backup-missing-record',
          message: 'No handoff record is available for backup.',
        },
      ],
      {
        reason: 'backup_handoff_pdf_invalid_input',
        userSafeMessage: 'Revisa el registro y la fecha antes de guardar el respaldo.',
        retryable: false,
        severity: 'info',
      }
    );
  }

  const { delivers, receives } = resolveHandoffBackupStaff(
    normalizedInput.record,
    normalizedInput.selectedShift
  );
  if (delivers.length === 0 || receives.length === 0) {
    return createApplicationFailed(null, [
      {
        kind: 'validation',
        message: 'Selecciona enfermera que entrega y recibe antes de guardar',
      },
    ]);
  }

  const validation = validateCriticalFields(normalizedInput.record);
  if (!validation.isValid) {
    return createApplicationFailed(null, [
      {
        kind: 'validation',
        message: 'Campos críticos incompletos. Complete los datos antes de guardar.',
      },
    ]);
  }

  try {
    const [
      { default: jsPDF },
      { default: autoTable },
      { buildHandoffPdfContent },
      { uploadPdfWithResult },
    ] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
      import('@/services/backup/pdfContentBuilder'),
      import('@/services/backup/pdfStorageService'),
    ]);

    const schedule = getShiftSchedule(normalizedInput.record.date);
    const doc = new jsPDF();
    await buildHandoffPdfContent(
      doc,
      normalizedInput.record,
      normalizedInput.selectedShift,
      schedule,
      autoTable
    );
    const pdfBlob = doc.output('blob');
    const pdfUploadResult = await uploadPdfWithResult(
      pdfBlob,
      normalizedInput.record.date,
      normalizedInput.selectedShift
    );

    if (isBackupStorageFailure(pdfUploadResult)) {
      const issue = createBackupStorageIssue(
        'backup/pdf-upload-failed',
        pdfUploadResult,
        pdfUploadResult.status === 'permission_denied'
          ? 'No tienes permisos para guardar el respaldo PDF.'
          : 'No fue posible guardar el respaldo PDF.'
      );
      return createApplicationFailed(null, [issue], {
        reason: 'backup_handoff_pdf_storage_failed',
        userSafeMessage: issue.userSafeMessage,
        retryable: issue.retryable,
        severity: issue.severity,
        technicalContext: issue.technicalContext,
      });
    }

    if (normalizedInput.selectedShift !== 'night') {
      return createApplicationSuccess({
        shift: normalizedInput.selectedShift,
        createdCudyrBackup: false,
      });
    }

    try {
      const { generateCudyrMonthlyExcelBlob } = await import('@/services/cudyr/cudyrExportService');
      const { uploadCudyrExcelWithResult } = await import('@/services/backup/cudyrStorageService');
      const [year, month] = normalizedInput.record.date.split('-').map(Number);
      const cudyrBlob = await generateCudyrMonthlyExcelBlob(
        year,
        month,
        normalizedInput.record.date,
        normalizedInput.record
      );
      const cudyrUploadResult = await uploadCudyrExcelWithResult(
        cudyrBlob,
        normalizedInput.record.date
      );
      if (isBackupStorageFailure(cudyrUploadResult)) {
        const issue = createBackupStorageIssue(
          'backup/cudyr-upload-failed',
          cudyrUploadResult,
          cudyrUploadResult.status === 'permission_denied'
            ? 'PDF guardado, pero no tienes permisos para guardar CUDYR.'
            : 'PDF guardado, pero no fue posible guardar CUDYR.'
        );
        return createApplicationPartial(
          {
            shift: normalizedInput.selectedShift,
            createdCudyrBackup: false,
          },
          [issue],
          {
            reason: 'backup_handoff_cudyr_storage_failed',
            userSafeMessage: issue.userSafeMessage,
            retryable: issue.retryable,
            severity: issue.severity,
            technicalContext: issue.technicalContext,
          }
        );
      }
      return createApplicationSuccess({
        shift: normalizedInput.selectedShift,
        createdCudyrBackup: true,
      });
    } catch (error) {
      return createApplicationPartial(
        {
          shift: normalizedInput.selectedShift,
          createdCudyrBackup: false,
        },
        [
          {
            kind: 'unknown',
            message:
              error instanceof Error
                ? `PDF guardado, CUDYR falló: ${error.message}`
                : 'PDF guardado, CUDYR falló',
          },
        ]
      );
    }
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al guardar el respaldo PDF',
      },
    ]);
  }
};
