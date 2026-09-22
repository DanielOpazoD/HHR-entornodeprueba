import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type {
  CensusImportDiff,
  HistoricalRecoveryDay,
} from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { applyHistoricalRecoveryDays } from '@/features/rayen-import/domain/applyHistoricalRecovery';
import {
  assertHistoricalRecoveryCompatible,
  isHistoricalRecoveryPartialCandidate,
} from '@/features/rayen-import/domain/historicalRecoveryCompatibility';
import {
  findHistoricalRecoveryStart,
  planHistoricalRecovery,
} from '@/features/rayen-import/domain/historicalRecovery';
import { applyCrossDayDiff } from '@/features/rayen-import/domain/applyCrossDayDiff';
import {
  reportEgresoEntry,
  reportEgresoPatient,
} from '@/features/rayen-import/domain/applyCensusImportDiff';
import { applyPatches } from '@/utils/patchUtils';

const empty = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: 'base',
  }) as DailyRecord;

const admissionPatient = {
  ...EMPTY_PATIENT,
  bedId: 'E1',
  patientName: 'Paciente histórico',
  rut: '11111111-1',
  clinicalEpisodeId: 'episode-admission',
  admissionDate: '2026-09-19',
};

const reportEgreso = {
  run: '22222222-2',
  encounterId: 'episode-discharge',
  patientName: 'Paciente egresado',
  bedLabel: 'H1C1',
  destino: 'Domicilio',
  fechaEgreso: '19-09-2026 15:00',
  kind: 'alta' as const,
  status: 'Vivo' as const,
  correctedDay: '2026-09-19',
  correctedTime: '15:00',
};

const recoveryPlan = (includeAdmission = true): HistoricalRecoveryDay => ({
  day: '2026-09-19',
  recordExists: true,
  isSigned: false,
  withinEditingWindow: true,
  admissions: includeAdmission
    ? [{ bedId: 'E1', patient: admissionPatient } as CensusImportDiff['admissions'][number]]
    : [],
  reportEgresos: [reportEgreso],
  conflicts: [],
});

const recoveryDiff = (includeAdmission = true): CensusImportDiff => ({
  admissions: recoveryPlan(includeAdmission).admissions,
  updates: [],
  moves: [],
  discharges: [],
  reportEgresos: [reportEgreso],
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
});

const repository = (initial: DailyRecord[]) => {
  const records = new Map(initial.map(record => [record.date, record]));
  let rejectStructural = false;
  const updatePartialDetailed = vi.fn(
    async (date: string, patch: Parameters<typeof applyPatches>[1]) => {
      if (rejectStructural && 'activeExtraBeds' in patch) {
        return { outcome: 'blocked', updatedRemotely: false };
      }
      const record = applyPatches(records.get(date)!, patch);
      records.set(date, record);
      return { outcome: 'clean', updatedRemotely: true, confirmedRecord: record };
    }
  );
  const port = {
    getAuthoritativeForDate: vi.fn(async (date: string) => records.get(date) ?? null),
    getLocalForDateWithMeta: vi.fn(async () => ({
      record: null,
      writeState: 'none',
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
    })),
    initializeDay: vi.fn(async (date: string) => {
      const record = empty(date);
      records.set(date, record);
      return record;
    }),
    updatePartialDetailed,
  };
  return {
    records,
    updatePartialDetailed,
    port: port as unknown as DailyRecordRepositoryPort,
    rejectStructural: (value: boolean) => {
      rejectStructural = value;
    },
  };
};

const movementRecord = (syncRunId = 'run-a'): DailyRecord => {
  const plan = recoveryPlan(false);
  return applyCrossDayDiff(
    empty(plan.day),
    [
      {
        entry: reportEgresoEntry(reportEgreso),
        patient: reportEgresoPatient(reportEgreso),
      },
    ],
    { actor: 'Prueba', syncRunId, idFactory: () => 'unused' }
  ).record;
};

