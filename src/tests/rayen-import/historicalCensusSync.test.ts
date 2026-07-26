import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS,
  classifyCensusSyncTargetDay,
  isCurrentCensusDay,
  isHistoricalCensusDay,
  isHistoricalCensusSyncDay,
  isPreviousCensusDay,
  isSupportedCensusSyncDay,
  resolveCensusSyncTarget,
  toSafeHistoricalDiff,
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
    H4C2: {
      patientName: 'Tony Hotumatua Tuki Jimenez',
      rut: '17.752.753-1',
      clinicalEpisodeId: 'MOTHER-EPISODE',
    },
    H3C1: {
      patientName: 'Paciente principal',
      clinicalCrib: { patientName: 'RN clinico' },
    },
    NEO1: { patientName: '' },
  },
} as unknown as DailyRecord;

describe('historical census synchronization', () => {
  it('uses the Rapa Nui calendar day to distinguish a historical census', () => {
    const now = new Date('2026-07-16T18:00:00.000Z');
    expect(isHistoricalCensusDay('2026-07-15', now)).toBe(true);
    expect(isHistoricalCensusDay('2026-07-16', now)).toBe(false);
  });

  it('keeps the previous calendar date current until the nursing handoff', () => {
    // Saturday 08:30 in Rapa Nui: Friday night is still the active census (09:00 handoff).
    const beforeWeekendHandoff = new Date('2026-07-25T14:30:00.000Z');
    expect(isCurrentCensusDay('2026-07-24', beforeWeekendHandoff)).toBe(true);
    expect(isPreviousCensusDay('2026-07-23', beforeWeekendHandoff)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-25', beforeWeekendHandoff)).toBe(false);

    const afterWeekendHandoff = new Date('2026-07-25T15:01:00.000Z');
    expect(isCurrentCensusDay('2026-07-25', afterWeekendHandoff)).toBe(true);
    expect(isPreviousCensusDay('2026-07-24', afterWeekendHandoff)).toBe(true);
  });

  it('supports the current Rapa Nui clinical day and D-1 through D-7', () => {
    const now = new Date('2026-07-16T18:00:00.000Z');
    expect(MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS).toBe(7);
    expect(isSupportedCensusSyncDay('2026-07-16', now)).toBe(true);
    expect(isPreviousCensusDay('2026-07-15', now)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-15', now)).toBe(true);
    expect(isHistoricalCensusSyncDay('2026-07-09', now)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-09', now)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-08', now)).toBe(false);
    expect(isSupportedCensusSyncDay('2026-07-17', now)).toBe(false);
    expect(isSupportedCensusSyncDay('2026-02-31', now)).toBe(false);
    expect(classifyCensusSyncTargetDay('2026-07-09', now)).toBe('historical');
    expect(resolveCensusSyncTarget('2026-07-09', now)).toMatchObject({
      clinicalDay: '2026-07-16',
      kind: 'historical',
      lookbackDays: 7,
    });
  });

  it('preserves beds and removes every live structural change from a historical run', () => {
    const diff = toSafeHistoricalDiff(liveDiff, historicalRecord);

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

  it('retains only a reviewable attached-crib backfill that already existed on that day', () => {
    const child = {
      patientName: 'RN de Paciente principal',
      clinicalEpisodeId: 'RN-EPISODE',
      admissionDate: '2026-07-15',
    };
    const candidate = {
      ...liveDiff,
      updates: [
        {
          bedId: 'H4C2',
          rut: '',
          patientName: child.patientName,
          patient: historicalRecord.beds.H4C2,
          source: {
            encounterId: 'RN-EPISODE',
            clinicalCribParentBedId: 'H4C2',
            hasMedicalDischarge: false,
          },
          changes: [{ field: 'clinicalCrib', from: undefined, to: child }],
        },
      ],
    } as unknown as CensusImportDiff;

    const diff = toSafeHistoricalDiff(candidate, historicalRecord);

    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]).toMatchObject({ bedId: 'H4C2', patientName: child.patientName });
    expect(diff.summary.updates).toBe(1);
    expect(diff.admissions).toEqual([]);
    expect(diff.moves).toEqual([]);
    expect(diff.discharges).toEqual([]);
  });

  it('rejects an attached crib whose episode starts after the historical census day', () => {
    const futureChild = {
      patientName: 'RN futuro',
      clinicalEpisodeId: 'RN-FUTURE',
      admissionDate: '2026-07-16',
    };
    const candidate = {
      ...liveDiff,
      updates: [
        {
          bedId: 'H4C2',
          rut: '',
          patientName: futureChild.patientName,
          patient: historicalRecord.beds.H4C2,
          source: {
            encounterId: 'RN-FUTURE',
            clinicalCribParentBedId: 'H4C2',
            hasMedicalDischarge: false,
          },
          changes: [{ field: 'clinicalCrib', from: undefined, to: futureChild }],
        },
      ],
    } as unknown as CensusImportDiff;

    expect(toSafeHistoricalDiff(candidate, historicalRecord).updates).toEqual([]);
  });

  it('rejects a crib after the newborn episode had already ended', () => {
    const child = {
      patientName: 'RN egresado',
      clinicalEpisodeId: 'RN-DISCHARGED',
      admissionDate: '2026-07-10',
    };
    const candidate = {
      ...liveDiff,
      updates: [
        {
          bedId: 'H4C2',
          rut: '',
          patientName: child.patientName,
          patient: historicalRecord.beds.H4C2,
          source: {
            encounterId: 'RN-DISCHARGED',
            clinicalCribParentBedId: 'H4C2',
            hasMedicalDischarge: true,
            dischargeDatetime: '2026-07-14T20:00:00-06:00',
          },
          changes: [{ field: 'clinicalCrib', from: undefined, to: child }],
        },
      ],
    } as unknown as CensusImportDiff;

    expect(toSafeHistoricalDiff(candidate, historicalRecord).updates).toEqual([]);
  });

  it('rejects a crib when the historical bed belongs to a different principal episode', () => {
    const child = {
      patientName: 'RN de otra madre',
      clinicalEpisodeId: 'RN-OTHER-MOTHER',
      admissionDate: '2026-07-15',
    };
    const candidate = {
      ...liveDiff,
      updates: [
        {
          bedId: 'H4C2',
          rut: '',
          patientName: child.patientName,
          patient: {
            ...historicalRecord.beds.H4C2,
            rut: '11.111.111-1',
            clinicalEpisodeId: 'OTHER-MOTHER-EPISODE',
          },
          source: {
            encounterId: 'RN-OTHER-MOTHER',
            clinicalCribParentBedId: 'H4C2',
            hasMedicalDischarge: false,
          },
          changes: [{ field: 'clinicalCrib', from: undefined, to: child }],
        },
      ],
    } as unknown as CensusImportDiff;

    expect(toSafeHistoricalDiff(candidate, historicalRecord).updates).toEqual([]);
  });

  it('rejects a crib update that is not explicitly attached to the same principal bed', () => {
    const child = {
      patientName: 'RN ambiguo',
      clinicalEpisodeId: 'RN-AMBIGUOUS',
      admissionDate: '2026-07-15',
    };
    const candidate = {
      ...liveDiff,
      updates: [
        {
          bedId: 'H4C2',
          rut: '',
          patientName: child.patientName,
          patient: historicalRecord.beds.H4C2,
          source: { encounterId: 'RN-AMBIGUOUS' },
          changes: [{ field: 'clinicalCrib', from: undefined, to: child }],
        },
      ],
    } as unknown as CensusImportDiff;

    expect(toSafeHistoricalDiff(candidate, historicalRecord).updates).toEqual([]);
  });
});
