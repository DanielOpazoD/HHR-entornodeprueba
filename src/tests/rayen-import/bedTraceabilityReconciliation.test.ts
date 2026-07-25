import { describe, expect, it, vi } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
  resolveOccupiedBedTraceability,
  resolveOccupiedBedTraceabilityChain,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 24);

const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '142040',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'Neo 1',
  bed: 'Neo1',
  admissionDatetime: '2026-07-23T13:21:41-06:00',
  ...overrides,
});

const patientAt = (source: RayenEncounter, bedId: string): PatientData => ({
  ...rayenToPatientData(source, REFERENCE).patient,
  bedId,
});

const recordWith = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-24',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-24T12:30:00-06:00',
  facilityId: 1342,
  encounters,
  isComplete: true,
});

const newNeoPatient = encounter({
  encounterId: '142099',
  run: '222222222',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Nuevo',
  admissionDatetime: '2026-07-24T08:00:00-06:00',
});

const closedMovedPatient = encounter({
  room: 'Habitacion 2',
  bed: 'H2C2',
  hasMedicalDischarge: true,
});

const patientFlowText = `
Flujo del Paciente
Paciente: Paciente Anterior RUN: 111111111
FECHA Y HORA CAMBIO SERVICIO AREA FUNCIONAL ESTACIÓN DE ENFERMERÍA SALA TIPO CAMA CAMA
23/07/2026 13:21:41 Área Médico Quirúrgica Cuidados Medios Hospitalizados Neo 1 Básica Neo1
23/07/2026 23:10:09 Área Médico Quirúrgica Cuidados Medios Hospitalizados Habitación 2 Básica C2
Pág. 1 de 1
`;