describe('historical recovery resumption across runs', () => {
  it('recaptures a movement-only partial and completes beds plus extras in one CAS', async () => {
    const store = repository([
      { ...empty('2026-09-19'), activeExtraBeds: ['E2'] },
      { ...empty('2026-09-18'), beds: { H1C1: admissionPatient } },
    ]);
    store.rejectStructural(true);
    await expect(
      applyHistoricalRecoveryDays(store.port, [recoveryPlan()], '2026-09-20', () => true, {
        actor: 'Primera corrida',
        syncRunId: 'run-a',
      })
    ).rejects.toThrow('No se confirmó');

    const partial = store.records.get('2026-09-19')!;
    expect(partial.discharges).toHaveLength(1);
    expect(partial.beds.E1?.patientName).toBeFalsy();
    expect(isHistoricalRecoveryPartialCandidate(partial)).toBe(true);
    expect(
      await findHistoricalRecoveryStart('2026-09-20', store.port, new Date('2026-09-20T18:00:00Z'))
    ).toBe('2026-09-19');

    const reconstruct = vi.fn<(record: DailyRecord) => Promise<CensusImportDiff>>(async () =>
      recoveryDiff()
    );
    const [resumed] = await planHistoricalRecovery({
      dateStart: '2026-09-19',
      selectedDate: '2026-09-20',
      port: store.port,
      buildEmpty: empty,
      reconstruct,
      canWrite: () => true,
    });
    expect(reconstruct.mock.calls[0][0]).toMatchObject({ beds: {}, discharges: [] });
    expect(resumed.admissions).toHaveLength(1);

    store.rejectStructural(false);
    store.updatePartialDetailed.mockClear();
    await applyHistoricalRecoveryDays(store.port, [resumed], '2026-09-20', () => true, {
      actor: 'Segunda corrida',
      syncRunId: 'run-b',
    });

    const confirmed = store.records.get('2026-09-19')!;
    expect(confirmed.discharges).toHaveLength(1);
    expect(confirmed.discharges[0].movementProvenance?.syncRunId).toBe('run-a');
    expect(confirmed.beds.E1.clinicalEpisodeId).toBe('episode-admission');
    expect(confirmed.activeExtraBeds).toEqual(expect.arrayContaining(['E1', 'E2']));
    expect(store.updatePartialDetailed).toHaveBeenCalledTimes(1);
    const structuralPatch = store.updatePartialDetailed.mock.calls[0][1];
    expect(structuralPatch).toMatchObject({ activeExtraBeds: expect.arrayContaining(['E1']) });
    expect(Object.keys(structuralPatch).some(path => path.startsWith('beds.E1.'))).toBe(true);
  });

  it('omits a completed movement-only day from a fresh recovery proposal', async () => {
    const completed = movementRecord();
    const store = repository([completed]);
    const reconstruct = vi.fn(async () => recoveryDiff(false));
    const result = await planHistoricalRecovery({
      dateStart: completed.date,
      selectedDate: '2026-09-20',
      port: store.port,
      buildEmpty: empty,
      reconstruct,
      canWrite: () => true,
    });
    expect(reconstruct).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
  });

  it('rejects a mixed manual movement even when another movement has valid recovery provenance', () => {
    const valid = movementRecord();
    const mixed = {
      ...valid,
      discharges: [
        ...valid.discharges,
        {
          ...valid.discharges[0],
          id: 'manual-movement',
          clinicalEpisodeId: 'manual-episode',
          movementProvenance: {
            source: 'manual' as const,
            lineageId: 'manual-movement',
            classifiedAt: '2026-09-19T16:00:00Z',
          },
        },
      ],
    };
    expect(isHistoricalRecoveryPartialCandidate(mixed)).toBe(false);
    expect(() => assertHistoricalRecoveryCompatible(mixed, recoveryPlan(false))).toThrow(
      /historial/
    );
  });

  it.each([
    [
      'manual provenance',
      (record: DailyRecord): DailyRecord => ({
        ...record,
        discharges: record.discharges.map(item => ({
          ...item,
          movementProvenance: {
            source: 'manual',
            lineageId: item.id,
            classifiedAt: '2026-09-19T15:00:00Z',
          },
        })),
      }),
      false,
    ],
    [
      'reclassified provenance',
      (record: DailyRecord): DailyRecord => ({
        ...record,
        discharges: record.discharges.map(item => ({
          ...item,
          movementProvenance: {
            source: 'reclassified',
            lineageId: item.id,
            classifiedAt: '2026-09-19T15:00:00Z',
            previousMovementId: item.id,
            previousClassification: 'discharge',
            syncRunId: 'run-a',
          },
        })),
      }),
      false,
    ],
    [
      'wrong lineage',
      (record: DailyRecord): DailyRecord => ({
        ...record,
        discharges: record.discharges.map(item => ({
          ...item,
          movementProvenance: { ...item.movementProvenance!, lineageId: 'other' },
        })),
      }),
      false,
    ],
    [
      'tombstone',
      (record: DailyRecord): DailyRecord => ({
        ...record,
        discharges: record.discharges.map(item => ({ ...item, deletedAt: '2026-09-20T10:00:00Z' })),
      }),
      false,
    ],
    [
      'field drift',
      (record: DailyRecord): DailyRecord => ({
        ...record,
        discharges: record.discharges.map(item => ({ ...item, patientName: 'Paciente alterado' })),
      }),
      true,
    ],
  ])('rejects %s instead of adopting it into a new run', (_label, mutate, candidate) => {
    const changed = mutate(movementRecord());
    expect(isHistoricalRecoveryPartialCandidate(changed)).toBe(candidate);
    expect(() => assertHistoricalRecoveryCompatible(changed, recoveryPlan(false))).toThrow(
      /historial/
    );
  });
});
