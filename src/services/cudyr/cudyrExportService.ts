import type { DailyRecordCudyrExportState } from '@/types/domain/dailyRecordSlices';

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
