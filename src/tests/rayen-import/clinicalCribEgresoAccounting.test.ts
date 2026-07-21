import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type EgresoReportRow,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const REFERENCE = new Date(2026, 6, 8);

const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control',
  ...overrides,
});

const newborn = (encounterId = 'NEWBORN'): RayenEncounter =>
  encounter({
    encounterId,
    run: '222222222',
    firstGivenName: 'Bebe',
    birthDate: '2026-07-08',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });

const seed = (source: RayenEncounter) => rayenToPatientData(source, REFERENCE).patient;

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
});

const dischargeRow = (patient: RayenEncounter): EgresoReportRow => ({
  encounterId: patient.encounterId,
  run: patient.run,
  patientName: `${patient.firstGivenName} ${patient.firstFamilyName}`,
  bedLabel: 'H5C1',
  servicio: patient.service ?? '',
  edad: '1',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '08-07-2026 12:00',
});

const baseRecord = (beds: DailyRecord['beds']): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

describe('clinical crib egreso accounting', () => {
  it('review-gates an episode-less report when an older newborn episode has the same RUN', () => {
    const mother = encounter();
    const child = newborn('NEWBORN-READMISSION');
    const current: DailyRecord = {
      ...baseRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } }),
      discharges: [{ rut: child.run, clinicalEpisodeId: 'NEWBORN-OLD' } as never],
    };
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const { encounterId: _omittedByBulkReport, ...bulkRow } = dischargeRow(child);
    const enriched = applyEgresoReport(diff, [bulkRow], current);
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rut: child.run,
          reason: expect.stringContaining('no identifica el episodio activo'),
        }),
      ])
    );
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'should-not-be-used',
      now: REFERENCE,
      syncRunId: 'ambiguous-crib-egreso',
    });
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-READMISSION',
    });
  });

  it('review-gates an episode-less report for a principal readmission absent from HHR beds', () => {
    const readmission = encounter({
      encounterId: 'MOTHER-READMISSION',
      run: '144700554',
      room: 'H4',
      bed: 'C1',
    });
    const current: DailyRecord = {
      ...baseRecord({}),
      discharges: [{ rut: readmission.run, clinicalEpisodeId: 'MOTHER-OLD' } as never],
    };
    const diff = reconcileCensus(current, snapshotOf([readmission]), { reference: REFERENCE });
    const { encounterId: _omittedByBulkReport, ...bulkRow } = dischargeRow(readmission);
    const enriched = applyEgresoReport(diff, [bulkRow], current);

    expect(diff.admissions).toHaveLength(1);
    expect(enriched.admissions).toHaveLength(1);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rut: readmission.run,
          reason: expect.stringContaining('no identifica el episodio activo'),
        }),
      ])
    );
  });

  it('keeps a provisional principal admission when an episode-less egreso predates it', () => {
    const current = baseRecord({});
    const active = encounter({ encounterId: 'CURRENT-ADMISSION' });
    const diff = reconcileCensus(current, snapshotOf([active]), { reference: REFERENCE });
    const { encounterId: _omitted, ...episodeLess } = {
      ...dischargeRow(active),
      fechaEgreso: '08-07-2026 10:00',
    };
    const enriched = applyEgresoReport(diff, [episodeLess], current);

    expect(enriched.admissions).toHaveLength(1);
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining('anterior a su ingreso activo'),
        }),
      ])
    );
  });

  it('records an exact older episode without conflicting with the active readmission', () => {
    const active = encounter({ encounterId: 'MOTHER-READMISSION' });
    const current = baseRecord({ H5C1: seed(active) });
    const diff = reconcileCensus(current, snapshotOf([active]), { reference: REFERENCE });
    const oldRow = {
      ...dischargeRow(active),
      encounterId: 'MOTHER-OLD',
      fechaEgreso: '08-07-2026 10:00',
    };
    const enriched = applyEgresoReport(diff, [oldRow], current);

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'MOTHER-OLD' }),
    ]);
  });

  it('preserves distinct exact egresos for multiple episodes sharing one RUN', () => {
    const current = baseRecord({});
    const first = newborn('NEWBORN-OLD-1');
    const second = newborn('NEWBORN-OLD-2');
    const enriched = applyEgresoReport(
      reconcileCensus(current, snapshotOf([]), { reference: REFERENCE }),
      [dischargeRow(first), dischargeRow(second)],
      current
    );

    expect(enriched.reportEgresos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ encounterId: 'NEWBORN-OLD-1' }),
        expect.objectContaining({ encounterId: 'NEWBORN-OLD-2' }),
      ])
    );
    expect(enriched.reportEgresos).toHaveLength(2);
  });

  it('rejects an egreso that predates a newborn first attached in this reconciliation', () => {
    const mother = encounter();
    const child = newborn();
    const current = baseRecord({ H5C1: seed(mother) });
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const enriched = applyEgresoReport(
      diff,
      [{ ...dischargeRow(child), fechaEgreso: '08-07-2026 10:00' }],
      current
    );

    expect(enriched.reportEgresos ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rut: child.run,
          reason: expect.stringContaining('anterior a su ingreso activo'),
        }),
      ])
    );
    expect(enriched.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changes: expect.arrayContaining([expect.objectContaining({ field: 'clinicalCrib' })]),
        }),
      ])
    );
  });

  it('does not clear a readmitted newborn when the report repeats its older episode', () => {
    const mother = encounter();
    const child = newborn('NEWBORN-READMISSION');
    const staleChild = { ...seed(child), patientName: 'Bebe Antiguo' };
    const current: DailyRecord = {
      ...baseRecord({ H5C1: { ...seed(mother), clinicalCrib: staleChild } }),
      discharges: [{ rut: child.run, clinicalEpisodeId: 'NEWBORN-OLD' } as never],
    };
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const oldEpisodeRow = { ...dischargeRow(child), encounterId: 'NEWBORN-OLD' };
    const enriched = applyEgresoReport(diff, [oldEpisodeRow], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'should-not-be-used',
      now: REFERENCE,
      syncRunId: 'stale-crib-egreso',
    });

    expect(enriched.reportEgresos).toHaveLength(0);
    expect(enriched.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changes: expect.arrayContaining([expect.objectContaining({ field: 'clinicalCrib' })]),
        }),
      ])
    );
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-READMISSION',
      patientName: 'Bebe Antiguo',
    });
  });

  it('prefers the reconciled episode when HHR still stores the previous newborn episode', () => {
    const mother = encounter();
    const currentChild = newborn('NEWBORN-OLD');
    const readmittedChild = newborn('NEWBORN-READMISSION');
    const current: DailyRecord = {
      ...baseRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(currentChild) } }),
      discharges: [{ rut: currentChild.run, clinicalEpisodeId: 'NEWBORN-OLD' } as never],
    };
    const diff = reconcileCensus(current, snapshotOf([mother, readmittedChild]), {
      reference: REFERENCE,
    });
    const enriched = applyEgresoReport(diff, [dischargeRow(currentChild)], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'should-not-be-used',
      now: REFERENCE,
      syncRunId: 'readmitted-crib-egreso',
    });

    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-READMISSION',
    });
  });

  it('uses the active snapshot episode to discharge a legacy crib without a stored episode', () => {
    const mother = encounter();
    const child = newborn();
    const legacyChild = { ...seed(child), clinicalEpisodeId: '' };
    const current = baseRecord({ H5C1: { ...seed(mother), clinicalCrib: legacyChild } });
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(child)], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'legacy-crib-egreso',
      now: REFERENCE,
      syncRunId: 'legacy-crib-egreso',
    });

    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(applied.record.discharges).toEqual(
      expect.arrayContaining([expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' })])
    );
  });

  it('keeps a legacy crib when an exact report cannot confirm its active episode', () => {
    const mother = encounter();
    const child = newborn();
    const legacyChild = { ...seed(child), clinicalEpisodeId: '' };
    const current = baseRecord({ H5C1: { ...seed(mother), clinicalCrib: legacyChild } });
    const diff = reconcileCensus(current, snapshotOf([mother]), { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(child)], current);

    expect(enriched.updates).toHaveLength(0);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bedId: 'H5C1',
          reason: expect.stringContaining('episodio activo de la cuna'),
        }),
      ])
    );
  });

  it('discharges a RUN-less newborn by its exact Eloísa episode', () => {
    const mother = encounter();
    const child = { ...newborn(), run: '' };
    const current = baseRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } });
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(child)], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'runless-newborn-egreso',
      now: REFERENCE,
      syncRunId: 'runless-newborn-egreso',
    });

    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', run: '' }),
    ]);
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('discharges a newborn by episode when the report omits its available RUN', () => {
    const mother = encounter();
    const child = newborn();
    const current = baseRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } });
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(
      current,
      applyEgresoReport(diff, [{ ...dischargeRow(child), run: '' }], current),
      { idFactory: () => 'episode-only-egreso', now: REFERENCE, syncRunId: 'episode-only-egreso' }
    );

    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('selects the exact episode when multiple active newborns have no RUN', () => {
    const motherA = encounter();
    const motherB = encounter({ encounterId: 'MOTHER-B', run: '111111111', room: 'H4' });
    const childA = { ...newborn('NEWBORN-A'), run: '' };
    const childB = {
      ...newborn('NEWBORN-B'),
      run: '',
      bed: 'CH4C1',
      clinicalCribParentBedId: 'H4C1',
    };
    const current = baseRecord({
      H5C1: { ...seed(motherA), clinicalCrib: seed(childA) },
      H4C1: { ...seed(motherB), clinicalCrib: seed(childB) },
    });
    const diff = reconcileCensus(current, snapshotOf([motherA, motherB, childA, childB]), {
      reference: REFERENCE,
    });
    const applied = applyCensusImportDiff(
      current,
      applyEgresoReport(diff, [dischargeRow(childB)], current),
      { idFactory: () => 'newborn-b-egreso', now: REFERENCE, syncRunId: 'newborn-b-egreso' }
    );

    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-A',
    });
    expect(applied.record.beds.H4C1.clinicalCrib).toBeUndefined();
  });

  it('keeps an episode-less principal occupied when an exact report cannot be matched', () => {
    const mother = encounter();
    const legacyMother = { ...seed(mother), clinicalEpisodeId: '' };
    const current = baseRecord({ H5C1: legacyMother });
    const diff = reconcileCensus(current, snapshotOf([]), { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(mother)], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'should-not-be-used',
      now: REFERENCE,
      syncRunId: 'legacy-principal-egreso',
    });

    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bedId: 'H5C1',
          reason: expect.stringContaining('episodio activo'),
        }),
      ])
    );
    expect(applied.record.beds.H5C1).toMatchObject({ rut: legacyMother.rut });
  });

  it('does not subtract a newly attached crib from unrelated unchanged patients', () => {
    const unrelated = encounter({
      encounterId: 'OTHER',
      run: '333333333',
      firstGivenName: 'Otra',
      room: 'H4',
    });
    const mother = encounter();
    const child = newborn();
    const current = baseRecord({ H4C1: seed(unrelated) });
    const diff = reconcileCensus(current, snapshotOf([unrelated, mother, child]), {
      reference: REFERENCE,
    });
    const enriched = applyEgresoReport(diff, [dischargeRow(child)], current);

    expect(diff.summary.unchanged).toBe(1);
    expect(enriched.summary.unchanged).toBe(1);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalCrib: undefined }),
      }),
    ]);
  });
});
