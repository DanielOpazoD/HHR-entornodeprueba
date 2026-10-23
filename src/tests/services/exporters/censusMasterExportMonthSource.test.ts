import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { CensusMonthUnavailableError } from '@/services/storage/firestore/firestoreRecordQueries';

const mocks = vi.hoisted(() => ({
  getMonthRecordsFromFirestore: vi.fn(),
  getRecordsForMonth: vi.fn(),
  saveAs: vi.fn(),
}));

vi.mock('@/services/storage/firestore', () => ({
  getMonthRecordsFromFirestore: mocks.getMonthRecordsFromFirestore,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordsForMonth: mocks.getRecordsForMonth,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/exporters/censusMasterWorkbook', () => ({
  buildCensusMasterBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getCensusMasterFilename: () => 'Censo_2026-03-06.xlsx',
}));
vi.mock('@/services/exporters/excelValidation', () => ({
  validateExcelExport: () => ({ valid: true }),
  XLSX_MIME_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}));
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));
vi.mock('@/shared/runtime/e2eRuntime', () => ({
  isE2ERuntimeEnabled: () => false,
  recordE2EDownloadArtifact: vi.fn(),
}));

import { generateCensusMasterExcel } from '@/services/exporters/censusMasterExport';

const localDay = { date: '2026-03-05', beds: {} } as unknown as CensusExportRecord;

describe('census master Excel month source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to this device when the server cannot be read, instead of reporting no data', async () => {
    mocks.getMonthRecordsFromFirestore.mockRejectedValueOnce(
      new CensusMonthUnavailableError(2026, 2, new Error('offline'))
    );
    mocks.getRecordsForMonth.mockResolvedValueOnce([localDay]);

    const result = await generateCensusMasterExcel(2026, 2, 6);

    expect(mocks.getRecordsForMonth).toHaveBeenCalledWith(2026, 3);
    expect(result).toMatchObject({ outcome: 'success', filename: 'Censo_2026-03-06.xlsx' });
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
  });

  it('reports no data only when the month was really read and has no days', async () => {
    mocks.getMonthRecordsFromFirestore.mockResolvedValueOnce([]);

    const result = await generateCensusMasterExcel(2026, 2, 6);

    expect(result.outcome).toBe('no_data');
    expect(mocks.getRecordsForMonth).not.toHaveBeenCalled();
  });
});
