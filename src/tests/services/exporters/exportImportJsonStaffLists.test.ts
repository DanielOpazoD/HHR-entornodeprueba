import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import { resolveDetailedStaffingState } from '@/services/staff/dailyRecordDetailedStaffing';

const storage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: storage.read,
}));

vi.mock('@/services/repositories/dailyRecordBackupImportWriteService', () => ({
  saveBackupImport: async (records: unknown[]) => {
    if (records.length) await storage.save(records);
    return [];
  },
}));

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';

const DATE = '2026-10-24';
const patient = { bedId: 'R1', patientName: 'PACIENTE SINTETICO', rut: '12.345.678-5' };
const backup = (day: Record<string, unknown>) =>
  new File(
    [JSON.stringify({ [DATE]: { date: DATE, beds: { R1: patient }, ...day } })],
    'synthetic.json',
    { type: 'application/json' }
  );

beforeEach(() => {
  vi.clearAllMocks();
  storage.read.mockResolvedValue(null);
});

describe('a backup day whose staff list carries an item that is not text', () => {
  it('is imported with its patients, and the damaged item empties only its own slot', async () => {
    const result = await importDataJSONDetailed(
      backup({
        nursesDayShift: ['Ana Pérez', 7],
        nursesNightShift: [{ name: 'x' }, 'Ñusta Tuki'],
        tensDayShift: [7, 'Rosa', 'María José'],
      })
    );

    expect(result).toMatchObject({
      success: true,
      outcome: 'repaired',
      importedCount: 1,
      repairedCount: 1,
      skippedEntries: [],
    });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(saved[0].beds.R1).toMatchObject(patient);
    expect(saved[0].nursesDayShift).toEqual(['Ana Pérez']);
    expect(saved[0].nurses).toEqual(['Ana Pérez']);
    // Staff lists are positional: Ñusta Tuki stays in slot 2 behind the emptied damaged item.
    expect(saved[0].nursesNightShift).toEqual(['', 'Ñusta Tuki']);
    expect(saved[0].tensDayShift).toEqual(['', 'Rosa', 'María José']);
    // The shift grid shows TENS by standard slot: Rosa stays in slot 2, María José in slot 3.
    const tensDay = resolveDetailedStaffingState(saved[0], DATE).day.tens;
    expect(tensDay.map(person => [person.standardSlotIndex, person.name])).toEqual([
      [0, ''],
      [1, 'Rosa'],
      [2, 'María José'],
    ]);
  });

  it('keeps the legacy nurse list when it is the only one, without its damaged item', async () => {
    const result = await importDataJSONDetailed(backup({ nurses: ['Ana', 7] }));

    expect(result).toMatchObject({
      success: true,
      outcome: 'repaired',
      importedCount: 1,
      repairedCount: 1,
      skippedEntries: [],
    });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(saved[0].nursesDayShift).toEqual(['Ana']);
  });
});

describe('salvaging the other text lists of a day', () => {
  it('empties the damaged staff slot in place and drops a damaged extra-bed id', () => {
    const { record } = parseDailyRecordWithDefaultsReport(
      {
        date: DATE,
        beds: { R1: { bedId: 'R1', patientName: 42 } },
        tensNightShift: ['Hina', 3, 'Rosa'],
        activeExtraBeds: ['E1', { id: 'E2' }],
        handoffNightReceives: [false, 'Ana'],
      },
      DATE
    );

    expect(record.tensNightShift).toEqual(['Hina', '', 'Rosa']);
    expect(record.activeExtraBeds).toEqual(['E1']);
    expect(record.handoffNightReceives).toEqual(['', 'Ana']);
  });

  it('names each list it repaired in the report, without its names', () => {
    const { report } = parseDailyRecordWithDefaultsReport(
      {
        date: DATE,
        beds: {},
        nurses: ['Ana', 7],
        tensDayShift: ['Rosa', 3],
        tensNightShift: ['Hina'],
      },
      DATE
    );

    expect(report.discardedTopLevelFields).toEqual(['nurses', 'tensDayShift']);
  });
});
