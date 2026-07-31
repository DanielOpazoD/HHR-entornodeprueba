import { describe, expect, it } from 'vitest';
import {
  rayenToPatientData,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);

const makeEncounter = (overrides: Partial<RayenEncounter>): RayenEncounter => ({
  encounterId: '142202',
  run: '78971495',
  firstGivenName: 'Reina',
  firstFamilyName: 'Haoa',
  birthDate: '1980-01-01',
  service: 'Área quirúrgica indiferenciada',
  room: 'CMA R2',
  bed: 'CMAR2',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Hospitalización',
  ...overrides,
});

const makeRecord = (bedId: string, patient: PatientData): DailyRecord => ({
  date: '2026-07-08',
  beds: { [bedId]: { ...patient, bedId } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const snapshotWithActiveBed = (encounterId: string, bedId: string): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters: [],
  isComplete: true,
  activeBedAssignments: [{ encounterId, bedId }],
});

describe('reconcileCensus Gestión de Camas active-bed evidence', () => {
  it('keeps an episode active when Ficha omits it after a CMA correction', () => {
    const encounter = makeEncounter({ encounterId: '142202' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const diff = reconcileCensus(makeRecord('R2', patient), snapshotWithActiveBed('142202', 'R2'), {
      reference: REFERENCE,
    });

    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.moves).toHaveLength(0);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.activeClinicalEpisodeIds).toContain('142202');
  });

  it('moves an omitted episode by clinicalEpisodeId instead of patient name', () => {
    const encounter = makeEncounter({ encounterId: '142203', room: 'CMA R1', bed: 'CMAR1' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const diff = reconcileCensus(makeRecord('R1', patient), snapshotWithActiveBed('142203', 'R2'), {
      reference: REFERENCE,
    });

    expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
    expect(diff.moves).toEqual([expect.objectContaining({ fromBedId: 'R1', toBedId: 'R2' })]);
  });
});
