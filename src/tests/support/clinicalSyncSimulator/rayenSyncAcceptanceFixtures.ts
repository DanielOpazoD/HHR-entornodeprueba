import { rayenToPatientData } from '@/features/rayen-import';
import type { RayenCensusSnapshot, RayenEncounter } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export const RAYEN_ACCEPTANCE_REFERENCE = new Date(2026, 6, 31, 12, 0, 0);

const fixtureEncounter = (
  suffix: string,
  overrides: Partial<RayenEncounter> = {}
): RayenEncounter => ({
  encounterId: `fixture-episode-${suffix}`,
  run: `00000000${suffix.length}`,
  firstGivenName: 'Fixture',
  firstFamilyName: suffix,
  birthDate: '1986-01-01',
  administrativeSex: 'Mujer',
  service: 'Area Medico Quirurgica Indiferenciada',
  room: 'H1',
  bed: 'C1',
  admissionDatetime: '2026-07-31T09:00:00-06:00',
  diagnosis: `Diagnostico fixture ${suffix}`,
  ...overrides,
});

const seedPatient = (encounter: RayenEncounter, bedId?: string) => {
  const mapped = rayenToPatientData(encounter, RAYEN_ACCEPTANCE_REFERENCE);
  return { ...mapped.patient, bedId: bedId ?? mapped.bedId ?? '' };
};

export interface RayenSyncAcceptanceScenario {
  current: DailyRecord;
  snapshot: RayenCensusSnapshot;
  episodes: {
    admitted: string;
    mother: string;
    newborn: string;
    moved: string;
    updated: string;
    pavilionRecovery: string[];
  };
}

/**
 * One fictional hospital day that crosses the most failure-prone Rayen boundaries without PHI.
 * It intentionally combines independent rules so the acceptance test validates their composition,
 * not another isolated implementation detail.
 */
export const createRayenSyncAcceptanceScenario = (): RayenSyncAcceptanceScenario => {
  const mother = fixtureEncounter('Materna', {
    encounterId: 'fixture-episode-mother',
    run: '000000001',
    room: 'H4',
    bed: 'C1',
    treatingPhysicianId: 'fixture-practitioner-1',
    treatingPhysicianName: 'Profesional Fixture Uno',
    treatingPhysicianSpecialty: 'Ginecobstetricia',
  });
  const newborn = fixtureEncounter('Recien Nacido', {
    encounterId: 'fixture-episode-newborn',
    run: '000000001',
    firstGivenName: 'Rn Fixture',
    firstFamilyName: 'Materna',
    birthDate: '2026-07-31',
    administrativeSex: 'Hombre',
    room: 'Cunas',
    bed: 'CH4C1',
    clinicalCribParentBedId: 'H4C1',
    diagnosis: 'Recien nacido fixture',
  });
  const movedBefore = fixtureEncounter('Traslado', {
    encounterId: 'fixture-episode-moved',
    run: '000000002',
    room: 'H2',
    bed: 'C1',
  });
  const movedAfter = { ...movedBefore, room: 'H1', bed: 'C2' };
  const updated = fixtureEncounter('Actualizacion', {
    encounterId: 'fixture-episode-updated',
    run: '000000003',
    room: 'H5',
    bed: 'C1',
    diagnosis: 'Diagnostico fixture actualizado',
    treatingPhysicianId: 'fixture-practitioner-2',
    treatingPhysicianName: 'Profesional Fixture Dos',
    treatingPhysicianSpecialty: 'Med Interna',
  });
  const admitted = fixtureEncounter('Ingreso', {
    encounterId: 'fixture-episode-admitted',
    run: '000000004',
    room: 'Neo 1',
    bed: 'Neo1',
  });
  const pavilionRecoveryOne = fixtureEncounter('Pabellon Uno', {
    encounterId: 'fixture-episode-pavilion-1',
    run: '000000005',
    service: 'Recuperacion Pabellon',
    room: 'Pabellon-R1',
    bed: 'P-R1',
  });
  const pavilionRecoveryTwo = fixtureEncounter('Pabellon Dos', {
    encounterId: 'fixture-episode-pavilion-2',
    run: '000000006',
    service: 'Recuperacion Pabellon',
    room: 'Pabellon-R2',
    bed: 'P-R2',
  });

  const current: DailyRecord = {
    date: '2026-07-31',
    beds: {
      H4C1: seedPatient(mother),
      H2C1: { ...seedPatient(movedBefore), handoffNote: 'Nota local preservada' },
      H5C1: {
        ...seedPatient(updated),
        pathology: 'Diagnostico fixture anterior',
        treatingPhysicianId: undefined,
        treatingPhysicianName: undefined,
        specialty: 'Especialidad local anterior',
        handoffNote: 'Otra nota local preservada',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-31T08:00:00.000Z',
  };

  return {
    current,
    snapshot: {
      capturedAt: '2026-07-31T14:00:00-06:00',
      facilityId: 1342,
      encounters: [
        mother,
        newborn,
        movedAfter,
        updated,
        admitted,
        pavilionRecoveryOne,
        pavilionRecoveryTwo,
      ],
      isComplete: true,
    },
    episodes: {
      admitted: admitted.encounterId,
      mother: mother.encounterId,
      newborn: newborn.encounterId,
      moved: movedAfter.encounterId,
      updated: updated.encounterId,
      pavilionRecovery: [pavilionRecoveryOne.encounterId, pavilionRecoveryTwo.encounterId],
    },
  };
};
