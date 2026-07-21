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
import type { PatientData } from '@/types/domain/patient';

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

const newborn = (): RayenEncounter => encounter({
  encounterId: 'NEWBORN',
  run: '',
  firstGivenName: 'RN de Ana',
  birthDate: '2026-07-08',
  room: 'Cunas',
  bed: 'CH5C1',
  clinicalCribParentBedId: 'H5C1',
});

const seed = (source: RayenEncounter): PatientData =>
  rayenToPatientData(source, REFERENCE).patient;

const recordWith = (mother: RayenEncounter, child: RayenEncounter): DailyRecord => ({
  date: '2026-07-08',
  beds: { H5C1: { ...seed(mother), clinicalCrib: seed(child) } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

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

const apply = (current: DailyRecord, rows: EgresoReportRow[], encounters: RayenEncounter[]) => {
  const diff = reconcileCensus(current, snapshotOf(encounters), { reference: REFERENCE });
  const enriched = applyEgresoReport(diff, rows, current);
  const applied = applyCensusImportDiff(current, enriched, {
    idFactory: () => 'movement-id',
    now: REFERENCE,
    syncRunId: 'crib-discharge-sync',
  });
  return { enriched, applied };
};

describe('clinical crib discharge promotion', () => {
  it('promotes the attached newborn when a just-imported mother is discharged', () => {
    const mother = encounter();
    const child = newborn();
    const empty: DailyRecord = {
      date: '2026-07-08',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const { enriched, applied } = apply(empty, [dischargeRow(mother)], [mother, child]);

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
    expect(applied.record.discharges).toEqual([
      expect.objectContaining({ rut: seed(mother).rut }),
    ]);
  });

  it('promotes the newborn at the destination when the mother moved before discharge', () => {
    const priorMother = encounter({ room: 'H4' });
    const movedMother = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(priorMother, child),
      beds: { H4C1: { ...seed(priorMother), clinicalCrib: seed(child) } },
    };
    const { enriched, applied } = apply(
      current,
      [dischargeRow(movedMother)],
      [movedMother, child]
    );

    expect(enriched.moves).toHaveLength(0);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H4C1).toBeUndefined();
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
  });

  it('strips a confirmed newborn discharge from a new maternal admission', () => {
    const mother = encounter();
    const child = newborn();
    const empty: DailyRecord = {
      date: '2026-07-08',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const { enriched, applied } = apply(empty, [dischargeRow(child)], [mother, child]);

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'MOTHER' }),
      }),
    ]);
    expect(enriched.admissions[0]?.patient.clinicalCrib).toBeUndefined();
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'MOTHER' });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('clears a discharged newborn at the destination of its moving mother', () => {
    const priorMother = encounter({ room: 'H4' });
    const movedMother = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(priorMother, child),
      beds: { H4C1: { ...seed(priorMother), clinicalCrib: seed(child) } },
    };
    const { enriched, applied } = apply(
      current,
      [dischargeRow(child)],
      [movedMother, child]
    );

    expect(enriched.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H4C1', toBedId: 'H5C1' }),
    ]);
    expect(enriched.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        changes: [expect.objectContaining({ field: 'clinicalCrib', to: undefined })],
      }),
    ]);
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H4C1).toBeUndefined();
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'MOTHER' });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('does not retain a clinically closed newborn admitted after the census day', () => {
    const mother = encounter();
    const futureClosedChild = {
      ...newborn(),
      admissionDatetime: '2026-07-09T01:00:00-06:00',
      hasMedicalDischarge: true,
    };
    const current: DailyRecord = {
      ...recordWith(mother, newborn()),
      beds: { H5C1: seed(mother) },
    };
    const diff = reconcileCensus(current, snapshotOf([mother, futureClosedChild]), {
      reference: REFERENCE,
    });

    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
    expect(diff.activeClinicalCribs ?? []).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('promotes a location-less closed newborn when the mother is discharged first', () => {
    const mother = encounter();
    const child = newborn();
    const closedWithoutLocation = {
      ...child,
      room: undefined,
      bed: undefined,
      clinicalCribParentBedId: undefined,
      hasMedicalDischarge: true,
    };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(
      current,
      [dischargeRow(mother)],
      [mother, closedWithoutLocation]
    );

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
  });

  it('promotes the nested newborn when only the child remains in the snapshot', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [child]);

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
  });

  it('promotes a legacy RUN-bearing newborn when only the child remains visible', () => {
    const mother = encounter();
    const child = { ...newborn(), run: '222222222' };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [child]);

    expect(enriched.conflicts).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna',
    });
  });

  it('moves an already promoted newborn between physical crib locations', () => {
    const child = newborn();
    const movedChild = {
      ...child,
      bed: 'CH4C1',
      clinicalCribParentBedId: 'H4C1',
    };
    const current: DailyRecord = {
      date: '2026-07-08',
      beds: {
        H5C1: { ...seed(child), bedMode: 'Cuna', clinicalCrib: undefined },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const diff = reconcileCensus(current, snapshotOf([movedChild]), { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'promoted-crib-move',
    });

    expect(diff.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H5C1', toBedId: 'H4C1' }),
    ]);
    expect(diff.conflicts).toHaveLength(0);
    expect(applied.record.beds.H5C1).toBeUndefined();
    expect(applied.record.beds.H4C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });
});
