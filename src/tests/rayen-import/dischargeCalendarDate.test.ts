import { describe, expect, it } from 'vitest';
import {
  buildDischarge,
  buildTransfer,
} from '@/features/rayen-import/domain/applyCensusImportDiff';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DischargeEntry } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  calendarDateForMovement,
  recoverImportedMovementCalendarDate,
} from '@/utils/movementCalendarDate';

const censusDate = '2026-10-09';
const entry: DischargeEntry = {
  bedId: 'H4C2',
  rut: '11.111.111-1',
  patientName: 'Paciente Sintético',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  correctedDay: censusDate,
  correctedTime: '01:42',
};
const context = {
  idFactory: () => 'synthetic-discharge',
  now: new Date('2026-10-10T13:38:00Z'),
  syncRunId: 'synthetic-run',
};

describe('discharge calendar date versus nursing census', () => {
  it.each([
    ['2026-10-09', '08:59', '2026-10-10'],
    ['2026-10-09', '09:00', '2026-10-09'],
    ['2026-10-12', '07:59', '2026-10-13'],
    ['2026-10-12', '08:00', '2026-10-12'],
    ['2026-08-31', '01:42', '2026-09-01'],
    ['2026-12-31', '01:42', '2027-01-01'],
    ['2026-10-09', '99:99', '2026-10-09'],
  ])('uses the shift boundary for %s at %s', (day, time, expected) => {
    expect(calendarDateForMovement(day, time)).toBe(expected);
  });

  it('preserves explicit manual calendar dates and already-correct imported dates', () => {
    const manual = DataFactory.createMockDischarge({
      movementDate: censusDate,
      time: '01:42',
      movementProvenance: {
        source: 'manual',
        lineageId: 'manual',
        classifiedAt: context.now.toISOString(),
      },
    });
    expect(recoverImportedMovementCalendarDate(manual, censusDate)).toBe(manual);
    const corrected = {
      ...manual,
      movementDate: '2026-10-10',
      movementProvenance: {
        source: 'gestion_camas' as const,
        lineageId: 'imported',
        classifiedAt: context.now.toISOString(),
        syncRunId: context.syncRunId,
      },
    };
    expect(recoverImportedMovementCalendarDate(corrected, censusDate)).toBe(corrected);
  });
  it.each(['alta', 'traslado'] as const)(
    'files %s in D with the actual D+1 calendar date',
    kind => {
      const record = DataFactory.createMockDailyRecord(censusDate);
      const patient = DataFactory.createMockPatient();
      const result =
        kind === 'alta'
          ? buildDischarge(patient, entry, record, context)
          : buildTransfer(patient, { ...entry, kind }, record, context);
      expect(record.date).toBe(censusDate);
      expect(result.movementDate).toBe('2026-10-10');
      expect(result.time).toBe('01:42');
      expect(result.movementProvenance?.classifiedAt).toBe(context.now.toISOString());
    }
  );

  it('repairs imported legacy dates on read without changing the stored source or census day', () => {
    const discharge = DataFactory.createMockDischarge({
      movementDate: censusDate,
      time: '01:42',
      movementProvenance: {
        source: 'gestion_camas',
        lineageId: 'synthetic-discharge',
        classifiedAt: context.now.toISOString(),
        syncRunId: context.syncRunId,
      },
    });
    const record = DataFactory.createMockDailyRecord(censusDate, { discharges: [discharge] });
    const result = migrateLegacyDataWithReport(record, censusDate);
    expect(result.record.discharges[0].movementDate).toBe('2026-10-10');
    expect(result.record.discharges[0].time).toBe('01:42');
    expect(result.record.date).toBe(censusDate);
    expect(record.discharges[0].movementDate).toBe(censusDate);
    expect(result.appliedRules).toContain('imported_movement_calendar_date_recovered');
    expect(migrateLegacyDataWithReport(result.record, censusDate).record.discharges[0]).toEqual(
      result.record.discharges[0]
    );
  });
});
