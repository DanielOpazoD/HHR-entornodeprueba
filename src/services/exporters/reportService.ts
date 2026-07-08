import { downloadWorkbookFile, type DownloadWorkbookOutcome } from './excelFileDownload';
import {
  buildCudyrDailyWorkbookOrNull,
  buildDailyFormattedWorkbookOrNull,
  buildDailyRawWorkbookOrNull,
  buildRangeFormattedWorkbookOrNull,
  buildRangeRawWorkbookOrNull,
} from './reportWorkbookBuilders';

/**
 * Outcome of a census/cudyr report export. 'no_data' covers the case where
 * the workbook builder returned null (no records for the requested date or
 * range) and is conceptually distinct from 'failed' (validation rejected
 * the generated file). Callers can decide how to present each.
 */
export type GenerateReportOutcome =
  | DownloadWorkbookOutcome
  | { outcome: 'no_data'; userSafeMessage: string };

const NO_DATA_MESSAGE = 'No hay datos para el rango solicitado.';

const noDataOutcome = (): GenerateReportOutcome => ({
  outcome: 'no_data',
  userSafeMessage: NO_DATA_MESSAGE,
});

export const generateCensusDailyRaw = async (date: string): Promise<GenerateReportOutcome> => {
  const workbook = await buildDailyRawWorkbookOrNull(date);
  if (!workbook) return noDataOutcome();
  return downloadWorkbookFile({
    workbook,
    filename: `Censo_HangaRoa_Bruto_Diario_${date}.xlsx`,
  });
};

export const generateCensusRangeRaw = async (
  startDate: string,
  endDate: string
): Promise<GenerateReportOutcome> => {
  const workbook = await buildRangeRawWorkbookOrNull(startDate, endDate);
  if (!workbook) return noDataOutcome();
  return downloadWorkbookFile({
    workbook,
    filename: `Censo_HangaRoa_Bruto_Rango_${startDate}_${endDate}.xlsx`,
  });
};

export const generateCensusMonthRaw = async (
  year: number,
  month: number
): Promise<GenerateReportOutcome> => {
  // Construct range YYYY-MM-01 to YYYY-MM-31
  const mStr = String(month + 1).padStart(2, '0');
  const startDate = `${year}-${mStr}-01`;
  const endDate = `${year}-${mStr}-31`; // Loose end date covers full month

  return generateCensusRangeRaw(startDate, endDate);
};

// --- PLACEHOLDERS FOR FORMATTED REPORTS ---

export const generateCensusDailyFormatted = async (
  date: string
): Promise<GenerateReportOutcome> => {
  const workbook = await buildDailyFormattedWorkbookOrNull(date);
  if (!workbook) return noDataOutcome();
  return downloadWorkbookFile({
    workbook,
    filename: `Censo_HangaRoa_Formateado_Diario_${date}.xlsx`,
  });
};

export const generateCensusRangeFormatted = async (
  startDate: string,
  endDate: string
): Promise<GenerateReportOutcome> => {
  const workbook = await buildRangeFormattedWorkbookOrNull(startDate, endDate);
  if (!workbook) return noDataOutcome();
  return downloadWorkbookFile({
    workbook,
    filename: `Censo_HangaRoa_Formateado_Rango_${startDate}_${endDate}.xlsx`,
  });
};

// --- CUDYR EXPORTS ---

export const generateCudyrDailyRaw = async (date: string): Promise<GenerateReportOutcome> => {
  const workbook = await buildCudyrDailyWorkbookOrNull(date);
  if (!workbook) return noDataOutcome();
  return downloadWorkbookFile({
    workbook,
    filename: `CUDYR_Diario_Registro_${date}.xlsx`,
  });
};
