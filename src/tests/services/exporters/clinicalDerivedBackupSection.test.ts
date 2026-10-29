import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  readBackup: vi.fn(),
  readDoc: vi.fn(),
  getAllRecords: vi.fn(),
  saveRecordsStrict: vi.fn(),
  getRecordsRange: vi.fn(),
  getRemoteRecordsRange: vi.fn(),
  downloadBlob: vi.fn(),
  saveAs: vi.fn(),
  repositorySave: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: vi.fn(),
  readClinicalDerivedBackupDay: mocks.readBackup,
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: mocks.getAllRecords,
  saveRecordsStrict: mocks.saveRecordsStrict,
  getRecordsRange: mocks.getRecordsRange,
  saveRecords: vi.fn(),
  // No local copy: the import guard (P4a) lets every day through.
  getRecordForDateStrict: vi.fn(async () => null),
}));
vi.mock('@/services/storage/firestore', () => ({
  getRecordsRangeFromFirestore: mocks.getRemoteRecordsRange,
}));
vi.mock('@/services/exporters/exportDownload', () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({ getCurrentUserEmail: () => 'admin@hhr' }));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.repositorySave,
}));

import { buildClinicalDerivedBackupSection } from '@/services/exporters/clinicalDerivedBackupSection';
import {
  exportDataJSONWithResult,
  importDataJSONDetailed,
} from '@/services/exporters/exportService';
import {
  exportMonthRecordsWithResult,
  exportYearToDateRecordsWithOutcome,
  importRecordsFromBackup,
  type MonthBackup,
  type YearToDateBackup,
} from '@/services/admin/dataMaintenanceService';

const GENERATION = 'gen_synthetic_a';

const day = (date: string, marker?: unknown) => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: `${date}T10:00:00.000Z`,
    beds: { R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'ep_active' }) },
    discharges: [
      DataFactory.createMockDischarge({
        id: `synthetic-discharge-${date}`,
        clinicalEpisodeId: 'ep_discharged',
        originalData: DataFactory.createMockPatient('R2', { clinicalEpisodeId: 'ep_discharged' }),
      }),
    ],
    ...(marker === undefined ? {} : { clinicalDerivedLayout: marker }),
  }),
  meta: { revision: 2 },
});

const marker = { version: 1, generation: GENERATION };

const episodeDoc = (date: string, clinicalEpisodeId: string) => ({
  schemaVersion: 1,
  date,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  dayRevision: 2,
  vitalSignsHistory: [{ recordedDate: date, recordedAt: `${date} 08:00` }],
});

const docsFor = (date: string) => ({
  status: 'resolved',
  day: day(date, marker),
  docs: [episodeDoc(date, 'ep_active'), episodeDoc(date, 'ep_discharged')],
});

