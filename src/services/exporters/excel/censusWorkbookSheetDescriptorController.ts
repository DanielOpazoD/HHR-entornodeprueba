import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';

import { formatDateDDMMYYYY } from '@/services/exporters/excel/formatters';
import type {
  CensusMasterWorkbookOptions,
  CensusWorkbookSheetDescriptor,
} from '@/services/exporters/excel/censusWorkbookContracts';

export interface CensusWorkbookResolvedSheetDescriptor {
  record: CensusExportRecord;
  descriptor: CensusWorkbookSheetDescriptor;
}

export const buildCensusWorkbookSheetDescriptors = (
  sourceRecords: CensusExportRecord[],
  sortedRecords: CensusExportRecord[],
  options?: CensusMasterWorkbookOptions
): CensusWorkbookResolvedSheetDescriptor[] => {
  const providedDescriptors = options?.sheetDescriptors || [];
  if (providedDescriptors.length === 0) {
    return sortedRecords.map((record, index) => ({
      record,
      descriptor: {
        recordDate: record.date,
        sheetName: formatDateDDMMYYYY(record.date),
        sortOrder: index,
      } as CensusWorkbookSheetDescriptor,
    }));
  }

  return [...providedDescriptors]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(descriptor => {
      const record =
        typeof descriptor.recordLookupIndex === 'number'
          ? sourceRecords[descriptor.recordLookupIndex]
          : sourceRecords.find(candidate => candidate.date === descriptor.recordDate);

      if (!record) {
        throw new Error(`No se encontró registro para la fecha: ${descriptor.recordDate}`);
      }

      return { record, descriptor };
    });
};
