import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  rayenToPatientData,
  reconcileCensus,
  type EgresoReportRow,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { reportRowFromLookup } from '@/features/rayen-import/domain/applyEgresoLookupFallback';
import {
  correctedStamp,
  reportEgresoFromRow,
  reportPredatesAdmission,
} from '@/features/rayen-import/domain/egresoReportPolicy';
import {
  latestReportRowsByEpisode,
  reportClinicalStamp,
} from '@/features/rayen-import/domain/historicalAdministrativeEvidence';
import { reportEgresoEntry } from '@/features/rayen-import/mapping/reportEgresoMapping';
import {
  buildDischarge,
  buildTransfer,
} from '@/features/rayen-import/domain/applyCensusImportDiff';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import { planClinicalCribDischargeRepairs } from '@/features/rayen-import/domain/clinicalCribDischargeRepairs';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import { repairRecord } from './clinicalCribDischargeRepairs.fixtures';

// Friday 2026-11-06 hands over at 08:00 and Saturday at 09:00, so Friday 08:30 and Saturday 08:30
// both belong to Friday's census. Only the official calendar day tells them apart.
const REFERENCE = new Date('2026-11-07T15:00:00Z');
const ctx = { idFactory: () => 'movement-id', now: REFERENCE, syncRunId: 'sync-run' };
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '91001',
  run: '123456785',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'Sala 1',
  bed: 'R2',
  admissionDatetime: '2026-11-05T10:00:00-05:00',
  ...overrides,
});

