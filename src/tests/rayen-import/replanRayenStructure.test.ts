import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

const encounter: RayenEncounter = {
  encounterId: 'episode-1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-28T10:00:00-06:00',
  diagnosis: 'Neumonía',
};

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-28T20:00:00-06:00',
  facilityId: 1342,
  encounters: [encounter],
  isComplete: true,
};

const makeRecord = (beds: DailyRecord['beds']): DailyRecord =>
  ({
    date: '2026-07-28',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-28T10:00:00.000Z',
  }) as DailyRecord;

const repository = {
  getForDate: vi.fn().mockResolvedValue(null),
} as unknown as DailyRecordRepositoryPort;

const dependencies = {
  dailyRecord: repository,
  isAdmin: false,
  fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
  fetchStatisticalDischarge: vi
    .fn()
    .mockResolvedValue({ base64: '', error: 'unavailable' }),
  lookupEgresos: vi.fn().mockResolvedValue([]),
};

describe('replanRayenStructure', () => {
  it('rebuilds the plan against the fresh HHR revision using the same Rayen capture', async () => {
    const evidence = {
      sourceSnapshot: snapshot,
      egresoRows: [],
      reportDate: '2026-07-28',
      isHistoricalDay: false,
    } as const;

    const initial = await replanRayenStructure(makeRecord({}), evidence, dependencies);
    expect(initial.admissions).toHaveLength(1);

    const mapped = rayenToPatientData(encounter, new Date(2026, 6, 28));
    const fresh = await replanRayenStructure(
      makeRecord({ [mapped.bedId ?? 'H1C2']: mapped.patient }),
      evidence,
      dependencies
    );

    expect(fresh.admissions).toHaveLength(0);
    expect(fresh.updates).toHaveLength(0);
    expect(fresh.unchangedCount).toBe(1);
  });

  it('re-evaluates conflicts instead of carrying conflicts from an obsolete HHR revision', async () => {
    const occupied = rayenToPatientData(encounter, new Date(2026, 6, 28));
    const evidence = {
      sourceSnapshot: snapshot,
      egresoRows: [],
      reportDate: '2026-07-28',
      isHistoricalDay: false,
    } as const;

    const conflicted = await replanRayenStructure(
      makeRecord({
        H1C2: {
          ...occupied.patient,
          clinicalEpisodeId: 'different-episode',
          rut: '11111111-1',
        },
      }),
      evidence,
      dependencies
    );
    expect(conflicted.conflicts.length).toBeGreaterThan(0);

    const replanned = await replanRayenStructure(makeRecord({}), evidence, dependencies);

    expect(replanned.conflicts).toHaveLength(0);
    expect(replanned.admissions).toHaveLength(1);
  });
});
