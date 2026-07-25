import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  rayenToPatientData,
  reconcileCensus,
  type AdmissionEntry,
  type ConflictEntry,
  type DischargeEntry,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { resolveReleasedBedPlacements } from '@/features/rayen-import/domain/resolveReleasedBedPlacements';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const REFERENCE = new Date(2026, 6, 24);
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'old-episode',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'Neo 1',
  bed: 'Neo1',
  admissionDatetime: '2026-07-23T13:21:41-06:00',
  ...overrides,
});

const currentRecord = (): DailyRecord => ({
  date: '2026-07-24',
  beds: {
    NEO1: { ...rayenToPatientData(encounter(), REFERENCE).patient, bedId: 'NEO1' },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const newEncounter = encounter({
  encounterId: 'new-episode',
  run: '222222222',
  firstFamilyName: 'Nuevo',
  admissionDatetime: '2026-07-24T08:00:00-06:00',
});

const snapshot = (): RayenCensusSnapshot => ({
  capturedAt: '2026-07-24T12:30:00-06:00',
  facilityId: 1342,
  isComplete: true,
  encounters: [newEncounter, encounter({ hasMedicalDischarge: true })],
});

const blockedAdmission = (source = newEncounter): AdmissionEntry => ({
  bedId: 'NEO1',
  patient: { ...rayenToPatientData(source, REFERENCE).patient, bedId: 'NEO1' },
  isCma: false,
  source,
});

const conflict = (admission = blockedAdmission()): ConflictEntry => ({
  bedId: 'NEO1',
  rut: admission.patient.rut,
  patientName: admission.patient.patientName,
  code: 'occupied-local-bed',
  blockedAdmission: admission,
  reason: 'ocupada',
  source: admission.source,
});

const discharge = (overrides: Partial<DischargeEntry> = {}): DischargeEntry => ({
  bedId: 'NEO1',
  rut: '111111111',
  patientName: 'Paciente Anterior',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: 'old-episode',
  ...overrides,
});

const egresoRow = () => ({
  run: '111111111',
  encounterId: 'old-episode',
  patientName: 'Paciente Anterior',
  bedLabel: 'NEO1',
  servicio: 'Área Médico Quirúrgica',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '24-07-2026 10:00',
});

describe('released bed admissions', () => {
  it('applies an authoritative egreso and the blocked same-bed admission in one diff', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(initialDiff, [egresoRow()], current);

    expect(enriched.summary).toMatchObject({ admissions: 1, discharges: 1, conflicts: 0 });
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });
    expect(applied.skipped).toHaveLength(0);
    expect(applied.applied).toMatchObject({ admissions: 1, discharges: 1 });
    expect(applied.record.beds.NEO1.patientName).toBe('Paciente Nuevo');
  });

  it('drops a verified closed-patient move when its egreso is confirmed in the same preview', () => {
    const current = currentRecord();
    const verifiedSnapshot: RayenCensusSnapshot = {
      ...snapshot(),
      encounters: [
        newEncounter,
        encounter({
          hasMedicalDischarge: true,
          room: 'Habitacion 2',
          bed: 'H2C2',
          verifiedBedPlacement: {
            source: 'patient-flow-report',
            bedId: 'H2C2',
            changedAt: '2026-07-23T23:10:09',
          },
        }),
      ],
    };
    const initialDiff = reconcileCensus(current, verifiedSnapshot, { reference: REFERENCE });
    expect(initialDiff.moves).toHaveLength(1);
    expect(initialDiff.admissions).toHaveLength(1);

    const enriched = applyEgresoReport(
      initialDiff,
      [{ ...egresoRow(), bedLabel: 'H2C2' }],
      current
    );

    expect(enriched.moves).toHaveLength(0);
    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'NEO1', encounterId: 'old-episode' }),
    ]);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.NEO1.patientName).toBe('Paciente Nuevo');
    expect(applied.record.beds.H2C2).toBeUndefined();
  });

  it('propagates a discharge through a blocked move and its newly released source bed', () => {
    const incoming = encounter({
      encounterId: 'incoming-episode',
      run: '555555555',
      firstFamilyName: 'Entrante',
      room: 'H1',
      bed: 'C1',
    });
    const moving = encounter({
      encounterId: 'moving-episode',
      run: '333333333',
      firstFamilyName: 'En Movimiento',
      room: 'Habitacion 2',
      bed: 'H2C2',
    });
    const departing = encounter({
      encounterId: 'departing-episode',
      run: '444444444',
      firstFamilyName: 'Egresado',
      room: 'Habitacion 2',
      bed: 'H2C2',
      hasMedicalDischarge: true,
    });
    const current: DailyRecord = {
      ...currentRecord(),
      beds: {
        H1C1: {
          ...rayenToPatientData({ ...moving, room: 'H1', bed: 'C1' }, REFERENCE).patient,
          bedId: 'H1C1',
        },
        H2C2: { ...rayenToPatientData(departing, REFERENCE).patient, bedId: 'H2C2' },
      },
    };
    const initialDiff = reconcileCensus(
      current,
      {
        ...snapshot(),
        encounters: [incoming, moving, departing],
      },
      { reference: REFERENCE }
    );
    expect(initialDiff.moves).toHaveLength(0);
    expect(initialDiff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'H1C1', blockedAdmission: expect.any(Object) }),
      expect.objectContaining({ bedId: 'H2C2', blockedMove: expect.any(Object) }),
    ]);

    const enriched = applyEgresoReport(
      initialDiff,
      [
        {
          ...egresoRow(),
          run: departing.run,
          encounterId: departing.encounterId,
          patientName: 'Paciente Egresado',
          bedLabel: 'H2C2',
        },
      ],
      current
    );

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H1C1', toBedId: 'H2C2' }),
    ]);
    expect(enriched.admissions).toEqual([expect.objectContaining({ bedId: 'H1C1' })]);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H1C1.clinicalEpisodeId).toBe('incoming-episode');
    expect(applied.record.beds.H2C2.clinicalEpisodeId).toBe('moving-episode');
  });

  it('retargets the pending egreso when a verified closed-patient move is restored', () => {
    const movingClosed = encounter({
      encounterId: 'moving-closed',
      run: '666666666',
      firstFamilyName: 'Cerrado En Movimiento',
      hasMedicalDischarge: true,
      verifiedBedPlacement: {
        source: 'patient-flow-report',
        bedId: 'H2C2',
        changedAt: '2026-07-23T23:10:09',
      },
    });
    const departing = encounter({
      encounterId: 'target-departing',
      run: '777777777',
      firstFamilyName: 'Destino Egresado',
      room: 'Habitacion 2',
      bed: 'H2C2',
      hasMedicalDischarge: true,
    });
    const current: DailyRecord = {
      ...currentRecord(),
      beds: {
        H1C1: {
          ...rayenToPatientData({ ...movingClosed, room: 'H1', bed: 'C1' }, REFERENCE).patient,
          bedId: 'H1C1',
        },
        H2C2: { ...rayenToPatientData(departing, REFERENCE).patient, bedId: 'H2C2' },
      },
    };
    const initialDiff = reconcileCensus(
      current,
      {
        ...snapshot(),
        encounters: [movingClosed, departing],
      },
      { reference: REFERENCE }
    );
    expect(initialDiff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'H2C2', blockedMove: expect.any(Object) }),
    ]);

    const enriched = applyEgresoReport(
      initialDiff,
      [
        {
          ...egresoRow(),
          run: departing.run,
          encounterId: departing.encounterId,
          patientName: 'Paciente Destino Egresado',
          bedLabel: 'H2C2',
        },
      ],
      current
    );

    expect(enriched.moves).toEqual([
      expect.objectContaining({ fromBedId: 'H1C1', toBedId: 'H2C2' }),
    ]);
    expect(enriched.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ bedId: 'H2C2', encounterId: 'moving-closed' }),
    ]);
  });

  it('keeps the conflict when two incoming patients claim the released bed', () => {
    const first = conflict();
    const second = conflict(blockedAdmission({ ...newEncounter, encounterId: 'third-episode' }));
    const result = resolveReleasedBedPlacements([], [], [discharge()], [first, second]);

    expect(result.admissions).toHaveLength(0);
    expect(result.conflicts).toHaveLength(2);
  });

  it('discards the same hospitalization episode instead of promoting it as its own replacement', () => {
    const sameEpisode = blockedAdmission({
      ...newEncounter,
      encounterId: 'old-episode',
      run: '111111111',
    });
    const result = resolveReleasedBedPlacements([], [], [discharge()], [conflict(sameEpisode)]);

    expect(result.admissions).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('keeps the admission blocked when the same bed has another clinical conflict', () => {
    const sibling: ConflictEntry = {
      bedId: 'NEO1',
      scope: 'clinical-crib',
      reason: 'La cuna no corresponde a la paciente principal entrante.',
    };
    const result = resolveReleasedBedPlacements([], [], [discharge()], [conflict(), sibling]);

    expect(result.admissions).toHaveLength(0);
    expect(result.conflicts).toHaveLength(2);
  });

  it('does not promote into a bed already claimed by another accepted operation', () => {
    const accepted = {
      ...blockedAdmission(),
      patient: { ...blockedAdmission().patient, rut: '333333333' },
    };
    const result = resolveReleasedBedPlacements([accepted], [], [discharge()], [conflict()]);

    expect(result.admissions).toEqual([accepted]);
    expect(result.conflicts).toHaveLength(1);
  });

  it('does not restore a blocked move for a patient discharged in the same report', () => {
    const movingSource = encounter({ encounterId: 'moving-discharge', run: '888888888' });
    const blockedMove: ConflictEntry = {
      bedId: 'NEO1',
      rut: movingSource.run,
      patientName: 'Paciente En Movimiento',
      code: 'occupied-local-bed',
      reason: 'ocupada',
      source: movingSource,
      blockedMove: {
        fromBedId: 'H1C1',
        toBedId: 'NEO1',
        rut: movingSource.run,
        patientName: 'Paciente En Movimiento',
        source: movingSource,
      },
    };
    const movingDischarge = discharge({
      bedId: 'H1C1',
      rut: movingSource.run,
      encounterId: movingSource.encounterId,
    });
    const result = resolveReleasedBedPlacements(
      [],
      [],
      [discharge(), movingDischarge],
      [blockedMove]
    );

    expect(result.moves).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('discards a discharged placement and promotes the remaining candidate for the released bed', () => {
    const departingCandidate = blockedAdmission({
      ...newEncounter,
      encounterId: 'departing-candidate',
      run: '888888888',
    });
    const remainingCandidate = blockedAdmission({
      ...newEncounter,
      encounterId: 'remaining-candidate',
      run: '999999999',
    });
    const result = resolveReleasedBedPlacements(
      [],
      [],
      [
        discharge(),
        discharge({
          bedId: 'H1C1',
          rut: departingCandidate.patient.rut,
          encounterId: departingCandidate.source?.encounterId,
        }),
      ],
      [conflict(departingCandidate), conflict(remainingCandidate)]
    );

    expect(result.admissions).toEqual([remainingCandidate]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('does not cancel an episode-qualified placement from an episode-less discharge with the same RUN', () => {
    const candidate = blockedAdmission({
      ...newEncounter,
      encounterId: 'current-episode',
      run: '888888888',
    });
    const result = resolveReleasedBedPlacements(
      [],
      [],
      [
        discharge({ encounterId: undefined }),
        discharge({
          bedId: 'H1C1',
          rut: candidate.patient.rut,
          encounterId: undefined,
        }),
      ],
      [conflict(candidate)]
    );

    expect(result.admissions).toHaveLength(0);
    expect(result.conflicts).toEqual([expect.objectContaining({ blockedAdmission: candidate })]);
  });
});
