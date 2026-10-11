import type { DailyRecordCudyrExportState } from '@/services/contracts/dailyRecordServiceContracts';

export type CudyrExcelExportOutcome =
  | { outcome: 'success'; fileName: string; byteLength: number }
  | { outcome: 'failed'; userSafeMessage: string; reason: string };

const readMonthlyReport = async (year: number, month: number, endDate?: string) => {
  if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(month) || month < 1 || month > 12)
    throw new Error('Mes CUDYR inválido.');
  const prefix = String(year) + '-' + String(month).padStart(2, '0');
  const from = prefix + '-01';
  const to = endDate || prefix + '-' + new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!to.startsWith(prefix + '-'))
    throw new Error('La fecha final no pertenece al mes solicitado.');
  return (await import('./cudyrReportLoader')).loadCudyrReport(from, to);
};

/** Downloads the same persisted model used by the explorer. Never starts Eloísa synchronization. */
export const generateCudyrMonthlyExcel = async (
  year: number,
  month: number,
  endDate?: string,
  _currentRecord?: DailyRecordCudyrExportState | null
): Promise<CudyrExcelExportOutcome> => {
  try {
    const [data, { downloadCudyrReport }] = await Promise.all([
      readMonthlyReport(year, month, endDate),
      import('./cudyrReportWorkbook'),
    ]);
    return await downloadCudyrReport(data);
  } catch (error) {
    return {
      outcome: 'failed',
      userSafeMessage: 'No se pudo generar el reporte CUDYR. Consulte el período nuevamente.',
      reason: error instanceof Error ? error.message : 'unknown_export_error',
    };
  }
};
export const generateCudyrMonthlyExcelBlob = async (
  year: number,
  month: number,
  endDate?: string,
  _currentRecord?: DailyRecordCudyrExportState | null
): Promise<Blob> => {
  const [data, { cudyrReportExcelBlob }] = await Promise.all([
    readMonthlyReport(year, month, endDate),
    import('./cudyrReportWorkbook'),
  ]);
  return (await cudyrReportExcelBlob(data)).blob;
};