describe('occupied-bed traceability reconciliation', () => {
  it('is independent of snapshot order for an active move followed by a new admission', () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const activeMoved = encounter({ room: 'Habitacion 2', bed: 'H2C2' });

    const diff = reconcileCensus(current, snapshotOf([newNeoPatient, activeMoved]), {
      reference: REFERENCE,
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' })]);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        patient: expect.objectContaining({ patientName: 'Paciente Nuevo' }),
      }),
    ]);
  });

  it('does not let a next-day admission invalidate a legitimate historical move', () => {
    const current = {
      ...recordWith({ NEO1: patientAt(encounter(), 'NEO1') }),
      date: '2026-07-23',
    };
    const activeMoved = encounter({ room: 'Habitacion 2', bed: 'H2C2' });
    const nextDaySameTarget = encounter({
      encounterId: '142100',
      run: '333333333',
      room: 'Habitacion 2',
      bed: 'H2C2',
      admissionDatetime: '2026-07-24T08:00:00-06:00',
    });

    const diff = reconcileCensus(current, snapshotOf([activeMoved, nextDaySameTarget]), {
      reference: REFERENCE,
    });

    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' })]);
    expect(diff.admissions).toHaveLength(0);
  });

  it('does not let an already-recorded discharge reserve a target for a legitimate move', () => {
    const activeMoved = encounter({ room: 'Habitacion 2', bed: 'H2C2' });
    const staleDischarged = encounter({
      encounterId: '142100',
      run: '333333333',
      room: 'Habitacion 2',
      bed: 'H2C2',
    });
    const current: DailyRecord = {
      ...recordWith({ NEO1: patientAt(encounter(), 'NEO1') }),
      discharges: [
        {
          clinicalEpisodeId: '142100',
          rut: '33.333.333-3',
        } as DailyRecord['discharges'][number],
      ],
    };

    const diff = reconcileCensus(current, snapshotOf([activeMoved, staleDischarged]), {
      reference: REFERENCE,
    });

    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' })]);
    expect(diff.admissions).toHaveLength(0);
  });

  it('uses the official report to move a closed occupant before admitting the new patient', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    expect(initialDiff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'NEO1', code: 'occupied-local-bed' }),
    ]);

    const fetchReport = vi.fn().mockResolvedValue({ base64: 'JVBERg==' });
    const verified = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport,
      extractText: async () => patientFlowText,
    });
    const resolvedDiff = reconcileCensus(current, verified, { reference: REFERENCE });

    expect(fetchReport).toHaveBeenCalledOnce();
    expect(fetchReport).toHaveBeenCalledWith('142040');
    expect(resolvedDiff.conflicts).toHaveLength(0);
    expect(resolvedDiff.moves).toEqual([
      expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' }),
    ]);
    expect(resolvedDiff.admissions).toEqual([expect.objectContaining({ bedId: 'NEO1' })]);
    expect(resolvedDiff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ bedId: 'H2C2', encounterId: '142040' }),
    ]);
    expect(resolvedDiff.summary).toMatchObject({
      admissions: 1,
      moves: 1,
      pendingAdministrativeDischarges: 1,
      conflicts: 0,
    });

    const applied = applyCensusImportDiff(current, resolvedDiff, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.NEO1.patientName).toBe('Paciente Nuevo');
    expect(applied.record.beds.H2C2.patientName).toBe('Paciente Anterior');
  });

  it('resolves a newly exposed chain of closed occupants in bounded rounds', async () => {
    const secondClosed = encounter({
      encounterId: '142050',
      run: '333333333',
      firstFamilyName: 'Segundo',
      room: 'Habitacion 3',
      bed: 'H3C1',
      hasMedicalDischarge: true,
    });
    const current = recordWith({
      NEO1: patientAt(encounter(), 'NEO1'),
      H2C2: patientAt({ ...secondClosed, room: 'Habitacion 2', bed: 'H2C2' }, 'H2C2'),
    });
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient, secondClosed]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const secondFlowText = `
      Paciente: Paciente Segundo RUN: 333333333
      23/07/2026 13:21:41 Servicio Sala Básica H2C2
      23/07/2026 23:20:09 Servicio Sala Básica H3C1
    `;

    const resolved = await resolveOccupiedBedTraceabilityChain(
      current,
      snapshot,
      initialDiff,
      {
        fetchReport: async encounterId => ({
          base64: encounterId === '142040' ? 'QQ==' : 'Qg==',
        }),
        extractText: async buffer =>
          new Uint8Array(buffer)[0] === 65 ? patientFlowText : secondFlowText,
      },
      verified => reconcileCensus(current, verified, { reference: REFERENCE })
    );

    expect(resolved.diff.conflicts).toHaveLength(0);
    expect(resolved.diff.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' }),
        expect.objectContaining({ fromBedId: 'H2C2', toBedId: 'H3C1' }),
      ])
    );
    expect(resolved.diff.admissions).toEqual([expect.objectContaining({ bedId: 'NEO1' })]);
  });

  it('preserves CMA origin while overriding only the verified physical bed', () => {
    expect(
      rayenToPatientData(
        {
          ...closedMovedPatient,
          service: 'Área quirúrgica indiferenciada',
          verifiedBedPlacement: {
            source: 'patient-flow-report',
            bedId: 'R1',
            changedAt: '2026-07-23T23:10:09',
          },
        },
        REFERENCE
      )
    ).toMatchObject({ bedId: 'R1', isCma: true });
  });

  it('keeps the conflict when the report is missing, malformed or still points to Neo1', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });

    const unresolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport: async () => ({ base64: 'JVBERg==' }),
      extractText: async () =>
        'Paciente: Paciente Anterior RUN: 111111111\n' +
        '23/07/2026 13:21:41 Servicio Área Estación Neo 1 Básica Neo1',
    });
    const diff = reconcileCensus(current, unresolved, { reference: REFERENCE });

    expect(diff.moves).toHaveLength(0);
    expect(diff.admissions).toHaveLength(0);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ bedId: 'NEO1', code: 'occupied-local-bed' }),
    ]);
  });

  it('does not use a same-RUN report from a different hospitalization episode', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const differentEpisode = { ...closedMovedPatient, encounterId: '142041' };
    const snapshot = snapshotOf([newNeoPatient, differentEpisode]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const fetchReport = vi.fn();

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport,
      extractText: async () => patientFlowText,
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(resolved).toBe(snapshot);
  });

  it('rejects a report whose patient header does not match the blocking occupant', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport: async () => ({ base64: 'JVBERg==' }),
      extractText: async () => patientFlowText.replace('111111111', '333333333'),
    });

    expect(resolved).toBe(snapshot);
  });

  it('rejects a report containing conflicting RUN headers', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport: async () => ({ base64: 'JVBERg==' }),
      extractText: async () => `${patientFlowText}\nPaciente: Otro RUN: 333333333`,
    });

    expect(resolved).toBe(snapshot);
  });

  it('does not accept a report when both identity RUN values are missing', async () => {
    const noRunEncounter = { ...encounter(), run: '' };
    const current = recordWith({ NEO1: patientAt(noRunEncounter, 'NEO1') });
    const closedNoRun = { ...closedMovedPatient, run: '' };
    const snapshot = snapshotOf([newNeoPatient, closedNoRun]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport: async () => ({ base64: 'JVBERg==' }),
      extractText: async () => patientFlowText.replace('RUN: 111111111', ''),
    });

    expect(resolved).toBe(snapshot);
  });

  it('ignores movements after the census day even when the snapshot is captured later', async () => {
    const current = {
      ...recordWith({ NEO1: patientAt(encounter(), 'NEO1') }),
      date: '2026-07-23',
    };
    const sameDayAdmission = { ...newNeoPatient, admissionDatetime: '2026-07-23T20:00:00-06:00' };
    const snapshot = snapshotOf([sameDayAdmission, closedMovedPatient]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const reportWithNextDayMove =
      `${patientFlowText}\n` + '24/07/2026 08:00:00 Servicio Sala Básica H2C3';

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport: async () => ({ base64: 'JVBERg==' }),
      extractText: async () => reportWithNextDayMove,
    });

    expect(resolved.encounters.find(item => item.encounterId === '142040')).toMatchObject({
      verifiedBedPlacement: { bedId: 'H2C2' },
    });
  });

  it('rejects an ambiguous RUN fallback when the local occupant has no episode id', async () => {
    const legacyPatient = { ...patientAt(encounter(), 'NEO1'), clinicalEpisodeId: '' };
    const current = recordWith({ NEO1: legacyPatient });
    const secondClosedEpisode = { ...closedMovedPatient, encounterId: '142041' };
    const snapshot = snapshotOf([newNeoPatient, closedMovedPatient, secondClosedEpisode]);
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const fetchReport = vi.fn();

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport,
      extractText: async () => patientFlowText,
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(resolved).toBe(snapshot);
  });

  it('does not match a different hospitalization episode by RUN during reconciliation', () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const differentEpisode = encounter({
      encounterId: '142041',
      room: 'Habitacion 2',
      bed: 'H2C2',
    });

    const diff = reconcileCensus(current, snapshotOf([differentEpisode]), {
      reference: REFERENCE,
    });

    expect(diff.moves).toHaveLength(0);
    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H2C2',
        patient: expect.objectContaining({ clinicalEpisodeId: '142041' }),
      }),
    ]);
    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ bedId: 'NEO1', encounterId: '142040' }),
    ]);
  });

  it('does not match either episode when a legacy RUN is ambiguous in the snapshot', () => {
    const legacyPatient = { ...patientAt(encounter(), 'NEO1'), clinicalEpisodeId: '' };
    const current = recordWith({ NEO1: legacyPatient });
    const first = encounter({ encounterId: '142041', room: 'Habitacion 2', bed: 'H2C2' });
    const second = encounter({ encounterId: '142042', room: 'Habitacion 3', bed: 'H3C1' });

    const diff = reconcileCensus(current, snapshotOf([first, second]), { reference: REFERENCE });

    expect(diff.moves).toHaveLength(0);
    expect(diff.admissions.map(entry => entry.bedId)).toEqual(['H2C2', 'H3C1']);
    expect(diff.pendingAdministrativeDischarges).toEqual([
      expect.objectContaining({ bedId: 'NEO1' }),
    ]);
  });

  it.each(['23/07/2026 13:21:41', '2026-07-23'])(
    'accepts supported local admission format %s without shifting the Rapa Nui day',
    async admissionDatetime => {
      const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
      const snapshot = snapshotOf([newNeoPatient, { ...closedMovedPatient, admissionDatetime }]);
      const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });

      const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
        fetchReport: async () => ({ base64: 'JVBERg==' }),
        extractText: async () => patientFlowText,
      });

      expect(resolved.encounters.find(item => item.encounterId === '142040')).toMatchObject({
        verifiedBedPlacement: { bedId: 'H2C2' },
      });
    }
  );

  it.each([
    '2026-00-01',
    '31/02/2026 13:21:41',
    '2026-07-23T25:00',
    '2026-02-30T13:00:00-06:00',
    '2026-07-23T13:00:00+15:00',
  ])(
    'rejects impossible local admission timestamp %s before fetching evidence',
    async admissionDatetime => {
      const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
      const snapshot = snapshotOf([newNeoPatient, { ...closedMovedPatient, admissionDatetime }]);
      const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
      const fetchReport = vi.fn();

      const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
        fetchReport,
        extractText: async () => patientFlowText,
      });

      expect(fetchReport).not.toHaveBeenCalled();
      expect(resolved).toBe(snapshot);
    }
  );

  it('rejects an impossible offset-bearing snapshot cutoff before fetching evidence', async () => {
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const snapshot = {
      ...snapshotOf([newNeoPatient, closedMovedPatient]),
      capturedAt: '2026-02-30T13:00:00-06:00',
    };
    const initialDiff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const fetchReport = vi.fn();

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, initialDiff, {
      fetchReport,
      extractText: async () => patientFlowText,
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(resolved).toBe(snapshot);
  });
});
