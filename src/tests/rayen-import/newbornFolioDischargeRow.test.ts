import { describe, expect, it } from 'vitest';
import { applyEgresoReport, reconcileCensus, applyCensusImportDiff } from '@/features/rayen-import';
import { selectEligibleEgresoRows } from '@/features/rayen-import/domain/egresoReportEligibility';
import { dropRedundantUnverifiedReportConflicts } from '@/features/rayen-import/domain/redundantReportRowConflicts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import {
  dischargeRow,
  encounter,
  newborn,
  recordWith,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';

const mother = encounter();
const child = newborn();
const folioRow = () => ({
  ...dischargeRow(child),
  correctedDay: '2026-07-08',
  correctedTime: '12:00',
  encounterId: '',
  run: '7654322',
  patientName: '  RN de Ána   Pérez ',
  exactEpisodeVerification: 'unverified' as const,
});
const firstRun = (newbornRows = [folioRow()]) => {
  const record = recordWith(mother, child);
  const diff = reconcileCensus(
    record,
    { ...snapshotOf([]), isComplete: true },
    { reference: REFERENCE }
  );
  const enriched = applyEgresoReport(
    diff,
    [
      { ...dischargeRow(mother), correctedDay: record.date, correctedTime: '12:00' },
      ...newbornRows,
    ],
    record
  );
  const applied = applyCensusImportDiff(record, enriched, {
    idFactory: () => 'synthetic-movement',
    now: REFERENCE,
    syncRunId: 'synthetic-folio-sync',
  });
  return { enriched, applied };
};
const emptyDiff = () => ({
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
const movement = (): DischargeData => ({
  id: 'synthetic-newborn-discharge',
  diagnosis: 'Control neonatal sintético',
  bedId: 'H5C1',
  bedName: 'H5C1 (Cuna RN)',
  bedType: 'Cuna',
  patientName: 'RN de Ana Perez',
  rut: '',
  clinicalEpisodeId: 'NEWBORN',
  isNested: true,
  movementDate: '2026-07-08',
  time: '12:00',
  status: 'Vivo',
});
const recorded = (discharges = [movement()]): DailyRecord => ({
  ...recordWith(mother, child),
  beds: {},
  discharges,
});

describe('newborn folio discharge report row', () => {
  it('explains the folio row when the mother discharge attaches the document-less crib', () => {
    const { enriched, applied } = firstRun();
    expect(enriched.conflicts).toEqual([]);
    expect(enriched.discharges).toHaveLength(1);
    expect(enriched.discharges[0]?.associatedClinicalCrib).toMatchObject({
      rut: '',
      clinicalEpisodeId: 'NEWBORN',
    });
    expect(applied.record.discharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          rut: '',
          isNested: true,
          time: '12:00',
        }),
        expect.objectContaining({ clinicalEpisodeId: 'MOTHER', isNested: false }),
      ])
    );
  });

  it('does not reopen review or change movements on the next run', () => {
    const record = recorded([
      movement(),
      {
        ...movement(),
        id: 'mother-discharge',
        rut: mother.run,
        clinicalEpisodeId: 'MOTHER',
        isNested: false,
      },
    ]);
    const before = structuredClone(record);
    const result = applyEgresoReport(emptyDiff(), [dischargeRow(mother), folioRow()], record);
    expect(result.conflicts).toEqual([]);
    expect(result.discharges).toEqual([]);
    expect(result.reportEgresos ?? []).toEqual([]);
    const reapplied = applyCensusImportDiff(record, result, {
      idFactory: () => 'unexpected-new-movement',
      now: REFERENCE,
      syncRunId: 'repeat-folio-sync',
    });
    expect(reapplied.record.discharges).toEqual(before.discharges);
    expect(record).toEqual(before);
  });

  it('recognises a dawn discharge, which the census stores under the next calendar day', () => {
    const dawnRow = { ...folioRow(), correctedTime: '03:00' };
    const record = recorded([{ ...movement(), movementDate: '2026-07-09', time: '03:00' }]);
    const result = applyEgresoReport(emptyDiff(), [dawnRow], record);
    expect(result.conflicts).toEqual([]);
    expect(result.discharges).toEqual([]);
  });

  it.each([
    { patientName: 'RN de Otra Madre' },
    { run: 'AB123456', patientName: 'Adulto Pasaporte' },
    { bedLabel: 'H4C1' },
    { correctedTime: '12:01' },
    { correctedTime: '13:00' },
  ])('keeps review without matching crib evidence: %j', overrides => {
    const result = selectEligibleEgresoRows(
      emptyDiff(),
      [{ ...folioRow(), ...overrides }],
      recorded()
    );
    expect(result.diff.conflicts).toHaveLength(1);
  });

  it.each([
    { isNested: false },
    { deletedAt: '2026-07-08T20:00:00Z' },
    { rut: mother.run },
    { movementDate: '2026-07-07' },
    { time: '12:01' },
  ])('keeps review for a nonmatching recorded movement: %j', overrides => {
    const result = selectEligibleEgresoRows(
      emptyDiff(),
      [folioRow()],
      recorded([{ ...movement(), ...overrides }])
    );
    expect(result.diff.conflicts).toHaveLength(1);
  });

  it('keeps review without any recorded crib', () => {
    expect(
      selectEligibleEgresoRows(emptyDiff(), [folioRow()], recorded([])).diff.conflicts
    ).toHaveLength(1);
  });

  it('uses each recorded crib once when two folio rows compete', () => {
    const result = selectEligibleEgresoRows(
      emptyDiff(),
      [folioRow(), { ...folioRow(), run: '7654323' }],
      recorded()
    );
    expect(result.diff.conflicts).toHaveLength(1);
    expect(result.diff.conflicts[0]?.rut).toBe('7654323');
  });

  it('keeps both folio conflicts when one attached crib cannot explain two rows', () => {
    const twins = firstRun([folioRow(), { ...folioRow(), run: '7654323' }]);
    expect(twins.enriched.conflicts).toHaveLength(2);
    const { enriched } = firstRun();
    const conflicts = ['7654322', '7654323'].map(rut => ({
      bedId: 'H5C1',
      rut,
      patientName: child.firstGivenName + ' ' + child.firstFamilyName,
      code: 'unverified-report-row' as const,
      reason: 'Fila sin episodio',
    }));
    expect(
      dropRedundantUnverifiedReportConflicts(
        conflicts,
        enriched.discharges,
        recordWith(mother, child)
      )
    ).toEqual(conflicts);
  });

  it('keeps review in the first run when the folio row reports another minute than the crib discharge', () => {
    expect(firstRun([{ ...folioRow(), correctedTime: '13:00' }]).enriched.conflicts).toHaveLength(
      1
    );
  });

  it('explains the rows the report repeats for each diagnosis once the discharge is recorded', () => {
    const repeated = [folioRow(), { ...folioRow(), diagnostico: 'Otro diagnóstico sintético' }];
    expect(selectEligibleEgresoRows(emptyDiff(), repeated, recorded()).diff.conflicts).toEqual([]);
    // In the run that applies the discharge the repeated rows still ask once, as on main: the bed
    // count that labels a row as redundant counts rows, not events. The next run clears it.
    expect(firstRun(repeated).enriched.conflicts).toHaveLength(1);
  });

  it('keeps a different name or an adult passport in the first run', () => {
    for (const row of [
      { ...folioRow(), patientName: 'Otro RN' },
      { ...folioRow(), run: 'AB123456', patientName: 'Adulto Pasaporte' },
    ]) {
      expect(firstRun([row]).enriched.conflicts).toHaveLength(1);
    }
  });
});