const recordFor = (date: string): DailyRecord => ({
  date,
  beds: { R2: { ...rayenToPatientData(encounter(), REFERENCE).patient, bedId: 'R2' } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const row = (fechaEgreso: string, destino = 'Domicilio'): EgresoReportRow => ({
  run: '12.345.678-5',
  encounterId: '91001',
  patientName: 'Paciente Sintético',
  bedLabel: 'R2',
  servicio: 'Área Médico Quirúrgica',
  edad: '',
  destino,
  motivo: 'Alta hospitalaria',
  fechaEgreso,
});

/** Source row → reviewed diff → applied movement → stored record read back. */
const fileAndReread = (census: string, ...sources: EgresoReportRow[]) => {
  const current = recordFor(census);
  const snapshot: RayenCensusSnapshot = {
    capturedAt: '2026-11-07T15:00:00Z',
    facilityId: 1342,
    isComplete: true,
    encounters: [encounter({ hasMedicalDischarge: true })],
  };
  const diff = applyEgresoReport(
    reconcileCensus(current, snapshot, { reference: REFERENCE }),
    sources,
    current
  );
  const applied = applyCensusImportDiff(current, diff, ctx).record;
  const reread = migrateLegacyDataWithReport(applied, census).record;
  const movement = [...reread.discharges, ...reread.transfers][0];
  return { diff, applied, movement };
};

describe('official egreso calendar day from the source to the movement and back', () => {
  it.each([
    ['Friday 08:30, after the weekday 08:00 handoff', '06-11-2026 08:30', '2026-11-06'],
    ['Saturday 08:30, before the weekend 09:00 handoff', '07-11-2026 08:30', '2026-11-07'],
    ['Friday 23:50, before midnight', '06-11-2026 23:50', '2026-11-06'],
    ['Saturday 00:10, after midnight', '07-11-2026 00:10', '2026-11-07'],
  ])('files %s on the Friday census with its own date', (_label, fechaEgreso, calendarDay) => {
    const { diff, movement } = fileAndReread('2026-11-06', row(fechaEgreso));

    expect(diff.discharges).toEqual([
      expect.objectContaining({ correctedDay: '2026-11-06', correctedCalendarDay: calendarDay }),
    ]);
    expect(movement).toMatchObject({
      movementDate: calendarDay,
      movementDateSource: 'official',
      time: fechaEgreso.slice(11),
    });
  });

  it('keeps the weekday 08:00 handoff: 07:59 is the previous census, 08:00 its own', () => {
    expect(correctedStamp('10-11-2026 07:59')).toEqual({
      correctedDay: '2026-11-09',
      correctedTime: '07:59',
      correctedCalendarDay: '2026-11-10',
    });
    expect(correctedStamp('10-11-2026 08:00')).toEqual({
      correctedDay: '2026-11-10',
      correctedTime: '08:00',
      correctedCalendarDay: '2026-11-10',
    });
    const { movement } = fileAndReread('2026-11-09', row('10-11-2026 07:59', 'Traslado'));
    expect(movement).toMatchObject({ movementDate: '2026-11-10', time: '07:59' });
  });

  it.each([
    ['Z', '2026-11-06T13:30:00Z'],
    ['-03:00', '2026-11-06T10:30:00-03:00'],
    ['local Rapa Nui clock', '2026-11-06T08:30:00'],
  ])('reads an exact episode lookup with %s as Friday 08:30', (_label, dateDischarge) => {
    const lookupRow = reportRowFromLookup(
      {
        run: '12.345.678-5',
        encounterId: '91001',
        egreso: { dateDischarge, hasAdministrativeDischarge: true },
      },
      { patientName: 'Paciente Sintético', bedId: 'R2' }
    );
    expect(lookupRow).toMatchObject({
      correctedDay: '2026-11-06',
      correctedCalendarDay: '2026-11-06',
      correctedTime: '08:30',
    });
    const egreso = reportEgresoFromRow(lookupRow);
    const record = recordFor('2026-11-06');
    expect(buildTransfer(record.beds.R2, reportEgresoEntry(egreso), record, ctx)).toMatchObject({
      movementDate: '2026-11-06',
      movementDateSource: 'official',
    });
  });

  it('keeps the reconstructed date for entries and stored rows without an official calendar day', () => {
    const record = recordFor('2026-11-06');
    const legacyEntry = {
      ...reportEgresoEntry(reportEgresoFromRow(row('06-11-2026 08:30'))),
      correctedCalendarDay: undefined,
    };
    const built = buildDischarge(record.beds.R2, legacyEntry, record, ctx);
    expect(built.movementDate).toBe('2026-11-07');
    expect(built.movementDateSource).toBeUndefined();

    // A pre-fix import stored the census day; the read repair still applies to it.
    const stored = { ...built, movementDate: '2026-11-06' };
    const reread = migrateLegacyDataWithReport({ ...record, discharges: [stored] }, '2026-11-06');
    expect(reread.record.discharges[0].movementDate).toBe('2026-11-07');
  });

  it('still offers the newborn duplicate repair for a Friday 08:30 official departure', () => {
    const base = repairRecord();
    const friday = (movement: DischargeData): DischargeData => ({
      ...movement,
      movementDate: '2026-11-06',
      movementDateSource: 'official',
      time: '08:30',
    });
    const record = { ...base, date: '2026-11-06', discharges: base.discharges.map(friday) };
    expect(planClinicalCribDischargeRepairs(record)).toEqual([
      expect.objectContaining({ duplicate: expect.objectContaining({ id: 'sparse-rn' }) }),
    ]);
  });

  it('ignores an official calendar day that is impossible or outside its census shift', () => {
    const legacy = {
      ...row('06-11-2026 08:30'),
      correctedDay: '2026-11-06',
      correctedTime: '08:30',
    };
    // Sunday 8 is outside Friday's census at 08:30; 31 November does not exist. Both rows read
    // exactly like a row without a calendar day, as on main.
    for (const correctedCalendarDay of ['2026-11-08', '2026-11-31']) {
      expect(correctedStamp('', '2026-11-06', '08:30', correctedCalendarDay)).toEqual({
        correctedDay: '2026-11-06',
        correctedTime: '08:30',
      });
      expect(reportClinicalStamp({ ...legacy, correctedCalendarDay })).toEqual(
        reportClinicalStamp(legacy)
      );
    }
    expect(reportClinicalStamp(legacy)).toEqual({
      iso: '2026-11-06',
      calendarIso: '2026-11-06',
      hhmm: '08:30',
    });
  });

  it('orders two rows of one episode by calendar day and time, whichever comes first', () => {
    const friday = row('06-11-2026 08:30');
    const saturday = row('07-11-2026 08:30');
    for (const rows of [
      [friday, saturday],
      [saturday, friday],
    ]) {
      expect(latestReportRowsByEpisode(rows).get('91001')).toBe(saturday);
      expect(fileAndReread('2026-11-06', ...rows).movement).toMatchObject({
        movementDate: '2026-11-07',
        movementDateSource: 'official',
      });
    }
  });

  it('compares the admission on the official calendar day and keeps the history choice', () => {
    const friday = correctedStamp('06-11-2026 08:30');
    expect(
      reportPredatesAdmission(
        { iso: friday.correctedDay!, hhmm: friday.correctedTime!, calendarIso: '2026-11-06' },
        { admissionDate: '2026-11-06', admissionTime: '12:00' }
      )
    ).toBe(true);

    const late = row('04-11-2026 21:30');
    const early = {
      ...row('05-11-2026 00:30'),
      ...correctedStamp('05-11-2026 00:30'),
    };
    expect(reportClinicalStamp(early)).toEqual({
      iso: '2026-11-04',
      calendarIso: '2026-11-05',
      hhmm: '00:30',
    });
    // The history keeps main's choice between rows; the calendar day only breaks its ties.
    expect(latestReportRowsByEpisode([late, early]).get('91001')).toBe(late);
  });
});
