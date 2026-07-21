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
  it('promotes an active attached newborn when the mother is discharged first', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    if (current.beds.H5C1.clinicalCrib) {
      current.beds.H5C1.clinicalCrib.handoffNote = 'Observación neonatal local';
    }
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [mother, child]);

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'H5C1', rut: seed(mother).rut }),
    ]);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          bedMode: 'Cuna',
          clinicalCrib: undefined,
        }),
      }),
    ]);
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
      patientName: 'Rn De Ana Perez',
      handoffNote: 'Observación neonatal local',
    });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();

    const repeated = reconcileCensus(applied.record, snapshotOf([child]), {
      reference: REFERENCE,
    });
    expect(repeated.conflicts).toHaveLength(0);
    expect(repeated.admissions).toHaveLength(0);
    expect(repeated.updates).toHaveLength(0);
    expect(repeated.summary.unchanged).toBe(1);
  });

  it('promotes the newborn when the exact maternal egreso has no RUN', () => {
    const mother = encounter({ run: '' });
    const child = { ...newborn(), run: '' };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [mother, child]);

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });

  it('promotes the RUN-less newborn when the exact maternal egreso has a stale RUN', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const staleIdentityRow = { ...dischargeRow(mother), run: '999999999' };
    const { enriched, applied } = apply(current, [staleIdentityRow], [mother, child]);

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'H5C1', encounterId: 'MOTHER' }),
    ]);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', rut: '', bedMode: 'Cuna' }),
      }),
    ]);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      rut: '',
      bedMode: 'Cuna',
    });
  });

  it('does not redirect an exact promotion when the stale report RUN belongs to another bed', () => {
    const mother = encounter();
    const child = newborn();
    const other = encounter({
      encounterId: 'OTHER', run: '999999999', firstGivenName: 'Otra', room: 'H4',
    });
    const current: DailyRecord = {
      ...recordWith(mother, child),
      beds: { H4C1: seed(other), H5C1: { ...seed(mother), clinicalCrib: seed(child) } },
    };
    const { applied } = apply(
      current,
      [{ ...dischargeRow(mother), run: other.run }],
      [other, mother, child]
    );

    expect(applied.record.beds.H4C1).toMatchObject({ clinicalEpisodeId: 'OTHER' });
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN', rut: '', bedMode: 'Cuna',
    });
  });

  it('does not promote the newborn when both statistical discharges are confirmed', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(
      current,
      [dischargeRow(mother), dischargeRow(child)],
      [mother, child]
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toBeUndefined();
  });

  it('does not promote a crib associated with a different incoming principal patient', () => {
    const outgoingMother = encounter({
      encounterId: 'OUTGOING-MOTHER',
      run: '111111111',
      firstGivenName: 'Maria',
    });
    const incomingMother = encounter();
    const child = newborn();
    const current = recordWith(outgoingMother, child);
    const { enriched } = apply(
      current,
      [dischargeRow(outgoingMother)],
      [incomingMother, child]
    );

    expect(enriched.activeClinicalCribs).toEqual([
      expect.objectContaining({ parentBedId: 'H5C1', principalRut: incomingMother.run }),
    ]);
    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.conflicts).not.toHaveLength(0);
  });

  it('does not promote the newborn for an egreso from an older maternal episode', () => {
    const mother = encounter({ encounterId: 'MOTHER-READMISSION' });
    const oldMother = { ...mother, encounterId: 'MOTHER-OLD' };
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(mother, child),
      discharges: [{ rut: mother.run, clinicalEpisodeId: 'MOTHER-OLD' } as never],
    };
    const { enriched, applied } = apply(
      current,
      [dischargeRow(oldMother)],
      [mother, child]
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'MOTHER-READMISSION',
      clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
    });
  });

  it('does not promote either newborn while two snapshot cribs claim the same parent bed', () => {
    const mother = encounter();
    const child = newborn();
    const competingChild = {
      ...newborn(),
      encounterId: 'NEWBORN-2',
      run: '333333333',
      firstGivenName: 'Otro bebe',
    };
    const current = recordWith(mother, child);
    const { enriched } = apply(
      current,
      [dischargeRow(mother)],
      [mother, child, competingChild]
    );

    expect(enriched.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ bedId: 'H5C1', scope: 'clinical-crib' }),
    ]));
    expect(enriched.admissions).toHaveLength(0);
  });

  it('keeps a rejected cross-bed crib conflict visible and avoids duplicating the newborn', () => {
    const motherH4 = encounter({
      encounterId: 'MOTHER-H4',
      run: '333333333',
      firstGivenName: 'Carla',
      room: 'H4',
    });
    const motherH5 = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(motherH5, child),
      beds: {
        H4C1: { ...seed(motherH4), clinicalCrib: seed(child) },
        H5C1: seed(motherH5),
      },
    };
    const { enriched, applied } = apply(
      current,
      [dischargeRow(motherH5)],
      [motherH4, motherH5, child]
    );

    expect(enriched.activeClinicalCribs ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        reason: expect.stringContaining('ya está asociada a H4C1'),
      }),
    ]);
    expect(enriched.admissions).toHaveLength(0);
    expect(applied.record.beds.H4C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
    expect(applied.record.beds.H5C1).toBeUndefined();
  });

  it('clears only the nested newborn when its administrative discharge is confirmed', () => {
    const mother = encounter();
    const child = newborn();
    const closedChild = { ...child, hasMedicalDischarge: true };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(
      current,
      [dischargeRow(child)],
      [mother, closedChild]
    );

    expect(enriched.pendingAdministrativeDischarges).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(1);
    expect(enriched.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        rut: seed(child).rut,
        changes: [expect.objectContaining({ field: 'clinicalCrib', to: undefined })],
      }),
    ]);
    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', run: '' }),
    ]);
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'MOTHER' });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('does not reattach the same newborn episode after its administrative discharge', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const { applied } = apply(current, [dischargeRow(child)], [mother, child]);

    expect(applied.record.discharges).toEqual([
      expect.objectContaining({ rut: child.run, clinicalEpisodeId: 'NEWBORN' }),
    ]);

    const staleSnapshot = reconcileCensus(applied.record, snapshotOf([mother, child]), {
      reference: REFERENCE,
    });
    const reapplied = applyCensusImportDiff(applied.record, staleSnapshot, {
      idFactory: () => 'second-movement-id',
      now: REFERENCE,
      syncRunId: 'crib-stale-snapshot',
    });

    expect(staleSnapshot.conflicts).toHaveLength(0);
    expect(staleSnapshot.activeClinicalCribs ?? []).toHaveLength(0);
    expect(staleSnapshot.updates).toHaveLength(0);
    expect(reapplied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('allows a later newborn episode without RUN after an earlier episode was discharged', () => {
    const mother = encounter();
    const priorChild = newborn();
    const current = recordWith(mother, priorChild);
    const { applied } = apply(current, [dischargeRow(priorChild)], [mother, priorChild]);
    const readmittedChild = { ...priorChild, encounterId: 'NEWBORN-READMISSION' };

    const diff = reconcileCensus(applied.record, snapshotOf([mother, readmittedChild]), {
      reference: REFERENCE,
    });
    const reapplied = applyCensusImportDiff(applied.record, diff, {
      idFactory: () => 'readmission-movement-id',
      now: REFERENCE,
      syncRunId: 'crib-readmission',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.activeClinicalCribs).toEqual([
      expect.objectContaining({
        parentBedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN-READMISSION' }),
      }),
    ]);
    expect(reapplied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-READMISSION',
    });
  });

  it('promotes a clinically closed newborn until its own administrative discharge exists', () => {
    const mother = encounter();
    const child = newborn();
    const closedChild = { ...child, hasMedicalDischarge: true };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(
      current,
      [dischargeRow(mother)],
      [mother, closedChild]
    );

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });
});
