/**
 * Census Master Export Service
 * Generates a multi-sheet Excel file with one sheet per day of the month.
 * Uses the shared workbook builder to keep the email attachment and manual download in sync.
 *
 * NOTE: Password encryption only works for email attachments (server-side via Netlify Function).
 * Manual downloads are NOT encrypted because xlsx-populate doesn't work in browsers.
 */

import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { MONTH_NAMES } from '@/constants/export';
import { getRecordsForMonth } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getMonthRecordsFromFirestore } from '../storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { buildCensusMasterBinary, getCensusMasterFilename } from './censusMasterWorkbook';
import { validateExcelExport, XLSX_MIME_TYPE } from './excelValidation';
import { censusMasterExportLogger } from '@/services/exporters/exporterLoggers';
import { isE2ERuntimeEnabled, recordE2EDownloadArtifact } from '@/shared/runtime/e2eRuntime';

/**
 * Outcome of the Census Master export. Services do not render UI: failure
 * variants carry a userSafeMessage the caller presents via useNotification.
 *  - success:  workbook validated and download triggered
 *  - no_data:  nothing to export for the requested range
 *  - failed:   validation rejected the generated workbook OR the data
 *              fetch / generation pipeline threw
 */
export type CensusMasterExportOutcome =
  | { outcome: 'success'; filename: string; byteLength: number }
  | { outcome: 'no_data'; userSafeMessage: string }
  | { outcome: 'failed'; userSafeMessage: string; reason: string };

/**
 * Generate and download the Census Master Excel file for a given month.
 * Fetches data from Firestore if available, otherwise falls back to localStorage.
 * Creates one worksheet per day that has data, from the first day up to the selected day.
 *
 * NOTE: This download is NOT password-protected. Only email attachments are encrypted.
 *
 * @param year - Year (e.g., 2025)
 * @param month - Month (0-indexed, e.g., 11 for December)
 * @param selectedDay - Day of the month to use as the limit (e.g., 10 means include days 1-10)
 */
export const generateCensusMasterExcel = async (
  year: number,
  month: number,
  selectedDay: number
): Promise<CensusMasterExportOutcome> => {
  const limitDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;

  let allMonthRecords: CensusExportRecord[] = [];

  try {
    if (isFirestoreEnabled()) {
      try {
        censusMasterExportLogger.info(
          `Loading ${MONTH_NAMES[month]} ${year} census records from Firestore`
        );
        allMonthRecords = await getMonthRecordsFromFirestore(year, month);
        if (allMonthRecords.length === 0 && isE2ERuntimeEnabled()) {
          censusMasterExportLogger.info(
            'Firestore returned no monthly records in E2E runtime. Falling back to local storage'
          );
          allMonthRecords = await getRecordsForMonth(year, month + 1);
        }
      } catch (remoteError) {
        censusMasterExportLogger.warn(
          'Firestore unavailable for monthly export. Falling back to local storage',
          remoteError
        );
        allMonthRecords = await getRecordsForMonth(year, month + 1);
      }
    } else {
      censusMasterExportLogger.info(
        `Loading ${MONTH_NAMES[month]} ${year} census records from local storage`
      );
      allMonthRecords = await getRecordsForMonth(year, month + 1);
    }

    const monthRecords = allMonthRecords
      .filter(record => record.date <= limitDateStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (monthRecords.length === 0) {
      censusMasterExportLogger.warn(`No census records found for ${MONTH_NAMES[month]} ${year}`);
      return {
        outcome: 'no_data',
        userSafeMessage: `No hay datos registrados para las fechas seleccionadas en ${MONTH_NAMES[month]} ${year}.`,
      };
    }

    censusMasterExportLogger.info(`Found ${monthRecords.length} census days to export`);

    const binary = await buildCensusMasterBinary(monthRecords);
    const filename = getCensusMasterFilename(limitDateStr);
    const validation = validateExcelExport(binary, filename);

    if (!validation.valid) {
      censusMasterExportLogger.error(`Excel validation failed for ${filename}`, validation.error);
      return {
        outcome: 'failed',
        userSafeMessage:
          'No se pudo generar el archivo Excel. Por favor, recarga la página e intenta de nuevo.',
        reason: validation.error ?? 'unknown_validation_error',
      };
    }

    const blob = new Blob([binary], { type: XLSX_MIME_TYPE });
    recordE2EDownloadArtifact({
      filename,
      blobSize: blob.size,
      blobType: blob.type,
    });
    const { saveAs } = await import('file-saver');
    saveAs(blob, filename);
    censusMasterExportLogger.info(
      `📥 Archivo descargado: ${filename} (${binary.byteLength} bytes)`
    );
    return { outcome: 'success', filename, byteLength: binary.byteLength };
  } catch (error) {
    censusMasterExportLogger.error('Failed to generate census master Excel', error);
    const reason = error instanceof Error ? error.message : 'Error desconocido';
    return {
      outcome: 'failed',
      userSafeMessage:
        'No se pudo generar el archivo Excel. Por favor, recarga la página e intenta de nuevo.',
      reason,
    };
  }
};