// jsdom's Blob has no text(); FileReader reads it like the import does.
const blobJson = (blob: Blob) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(JSON.parse(String(reader.result)) as Record<string, unknown>);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe('clinicalDerived section of the JSON backups (D10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRecordsStrict.mockResolvedValue({ ok: true });
    mocks.repositorySave.mockResolvedValue(undefined);
  });

  it('lists every marked day: its server documents, or why it could not be read', async () => {
    mocks.readBackup.mockImplementation(async (date: string) =>
      date === '2026-11-03' ? { status: 'failed', code: 'unavailable' } : docsFor(date)
    );

    const section = await buildClinicalDerivedBackupSection([
      day('2026-11-04', marker),
      day('2026-11-01'),
      day('2026-11-03', marker),
      day('2026-11-02', marker),
      day('2026-11-05', { version: 2, generation: 'g' }),
    ]);

    expect(Object.keys(section!)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(section!['2026-11-02']).toEqual({
      status: 'exported',
      layoutGeneration: GENERATION,
      docs: docsFor('2026-11-02').docs,
    });
    expect(section!['2026-11-03']).toEqual({ status: 'unavailable', reason: 'read_failed' });
    expect(section!['2026-11-05']).toEqual({
      status: 'unavailable',
      reason: 'unsupported_layout',
    });
    expect(mocks.readBackup).toHaveBeenCalledTimes(3);
    mocks.readBackup.mock.calls.forEach(call => expect(call[1]).toBe(GENERATION));
  });

  it('reads nothing and adds nothing without a marked day', async () => {
    expect(await buildClinicalDerivedBackupSection([day('2026-11-01')])).toBeUndefined();

    mocks.getAllRecords.mockResolvedValue({ '2026-11-01': day('2026-11-01') });
    expect(await exportDataJSONWithResult()).toMatchObject({ status: 'success', issues: [] });

    expect(await blobJson(mocks.downloadBlob.mock.calls[0][0])).toEqual({
      '2026-11-01': day('2026-11-01'),
    });
    expect(mocks.readBackup).not.toHaveBeenCalled();
    expect(mocks.readDoc).not.toHaveBeenCalled();
  });

  it('adds the section to the local backup and imports its fields into their episode carriers', async () => {
    mocks.readBackup.mockImplementation(async (date: string) => docsFor(date));
    mocks.getAllRecords.mockResolvedValue({
      '2026-11-01': day('2026-11-01'),
      '2026-11-02': day('2026-11-02', marker),
    });

    expect(await exportDataJSONWithResult()).toMatchObject({ status: 'success', issues: [] });
    const backup = await blobJson(mocks.downloadBlob.mock.calls[0][0]);

    expect(backup.clinicalDerived).toEqual({
      '2026-11-02': {
        status: 'exported',
        layoutGeneration: GENERATION,
        docs: docsFor('2026-11-02').docs,
      },
    });
    const file = new File([JSON.stringify(backup)], 'respaldo.json', { type: 'application/json' });
    const imported = await importDataJSONDetailed(file);

    expect(imported).toMatchObject({ success: true, importedCount: 2, skippedEntries: [] });
    const saved = mocks.saveRecordsStrict.mock.calls[0][0] as DailyRecord[];
    expect(saved.map(record => record.date)).toEqual(['2026-11-01', '2026-11-02']);
    const restoredDay = saved.find(record => record.date === '2026-11-02');
    expect(restoredDay?.beds.R1.vitalSignsHistory).toEqual(
      docsFor('2026-11-02').docs[0].vitalSignsHistory
    );
    expect(restoredDay?.discharges[0].originalData?.vitalSignsHistory).toEqual(
      docsFor('2026-11-02').docs[1].vitalSignsHistory
    );
  });

  it('writes the local backup but reports it partial when a split day cannot be read', async () => {
    mocks.readBackup.mockImplementation(async (date: string) =>
      date === '2026-11-03' ? { status: 'failed', code: 'unavailable' } : docsFor(date)
    );
    mocks.getAllRecords.mockResolvedValue({
      '2026-11-02': day('2026-11-02', marker),
      '2026-11-03': day('2026-11-03', marker),
    });

    const outcome = await exportDataJSONWithResult();
    const backup = await blobJson(mocks.downloadBlob.mock.calls[0][0]);

    expect(outcome).toMatchObject({
      status: 'partial',
      data: { exported: true },
      issues: [expect.objectContaining({ code: 'clinical_derived_backup_incomplete' })],
    });
    expect(outcome.userSafeMessage).toContain('2026-11-03');
    expect(outcome.userSafeMessage).not.toContain('2026-11-02');
    expect(backup.clinicalDerived).toMatchObject({
      '2026-11-02': { status: 'exported' },
      '2026-11-03': { status: 'unavailable', reason: 'read_failed' },
    });
  });

  it('adds the section to the monthly backup, and its restore only saves the days', async () => {
    mocks.readBackup.mockResolvedValueOnce({
      status: 'permission_denied',
      code: 'permission-denied',
    });
    mocks.getRecordsRange.mockResolvedValue([day('2026-11-02', marker)]);
    mocks.getRemoteRecordsRange.mockResolvedValue([]);

    const result = await exportMonthRecordsWithResult(2026, 11);
    const backup = (await blobJson(mocks.saveAs.mock.calls[0][0])) as unknown as MonthBackup;

    expect(result).toMatchObject({
      status: 'partial',
      reason: 'clinical_derived_incomplete',
      recordCount: 1,
    });
    expect(result.userSafeMessage).toContain('2026-11-02');
    expect(backup.records).toHaveLength(1);
    expect(backup.clinicalDerived).toEqual({
      '2026-11-02': { status: 'unavailable', reason: 'permission_denied' },
    });
    backup.clinicalDerived = {
      '2026-11-02': { status: 'exported', layoutGeneration: GENERATION, docs: [] },
    };
    expect(await importRecordsFromBackup(backup)).toMatchObject({ success: 1, failed: 0 });
    expect(mocks.repositorySave).toHaveBeenCalledTimes(1);
    expect(mocks.repositorySave.mock.calls[0][0].date).toBe('2026-11-02');
  });

  it('adds the section to the year-to-date backup only when a day is marked', async () => {
    mocks.readBackup.mockImplementation(async (date: string) => docsFor(date));
    mocks.getRemoteRecordsRange.mockResolvedValue([]);
    mocks.getRecordsRange.mockResolvedValueOnce([day('2025-03-01'), day('2025-03-02', marker)]);

    const marked = await exportYearToDateRecordsWithOutcome(2025);
    const markedBackup = (await blobJson(
      mocks.saveAs.mock.calls[0][0]
    )) as unknown as YearToDateBackup;

    expect(marked).toMatchObject({ status: 'success', data: { recordCount: 2 } });
    expect(markedBackup.clinicalDerived).toEqual({
      '2025-03-02': {
        status: 'exported',
        layoutGeneration: GENERATION,
        docs: docsFor('2025-03-02').docs,
      },
    });
    expect(mocks.readBackup).toHaveBeenCalledTimes(1);

    mocks.readBackup.mockClear();
    mocks.getRecordsRange.mockResolvedValueOnce([day('2025-03-01')]);
    const unmarked = await exportYearToDateRecordsWithOutcome(2025);
    const unmarkedBackup = await blobJson(mocks.saveAs.mock.calls[1][0]);

    expect(unmarked).toMatchObject({ status: 'success' });
    expect(unmarkedBackup).not.toHaveProperty('clinicalDerived');
    expect(mocks.readBackup).not.toHaveBeenCalled();
  });

  it('reports a year-to-date backup with an unreadable split day as partial', async () => {
    mocks.readBackup.mockResolvedValue({ status: 'failed', code: 'unavailable' });
    mocks.getRemoteRecordsRange.mockResolvedValue([]);
    mocks.getRecordsRange.mockResolvedValueOnce([day('2025-03-02', marker)]);

    const outcome = await exportYearToDateRecordsWithOutcome(2025);

    expect(outcome).toMatchObject({
      status: 'partial',
      reason: 'clinical_derived_incomplete',
      issues: [expect.objectContaining({ severity: 'warning' })],
    });
    expect(outcome.userSafeMessage).toContain('2025-03-02');
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
  });
});
