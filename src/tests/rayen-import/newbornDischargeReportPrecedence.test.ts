import { describe, expect, it } from 'vitest';
import {
  applyEgresoReport,
  applyCensusImportDiff,
  type CensusImportDiff,
  type EgresoReportRow,
} from '@/features/rayen-import';
import { hasIndependentClinicalCribOutcome } from '@/features/rayen-import/domain/censusDischargeHistory';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (
  beds: DailyRecord['beds'] = {},
  movements: Partial<Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>> = {}
): DailyRecord => ({
  date: '2026-07-14',
  beds,
  discharges: movements.discharges ?? [],
  transfers: movements.transfers ?? [],
  cma: movements.cma ?? [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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

const row = (over: Partial<EgresoReportRow>): EgresoReportRow => ({
  run: '',
  patientName: '',
  bedLabel: '',
  servicio: '',
  edad: '',
  destino: '',
  motivo: '',
  fechaEgreso: '14-07-2026  12:00',
  ...over,
});

describe('newborn discharge report precedence', () => {
  it.each([
    ['mother first', false, false],
    ['newborn first', true, false],
    ['shared RUN, mother first', false, true],
    ['shared RUN, newborn first', true, true],
  ] as const)(
    'does not infer a second newborn discharge when its own report exists (%s)',
    (_label, reverse, sharedRun) => {
      const crib = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        bedMode: 'Cuna' as const,
        patientName: 'RN sintético',
        rut: sharedRun ? '111111111' : '222222222',
        clinicalEpisodeId: 'synthetic-newborn',
        admissionDate: '2026-07-13',
        admissionTime: '10:00',
      };
      const mother = {
        ...EMPTY_PATIENT,
        bedId: 'H6C1',
        patientName: 'Madre sintética',
        rut: '111111111',
        clinicalEpisodeId: 'synthetic-mother',
        admissionDate: '2026-07-13',
        admissionTime: '09:00',
        clinicalCrib: crib,
      };
      const current = makeRecord({ H6C1: mother });
      const rows = [
        row({
          run: mother.rut,
          patientName: mother.patientName,
          encounterId: mother.clinicalEpisodeId,
          bedLabel: 'H6C1',
          destino: 'Domicilio',
          correctedDay: current.date,
          correctedTime: '11:00',
        }),
        row({
          run: crib.rut,
          patientName: crib.patientName,
          encounterId: crib.clinicalEpisodeId,
          bedLabel: 'Cuna H6C1',
          destino: 'Domicilio',
          correctedDay: current.date,
          correctedTime: '11:21',
        }),
      ];
      const diff = applyEgresoReport(
        makeDiff({ snapshotComplete: true }),
        reverse ? rows.reverse() : rows,
        current
      );
      expect(diff.discharges).toHaveLength(1);
      expect(diff.discharges[0].associatedClinicalCrib).toBeUndefined();
      expect(diff.reportEgresos).toHaveLength(1);
      expect(diff.reportEgresos?.[0]).toMatchObject({
        encounterId: crib.clinicalEpisodeId,
        fromClinicalCrib: true,
      });
      const result = applyCensusImportDiff(current, diff, {
        idFactory: (() => {
          let id = 0;
          return () => `synthetic-${++id}`;
        })(),
        syncRunId: 'synthetic-run',
        now: new Date('2026-07-14T18:00:00Z'),
      });
      expect(result.record.discharges).toHaveLength(2);
      expect(
        result.record.discharges.filter(item => item.clinicalEpisodeId === crib.clinicalEpisodeId)
      ).toHaveLength(1);
      expect(result.record.discharges.filter(item => !item.isNested)).toHaveLength(1);
    }
  );
  it('only suppresses the maternal snapshot for an outcome applied on this census day', () => {
    const current = makeRecord();
    const crib = { ...EMPTY_PATIENT, bedId: 'H6C1', clinicalEpisodeId: 'rn-episode' };
    const report = {
      encounterId: 'rn-episode',
      run: '',
      patientName: 'RN sintético',
      bedLabel: 'Cuna H6C1',
      destino: 'Domicilio',
      fechaEgreso: '14-07-2026 11:21',
      kind: 'alta' as const,
      status: 'Vivo' as const,
      fromClinicalCrib: true,
    };
    for (const correctedDay of ['2026-07-13', '2026-07-15']) {
      expect(hasIndependentClinicalCribOutcome(current, [{ ...report, correctedDay }], crib)).toBe(
        false
      );
    }
    expect(
      hasIndependentClinicalCribOutcome(current, [{ ...report, correctedDay: current.date }], crib)
    ).toBe(true);
  });
});
