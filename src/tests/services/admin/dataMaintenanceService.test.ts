import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const {
  mockGetRecordsRange,
  mockSaveRecords,
  mockGetRemoteRecordsRange,
  mockLogAuditEvent,
  mockSaveAs,
  mockRepositorySave,
} = vi.hoisted(() => ({
  mockGetRecordsRange: vi.fn(),
  mockSaveRecords: vi.fn(),
  mockGetRemoteRecordsRange: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockSaveAs: vi.fn(),
  mockRepositorySave: vi.fn(),
}));

import {
  exportMonthRecords,
  exportMonthRecordsWithOutcome,
  exportMonthRecordsWithResult,
  exportYearToDateRecords,
  exportYearToDateRecordsWithOutcome,
  exportYearToDateRecordsWithResult,
  importRecordsFromBackup,
} from '@/services/admin/dataMaintenanceService';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordsRange: mockGetRecordsRange,
  saveRecords: mockSaveRecords,
}));

vi.mock('@/services/storage/firestore', () => ({
  getRecordsRangeFromFirestore: mockGetRemoteRecordsRange,
}));

vi.mock('@/services/admin/auditService', () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@hanga.roa',
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => true,
}));

vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mockRepositorySave,
}));

vi.mock('file-saver', () => ({
  saveAs: mockSaveAs,
}));

describe('dataMaintenanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockRepositorySave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports year-to-date records using a bounded date range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T10:00:00-06:00'));

    mockGetRecordsRange.mockResolvedValue([
      {
        date: '2026-01-01',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-01-01T08:00:00.000Z',
      },
    ]);
    mockGetRemoteRecordsRange.mockResolvedValue([
      {
        date: '2026-01-01',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-01-01T10:00:00.000Z',
      },
      {
        date: '2026-03-03',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-03T10:00:00.000Z',
      },
    ]);

    await exportYearToDateRecords(2026);

    expect(mockGetRecordsRange).toHaveBeenCalledWith('2026-01-01', '2026-03-03');
    expect(mockGetRemoteRecordsRange).toHaveBeenCalledWith('2026-01-01', '2026-03-03');
    expect(mockSaveRecords).toHaveBeenCalledTimes(1);
    expect(mockSaveAs).toHaveBeenCalledTimes(1);
    expect(mockSaveAs.mock.calls[0]?.[1]).toContain('Respaldo HHR 2026 hasta Marzo_03.json');
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      'admin@hanga.roa',
      'DATA_EXPORTED',
      'dailyRecord',
      '2026-YTD',
      expect.objectContaining({
        year: 2026,
        throughDate: '2026-03-03',
        recordCount: 2,
        exportScope: 'year-to-date',
      })
    );
  });

  it('throws when there are no records to export for the selected annual range', async () => {
    mockGetRecordsRange.mockResolvedValue([]);
    mockGetRemoteRecordsRange.mockResolvedValue([]);

    await expect(exportYearToDateRecords(2026)).rejects.toThrow(
      'No hay registros para exportar en el rango anual seleccionado.'
    );

    await expect(exportYearToDateRecordsWithResult(2026)).resolves.toMatchObject({
      status: 'failed',
      reason: 'no_records',
      userSafeMessage: 'No hay registros para exportar en el rango anual seleccionado.',
    });

    await expect(exportYearToDateRecordsWithOutcome(2026)).resolves.toMatchObject({
      status: 'failed',
      reason: 'no_records',
      userSafeMessage: 'No hay registros para exportar en el rango anual seleccionado.',
      issues: [expect.objectContaining({ kind: 'not_found' })],
    });
  });

  it('exports monthly records after hydrating the selected range from Firestore', async () => {
    mockGetRecordsRange.mockResolvedValue([
      {
        date: '2026-03-01',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-01T08:00:00.000Z',
      },
    ]);
    mockGetRemoteRecordsRange.mockResolvedValue([
      {
        date: '2026-03-01',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-01T10:00:00.000Z',
      },
      {
        date: '2026-03-02',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-02T10:00:00.000Z',
      },
    ]);

    await exportMonthRecords(2026, 3);

    expect(mockGetRecordsRange).toHaveBeenCalledWith('2026-03-01', '2026-03-31');
    expect(mockGetRemoteRecordsRange).toHaveBeenCalledWith('2026-03-01', '2026-03-31');
    expect(mockSaveRecords).toHaveBeenCalledTimes(1);
    expect(mockSaveAs.mock.calls.at(-1)?.[1]).toContain('Respaldo HHR Marzo 2026.json');
  });

  it('returns a success result for monthly exports through the new explicit contract', async () => {
    mockGetRecordsRange.mockResolvedValue([
      {
        date: '2026-03-01',
        beds: {},
        activeExtraBeds: [],
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-01T08:00:00.000Z',
      },
    ]);
    mockGetRemoteRecordsRange.mockResolvedValue([]);

    await expect(exportMonthRecordsWithResult(2026, 3)).resolves.toMatchObject({
      status: 'success',
      reason: 'unknown',
    });

    await expect(exportMonthRecordsWithOutcome(2026, 3)).resolves.toMatchObject({
      status: 'success',
      data: expect.objectContaining({
        status: 'success',
      }),
    });
  });

  it('repairs legacy records during backup import and reports repaired count', async () => {
    const result = await importRecordsFromBackup({
      version: '1.0',
      exportDate: '2026-03-03T10:00:00.000Z',
      year: 2026,
      month: 3,
      recordCount: 1,
      records: [
        {
          date: '2026-03-03',
          beds: {
            R1: {
              patientName: 'Paciente Legacy',
              status: 'ESTADO_INVALIDO',
              clinicalEvents: [null],
            },
          },
          discharges: [],
          transfers: [],
          cma: [],
          activeExtraBeds: [],
          lastUpdated: '2026-03-03T10:00:00.000Z',
        } as unknown as DailyRecord,
      ],
    });

    expect(result).toEqual({ success: 1, failed: 0, repaired: 1, outcome: 'repaired' });
    expect(mockRepositorySave).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-03',
        beds: expect.objectContaining({
          R1: expect.objectContaining({ patientName: 'Paciente Legacy' }),
        }),
      }),
      undefined,
      { writeOrigin: 'backup_restore' }
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      'admin@hanga.roa',
      'DATA_IMPORTED',
      'dailyRecord',
      '2026-3',
      expect.objectContaining({ repairedCount: 1, outcome: 'repaired' })
    );
  });
});
