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

const newborn = (encounterId = 'NEWBORN'): RayenEncounter => encounter({
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
  it('records a readmitted newborn episode even when an older episode has the same RUN', () => {
    const mother = encounter();
    const child = newborn('NEWBORN-READMISSION');
    const current: DailyRecord = {
      ...baseRecord({ H5C1: { ...seed(mother), clinicalCrib: seed(child) } }),
      discharges: [{ rut: child.run, clinicalEpisodeId: 'NEWBORN-OLD' } as never],
    };
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const { encounterId: _omittedByBulkReport, ...bulkRow } = dischargeRow(child);
    const enriched = applyEgresoReport(diff, [bulkRow], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'new-movement-id',
      now: REFERENCE,
      syncRunId: 'crib-readmission-egreso',
    });

    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN-READMISSION', run: child.run }),
    ]);
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(applied.record.discharges).toEqual(expect.arrayContaining([
      expect.objectContaining({ clinicalEpisodeId: 'NEWBORN-OLD' }),
      expect.objectContaining({ clinicalEpisodeId: 'NEWBORN-READMISSION' }),
    ]));
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
