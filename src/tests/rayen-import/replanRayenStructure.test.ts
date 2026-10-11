import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import { buildDischarge } from '@/features/rayen-import/domain/applyCensusImportDiff';
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
  getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
  getForDate: vi.fn().mockResolvedValue(null),
} as unknown as DailyRecordRepositoryPort;

const dependencies = {
  dailyRecord: repository,
  isAdmin: false,
  fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
  fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
  lookupEgresos: vi.fn().mockResolvedValue([]),
};

describe('replanRayenStructure', () => {
  it.each(['recorded', 'deleted', 'other-episode'] as const)(
    'keeps death only for the exact active historical episode (%s)',
    async outcome => {
      const deleted = outcome === 'deleted';
      const patient = { ...rayenToPatientData(encounter).patient, admissionDate: '2026-07-26' };
      const current = makeRecord({ H1C2: patient });
      const previous = { ...makeRecord({}), date: '2026-07-27' };
      previous.discharges = [
        {
          ...buildDischarge(
            patient,
            {
              bedId: 'H1C2',
              rut: patient.rut,
              patientName: patient.patientName,
              encounterId: patient.clinicalEpisodeId,
              kind: 'alta',
              status: 'Fallecido',
              reason: 'administrative-discharge',
              correctedDay: previous.date,
              correctedTime: '18:00',
            },
            previous,
            {
              idFactory: () => 'synthetic-death',
              now: new Date('2026-07-27T23:00:00Z'),
              syncRunId: 'synthetic-run',
            }
          ),
          ...(deleted ? { deletedAt: '2026-07-28T01:00:00Z' } : {}),
          ...(outcome === 'other-episode' ? { clinicalEpisodeId: 'previous-episode' } : {}),
        },
      ];
      const result = await replanRayenStructure(
        current,
        {
          sourceSnapshot: { ...snapshot, encounters: [] },
          reportDate: current.date,
          isHistoricalDay: false,
          egresoRows: [
            {
              run: patient.rut,
              patientName: patient.patientName,
              encounterId: patient.clinicalEpisodeId,
              bedLabel: 'H1C2',
              destino: 'Domicilio',
              fechaEgreso: '27-07-2026 18:00',
              servicio: '',
              edad: '',
              motivo: '',
              exactEpisodeVerification: 'verified',
            },
          ],
        },
        {
          ...dependencies,
          dailyRecord: {
            ...repository,
            getAuthoritativeForDate: vi.fn().mockResolvedValue(previous),
            getLocalForDateWithMeta: vi
              .fn()
              .mockResolvedValue({ record: previous, hasPendingWrites: false, writeState: 'none' }),
          },
        }
      );
      expect(result.discharges).toMatchObject([
        {
          status: outcome === 'recorded' ? 'Fallecido' : 'Vivo',
          historicalMovementRecorded: outcome === 'recorded',
        },
      ]);
      expect(result.previousDayEdits ?? []).toHaveLength(outcome === 'recorded' ? 0 : 1);
    }
  );

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
