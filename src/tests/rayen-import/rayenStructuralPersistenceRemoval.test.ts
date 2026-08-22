import { expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { buildRayenStructuralPersistenceBase } from '@/features/rayen-import/domain/rayenStructuralPersistenceBase';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const patient = (bedId: string, clinicalEpisodeId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: 'Paciente sanitizado',
  rut: `ID-${clinicalEpisodeId}`,
  admissionDate: '2026-08-17',
  clinicalEpisodeId,
});

const record = (beds: DailyRecord['beds'], lastUpdated: string): DailyRecord => ({
  date: '2026-08-17',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated,
});

it('accepts a pending outbox that already removed a reviewed collision candidate', () => {
  const selected = patient('R4', 'episode-selected');
  const other = patient('R1', 'episode-other');
  const authoritative = record({ R4: selected, R1: other }, '2026-08-17T20:00:00.000Z');
  const local = record({ R4: selected }, '2026-08-17T20:01:00.000Z');
  const diff = {
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
    bedOccupancyCollisions: [
      {
        id: 'collision-r1',
        bedId: 'R1',
        availableAlternativeBedIds: [],
        candidates: [
          {
            clinicalEpisodeId: 'episode-selected',
            sourceKind: 'medical-surgical',
            currentBedId: 'R4',
            patient: selected,
            source: { encounterId: 'episode-selected' } as never,
          },
          {
            clinicalEpisodeId: 'episode-other',
            sourceKind: 'cma',
            currentBedId: 'R1',
            patient: other,
            source: { encounterId: 'episode-other' } as never,
          },
        ],
      },
    ],
    bedOccupancyCollisionResolutions: [
      {
        collisionId: 'collision-r1',
        selectedEpisodeId: 'episode-selected',
        otherDisposition: { kind: 'remove' },
      },
    ],
  } as CensusImportDiff;

  const base = buildRayenStructuralPersistenceBase(authoritative, local, diff, {
    localWriteState: 'active',
  });

  expect(base.beds.R4?.clinicalEpisodeId).toBe('episode-selected');
  expect(base.beds.R1?.clinicalEpisodeId).toBe('episode-other');
});
