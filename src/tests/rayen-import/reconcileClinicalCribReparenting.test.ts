import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);
const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
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
const newborn = (): RayenEncounter =>
  makeEncounter({
    encounterId: 'NEWBORN',
    run: '222222222',
    firstGivenName: 'Bebe',
    birthDate: '2026-07-08',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });
const seed = (encounter: RayenEncounter): PatientData =>
  rayenToPatientData(encounter, REFERENCE).patient;

describe('clinical crib reparenting', () => {
  it('reparents an existing crib when principal patients exchange the destination bed', () => {
    const priorMother = makeEncounter({ room: 'H4', bed: 'C1' });
    const movedMother = makeEncounter({ room: 'H5', bed: 'C1' });
    const priorOccupant = makeEncounter({
      encounterId: 'OUTGOING',
      run: '999999999',
      firstGivenName: 'Paciente',
      room: 'H5',
      bed: 'C1',
    });
    const movedOccupant = { ...priorOccupant, room: 'H6', bed: 'C1' };
    const child = newborn();
    const current: DailyRecord = {
      date: '2026-07-08',
      beds: {
        H4C1: seed(priorMother),
        H5C1: {
          ...seed(priorOccupant),
          clinicalCrib: { ...seed(child), handoffNote: 'Dato neonatal local' },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-08T20:00:00-06:00',
      facilityId: 1342,
      encounters: [movedMother, movedOccupant, child],
    };
    const diff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'crib-reparent-sync',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bedId: 'H6C1',
          changes: [expect.objectContaining({ field: 'clinicalCrib', to: undefined })],
        }),
        expect.objectContaining({
          bedId: 'H5C1',
          changes: [expect.objectContaining({ field: 'clinicalCrib' })],
        }),
      ])
    );
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'MOTHER',
      clinicalCrib: { clinicalEpisodeId: 'NEWBORN', handoffNote: 'Dato neonatal local' },
    });
    expect(applied.record.beds.H6C1).toMatchObject({ clinicalEpisodeId: 'OUTGOING' });
    expect(applied.record.beds.H6C1.clinicalCrib).toBeUndefined();
  });
});
