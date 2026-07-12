import { describe, expect, it } from 'vitest';
import { applyCrossDayDiff } from '@/features/rayen-import/domain/applyCrossDayDiff';
import { planPreviousDayEdits } from '@/features/rayen-import/domain/planPreviousDayEdits';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type {
  CensusImportDiff,
  DischargeEntry,
} from '@/features/rayen-import/contracts/censusImportDiff';

const NOW = new Date(2026, 6, 12, 15, 30, 0);
const ctx = { idFactory: () => 'random-id', now: NOW };

const makeRecord = (date: string, over: Partial<DailyRecord> = {}): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
  ...over,
});

const haggen = (over: Partial<PatientData> = {}): PatientData =>
  ({
    ...EMPTY_PATIENT,
    patientName: 'Haggen Estefanis Roe',
    rut: '19.338.541-9',
    pathology: 'Dx',
    ...over,
  }) as PatientData;

const entry = (over: Partial<DischargeEntry> = {}): DischargeEntry => ({
  bedId: 'NEO1',
  rut: '19.338.541-9',
  patientName: 'Haggen Estefanis Roe',
  kind: 'alta',
  status: 'Vivo',
  reason: 'rayen-discharge',
  correctedDay: '2026-07-11',
  correctedTime: '20:54',
  ...over,
});

describe('applyCrossDayDiff', () => {
  it('files the discharge on the previous day with the corrected island time + deterministic id', () => {
    const result = applyCrossDayDiff(
      makeRecord('2026-07-11'),
      [{ entry: entry(), patient: haggen() }],
      ctx
    );
    expect(result.applied).toBe(1);
    expect(result.record.discharges).toHaveLength(1);
    expect(result.record.discharges[0]).toMatchObject({
      id: 'rayen-egreso:193385419:2026-07-11',
      movementDate: '2026-07-11',
      time: '20:54',
      patientName: 'Haggen Estefanis Roe',
    });
    // never touches beds on the historical day
    expect(result.record.beds).toEqual({});
  });

  it('is idempotent — re-applying the same egreso does not duplicate (same deterministic id)', () => {
    const first = applyCrossDayDiff(
      makeRecord('2026-07-11'),
      [{ entry: entry(), patient: haggen() }],
      ctx
    );
    const second = applyCrossDayDiff(first.record, [{ entry: entry(), patient: haggen() }], ctx);
    expect(second.applied).toBe(0);
    expect(second.record.discharges).toHaveLength(1);
  });

  it('routes a traslado into transfers[] with the corrected time', () => {
    const result = applyCrossDayDiff(
      makeRecord('2026-07-11'),
      [{ entry: entry({ kind: 'traslado', correctedTime: '18:00' }), patient: haggen() }],
      ctx
    );
    expect(result.record.transfers).toHaveLength(1);
    expect(result.record.transfers[0]).toMatchObject({ time: '18:00', movementDate: '2026-07-11' });
    expect(result.record.discharges).toHaveLength(0);
  });
});

describe('planPreviousDayEdits', () => {
  const diff = (over: Partial<CensusImportDiff>): CensusImportDiff => ({
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingNursingDischarges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingNursingDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
    ...over,
  });
  const probes = {
    recordExists: () => true,
    withinEditingWindow: () => true,
    isSigned: () => false,
  };

  it('collects only discharges whose corrected island day is earlier than the census day', () => {
    const edits = planPreviousDayEdits(
      diff({
        discharges: [
          entry({ correctedDay: '2026-07-11', patientName: 'Haggen' }), // earlier → included
          entry({ rut: '2-7', correctedDay: '2026-07-12', patientName: 'Hoy' }), // same day → excluded
          entry({ rut: '3-5', correctedDay: undefined, patientName: 'SinFecha' }), // no day → excluded
        ],
      }),
      '2026-07-12',
      probes
    );
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      day: '2026-07-11',
      reason: 'discharge-day-correction',
      patientNames: ['Haggen'],
      withinEditingWindow: true,
      isSigned: false,
    });
  });

  it('reflects the probe flags per day (out-of-window / signed)', () => {
    const edits = planPreviousDayEdits(
      diff({ discharges: [entry({ correctedDay: '2026-07-09' })] }),
      '2026-07-12',
      { recordExists: () => true, withinEditingWindow: () => false, isSigned: () => true }
    );
    expect(edits[0]).toMatchObject({
      day: '2026-07-09',
      withinEditingWindow: false,
      isSigned: true,
    });
  });
});
