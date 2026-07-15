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
  reason: 'administrative-discharge',
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

  it('skips a patient already recorded as discharged that day, even with a DIFFERENT id (dedup by RUT)', () => {
    // A discharge the nurse (or another path) already filed has a different id than our deterministic
    // one, so id-only dedup would append a SECOND egreso for the same patient.
    const alreadyDischarged = {
      id: 'manual-abc',
      rut: '19.338.541-9',
      patientName: 'Haggen Estefanis Roe',
      movementDate: '2026-07-11',
      time: '18:00',
      dischargeType: 'Domicilio (Habitual)',
      status: 'Vivo',
      bedId: 'NEO1',
    } as unknown as DailyRecord['discharges'][number];
    const result = applyCrossDayDiff(
      makeRecord('2026-07-11', { discharges: [alreadyDischarged] }),
      [{ entry: entry(), patient: haggen() }],
      ctx
    );
    expect(result.applied).toBe(0);
    expect(result.record.discharges).toHaveLength(1); // not doubled
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

  it('falls back to the bed for the id when the RUT is blank (no silent collapse)', () => {
    // PatientData.rut defaults to '': two blank-RUT discharges on the same day must NOT collapse
    // to one id and drop a movement — the bed disambiguates them.
    const result = applyCrossDayDiff(
      makeRecord('2026-07-11'),
      [
        { entry: entry({ rut: '', bedId: 'NEO1' }), patient: haggen({ rut: '' }) },
        {
          entry: entry({ rut: '', bedId: 'NEO2' }),
          patient: haggen({ rut: '', patientName: 'Otro' }),
        },
      ],
      ctx
    );
    expect(result.applied).toBe(2);
    expect(result.record.discharges.map(discharge => discharge.id)).toEqual([
      'rayen-egreso:bed-NEO1:2026-07-11',
      'rayen-egreso:bed-NEO2:2026-07-11',
    ]);
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
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
    ...over,
  });
  const probes = {
    recordExists: () => true,
    withinEditingWindow: () => true,
    isSigned: () => false,
    alreadyDischarged: () => false,
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

  it('omits a patient whose egreso is ALREADY consigned that day (verified by RUT)', () => {
    const edits = planPreviousDayEdits(
      diff({
        discharges: [
          entry({ rut: '19.338.541-9', correctedDay: '2026-07-11', patientName: 'YaEgresado' }),
          entry({ rut: '5-2', correctedDay: '2026-07-11', patientName: 'Falta' }),
        ],
      }),
      '2026-07-12',
      { ...probes, alreadyDischarged: (_day, rut) => rut === '19.338.541-9' }
    );
    // Only the still-missing patient survives; the already-recorded one is dropped from the message.
    expect(edits).toHaveLength(1);
    expect(edits[0].patientNames).toEqual(['Falta']);
  });

  it('reflects the probe flags per day (out-of-window / signed)', () => {
    const edits = planPreviousDayEdits(
      diff({ discharges: [entry({ correctedDay: '2026-07-09' })] }),
      '2026-07-12',
      {
        recordExists: () => true,
        withinEditingWindow: () => false,
        isSigned: () => true,
        alreadyDischarged: () => false,
      }
    );
    expect(edits[0]).toMatchObject({
      day: '2026-07-09',
      withinEditingWindow: false,
      isSigned: true,
    });
  });

  it('also includes a report egreso (unknown RUN) attributed to an earlier island day', () => {
    const edits = planPreviousDayEdits(
      diff({
        reportEgresos: [
          {
            run: '18.658.566-6',
            patientName: 'Koarahi Castillo',
            bedLabel: 'H1C1',
            destino: 'Domicilio',
            fechaEgreso: '11-07-2026 22:00',
            kind: 'alta',
            status: 'Vivo',
            correctedDay: '2026-07-11',
            correctedTime: '20:00',
          },
        ],
      }),
      '2026-07-12',
      probes
    );
    expect(edits.find(edit => edit.day === '2026-07-11')?.patientNames).toContain(
      'Koarahi Castillo'
    );
  });
});
