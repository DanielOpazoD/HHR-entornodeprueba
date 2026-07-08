import type { Workbook } from 'exceljs';

import { validateExcelExport, XLSX_MIME_TYPE } from './excelValidation';
import { excelFileDownloadLogger } from '@/services/exporters/exporterLoggers';

export interface DownloadWorkbookOptions {
  workbook: Workbook;
  filename: string;
  successLogMessage?: (byteLength: number) => string;
}

/**
 * Outcome contract for clinical workbook downloads. Services no longer
 * render UI: 'failed' carries a userSafeMessage the caller presents via
 * useNotification. 'success' is the happy path; 'skipped' is reserved for
 * future cases where the workbook is not generated (currently unused but
 * keeps the discriminated union extensible without breaking callers).
 */
export type DownloadWorkbookOutcome =
  | { outcome: 'success'; filename: string; byteLength: number }
  | { outcome: 'failed'; filename: string; userSafeMessage: string; reason: string };

export const downloadWorkbookFile = async ({
  workbook,
  filename,
  successLogMessage,
}: DownloadWorkbookOptions): Promise<DownloadWorkbookOutcome> => {
  const buffer = await workbook.xlsx.writeBuffer();
  const validation = validateExcelExport(buffer, filename);

  if (!validation.valid) {
    excelFileDownloadLogger.error(`Excel validation failed for ${filename}`, validation.error);
    return {
      outcome: 'failed',
      filename,
      userSafeMessage:
        'No se pudo generar el archivo Excel. Por favor, recarga la página e intenta de nuevo.',
      reason: validation.error ?? 'unknown_validation_error',
    };
  }

  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  const { saveAs } = await import('file-saver');
  saveAs(blob, filename);

  if (successLogMessage) {
    excelFileDownloadLogger.info(successLogMessage(buffer.byteLength));
  }

  return { outcome: 'success', filename, byteLength: buffer.byteLength };
};
