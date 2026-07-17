import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  isHistoricalCensusDay,
  toHistoricalClinicalOnlyDiff,
} from '@/features/rayen-import/domain/historicalCensusSync';

const liveDiff = {
  admissions: [{ bedId: 'H5C1' }],
  updates: [{ bedId: 'H4C2' }],
  moves: [{ fromBedId: 'H4C2', toBedId: 'NEO1' }],
  discharges: [{ bedId: 'H3C1' }],
  pendingAdministrativeDischarges: [{ bedId: 'H2C1' }],
  conflicts: [{ bedId: 'H1C1' }],
  reportEgresos: [{}],
  previousDayEdits: [{}],
  unchangedCount: 1,
  summary: {
    admissions: 1,
    updates: 1,
    moves: 1,
    discharges: 1,
    pendingAdministrativeDischarges: 1,
    conflicts: 1,
    unchanged: 1,
  },
} as unknown as CensusImportDiff;

const historicalRecord = {
  date: '2026-07-15',
  beds: {
    H4C2: { patientName: 'Tony Hotumatua Tuki Jimenez' },
    H3C1: {
      patientName: 'Paciente principal',
      clinicalCrib: { patientName: 'RN clinico' },
    },
    NEO1: { patientName: '' },
  },
} as unknown as DailyRecord;

describe('historical census synchronization', () => {
  it('uses the Rapa Nui calendar day to distinguish a historical census', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    expect(isHistoricalCensusDay('2026-07-15', now)).toBe(true);
    expect(isHistoricalCensusDay('2026-07-16', now)).toBe(false);
  });

  it('preserves beds and removes every live structural change from a historical run', () => {
    const diff = toHistoricalClinicalOnlyDiff(liveDiff, historicalRecord);

    expect(diff.admissions).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.moves).toEqual([]);
    expect(diff.discharges).toEqual([]);
    expect(diff.pendingAdministrativeDischarges).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.reportEgresos).toEqual([]);
    expect(diff.previousDayEdits).toEqual([]);
    expect(diff.summary).toMatchObject({
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      unchanged: 3,
    });
  });
});
