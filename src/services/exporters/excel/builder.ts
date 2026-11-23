import type { Workbook } from 'exceljs';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { createWorkbook } from '../excelUtils';
import type { CensusMasterWorkbookOptions } from './censusWorkbookContracts';
import { buildCensusWorkbookSheetDescriptors } from './censusWorkbookSheetDescriptorController';
import { createCensusWorkbookDaySheet } from './censusWorkbookDaySheetBuilder';
import { addCensusHiddenSheets } from './censusHiddenSheetsBuilder';
import { EXCEL_SHEET_NAME_MAX_LENGTH } from './styles';

export const applyCensusWorkbookMetadata = (workbook: Workbook): void => {
  workbook.creator = 'Hospital Hanga Roa';
  workbook.created = new Date();
};

export const reserveUniqueCensusSheetName = (baseName: string, usedNames: Set<string>): string => {
  const sanitizedBase = baseName
    .replace(/[\\/?*:[\]]/g, '-')
    .trim()
    .slice(0, EXCEL_SHEET_NAME_MAX_LENGTH);

  if (!usedNames.has(sanitizedBase)) {
    usedNames.add(sanitizedBase);
    return sanitizedBase;
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${sanitizedBase} (${suffix})`.slice(0, EXCEL_SHEET_NAME_MAX_LENGTH);
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix++;
  }

  return sanitizedBase;
};

export const buildCensusMasterWorkbook = async (
  records: CensusExportRecord[],
  options?: CensusMasterWorkbookOptions
): Promise<Workbook> => {
  if (!records || records.length === 0) {
    throw new Error('No hay registros disponibles para generar el Excel maestro.');
  }

  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const sourceRecords =
    options?.sheetDescriptors && options.sheetDescriptors.length > 0 ? [...records] : sortedRecords;
  const usedSheetNames = new Set<string>();
  const workbook = await createWorkbook();
  applyCensusWorkbookMetadata(workbook);

  const descriptors = buildCensusWorkbookSheetDescriptors(sourceRecords, sortedRecords, options);
  const resolvedSheets = descriptors.map(({ record, descriptor }) => ({
    record,
    descriptor,
    resolvedSheetName: reserveUniqueCensusSheetName(descriptor.sheetName, usedSheetNames),
  }));

  await addCensusHiddenSheets(workbook, resolvedSheets);

  resolvedSheets.forEach(({ record, descriptor, resolvedSheetName }) => {
    createCensusWorkbookDaySheet(workbook, record, resolvedSheetName, descriptor.snapshotLabel);
  });

  const visibleSheetIndexes = workbook.worksheets
    .map((sheet, index) => (sheet.state !== 'hidden' ? index : -1))
    .filter(index => index >= 0);
  const lastVisibleSheetIndex = visibleSheetIndexes.at(-1) ?? -1;
  if (lastVisibleSheetIndex >= 0) {
    // Excel opens the workbook on the active tab. Hidden support sheets are inserted first,
    // so we explicitly point the workbook view at the last visible day sheet, which is the
    // most recent census snapshot the user just generated.
    workbook.views = [
      {
        x: 0,
        y: 0,
        width: 10000,
        height: 20000,
        firstSheet: lastVisibleSheetIndex,
        activeTab: lastVisibleSheetIndex,
        visibility: 'visible',
      },
    ];
  }

  return workbook;
};
