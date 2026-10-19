import { dropRedundantUnverifiedReportConflicts } from '@/features/rayen-import/domain/redundantReportRowConflicts';
import { expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import { selectEligibleEgresoRows } from '@/features/rayen-import/domain/egresoReportEligibility';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const emptyDiff = (): CensusImportDiff => ({
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
});

it('reconciles an unverified crib report with the actual associated discharge', () => {
  const mother = {
    ...EMPTY_PATIENT,
    bedId: 'H2C2',
    patientName: 'Madre Prueba',
    rut: '11.111.111-1',
    clinicalEpisodeId: 'mother',
    clinicalCrib: {
      ...EMPTY_PATIENT,
      bedId: 'H2C2',
      patientName: 'RN Prueba',
      rut: '',
      bedMode: 'Cuna' as const,
      clinicalEpisodeId: 'child',
    },
  };
  const record = {
    date: '2026-10-18',
    beds: { H2C2: mother },
    discharges: [],
    transfers: [],
    cma: [],
  } as unknown as DailyRecord;
  const result = selectEligibleEgresoRows(
    emptyDiff(),
    [
      {
        run: mother.rut,
        patientName: 'RN Prueba',
        bedLabel: 'Cuna H2C2',
        fechaEgreso: '18-10-2026 18:48',
        exactEpisodeVerification: 'unverified',
      } as never,
    ],
    record
  );
  expect(result.rows).toEqual([]);
  expect(result.diff.conflicts).toHaveLength(1);
  expect(result.diff.conflicts[0]).toMatchObject({ bedId: 'H2C2', code: 'unverified-report-row' });
  const discharge = {
    bedId: 'H2C2',
    rut: mother.rut,
    patientName: mother.patientName,
    kind: 'alta',
    status: 'Vivo',
    encounterId: 'mother',
  } as CensusImportDiff['discharges'][number];
  expect(
    dropRedundantUnverifiedReportConflicts(result.diff.conflicts, [discharge], record)
  ).toHaveLength(1);
  expect(
    dropRedundantUnverifiedReportConflicts(
      result.diff.conflicts,
      [
        {
          ...discharge,
          associatedClinicalCrib: { clinicalEpisodeId: 'child', patientName: 'RN Prueba', rut: '' },
        },
      ],
      record
    )
  ).toEqual([]);
});
