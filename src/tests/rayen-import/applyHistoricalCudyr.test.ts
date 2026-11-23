import { canWriteCensusDay } from '@/shared/access/censusDayWriteAccessPolicy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { applyHistoricalCudyrBatchAuthoritatively } from '@/features/rayen-import/hooks/applyHistoricalCudyr';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import { DataFactory, asStoredDailyRecordShape } from '@/tests/factories/DataFactory';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));

const cudyr: ImportedCudyr = {
  category: 'C1',
  recordedDate: '2026-07-29',
  recordedAt: '2026-07-30T02:15:00Z',
  author: 'Enfermera prueba',
  source: 'Eloísa · Gestión de Camas',
};

const record = (revision: string): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-07-29', {
    beds: {
      H2C1: { ...createEmptyPatient('H2C1'), patientName: 'Paciente', clinicalEpisodeId: '142000' },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: revision,
  });

const recordWithTwoEpisodes = (revision: string): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-01-01', {
    ...record(revision),
    beds: {
      ...record(revision).beds,
      H2C2: {
        ...createEmptyPatient('H2C2'),
        patientName: 'Paciente dos',
        clinicalEpisodeId: '142001',
      },
    },
  });

describe('applyHistoricalCudyr', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['America/Santiago', 'UTC', 'Pacific/Pago_Pago', 'Pacific/Easter'])(
    'measures the 48-hour window from Rapa Nui midnight for a non-admin operator on a device in %s',
    timezone => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = timezone;
      vi.useFakeTimers();
      try {
        const day = '2026-07-29';
        // Rapa Nui midnight in winter time (UTC-6), whatever the device's own midnight is.
        const midnight = Date.parse('2026-07-29T06:00:00.000Z');
        vi.setSystemTime(midnight + 172_800_000 - 1);
        expect(canWriteCensusDay(day, false)).toBe(true);
        vi.setSystemTime(midnight + 172_800_000);
        expect(canWriteCensusDay(day, false)).toBe(false);
        expect(canWriteCensusDay(day, true)).toBe(true);
      } finally {
        vi.useRealTimers();
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
      }
    }
  );

  it.each(['admin', 'nurse_hospital'] as const)(
    'persists historical CUDYR for %s through the source run',
    async role => {
      const historicalRecord = recordWithTwoEpisodes('revision-1');
      const repository: DailyRecordRepositoryPort = {
        ...buildMockDailyRecordRepository(),
        getAuthoritativeForDate: vi.fn().mockResolvedValue(historicalRecord),
      };
      const applyBatch = vi.fn().mockResolvedValue({
        patientWrites: 2,
        historySnapshots: 1,
        persistence: {
          scope: 'historical',
          callableAttempts: 2,
          clientRetries: 1,
          transactionRetries: 0,
        },
      });
      const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
      const sourceRecord = asStoredDailyRecordShape({
        ...record('revision-source'),
        date: '2026-07-30',
      });

      await expect(
        applyHistoricalCudyrBatchAuthoritatively({
          dailyRecord: repository,
          sourceRecord,
          censusDay: '2026-07-29',
          items: [
            { clinicalEpisodeId: '142000', cudyr },
            { clinicalEpisodeId: '142001', cudyr: secondCudyr },
          ],
          role,
          runId: 'run-authoritative',
          applyBatch,
        })
      ).resolves.toEqual({
        results: [
          { clinicalEpisodeId: '142000', persisted: true, changed: true },
          { clinicalEpisodeId: '142001', persisted: true, changed: true },
        ],
        persistence: {
          scope: 'historical',
          callableAttempts: 2,
          clientRetries: 1,
          transactionRetries: 0,
        },
      });

      expect(repository.getAuthoritativeForDate).toHaveBeenCalledOnce();
      expect(applyBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          record: historicalRecord,
          authorityDate: '2026-07-30',
          runId: 'run-authoritative',
          operations: [
            expect.objectContaining({
              patch: { 'beds.H2C1.evaluationScores': { cudyr } },
            }),
            expect.objectContaining({
              patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
            }),
          ],
        })
      );
      const rebuildOperations = applyBatch.mock.calls[0]?.[0].rebuildOperations as (
        record: DailyRecord
      ) => unknown[];
      const concurrentRecord = asStoredDailyRecordShape({
        ...historicalRecord,
        beds: {
          ...historicalRecord.beds,
          H2C1: {
            ...historicalRecord.beds.H2C1,
            evaluationScores: { braden: { total: 19 } },
          },
        },
      });
      expect(rebuildOperations(concurrentRecord)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            patch: { 'beds.H2C1.evaluationScores': { cudyr } },
          }),
        ])
      );
      expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
    }
  );

  it('treats a missing historical census as not applicable without invoking authority', async () => {
    const repository: DailyRecordRepositoryPort = {
      ...buildMockDailyRecordRepository(),
      getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
    };
    const applyBatch = vi.fn();
    const sourceRecord = asStoredDailyRecordShape({
      ...record('revision-source'),
      date: '2026-07-30',
    });

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord,
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        role: 'admin',
        runId: 'run-authoritative',
        applyBatch,
      })
    ).resolves.toEqual({
      results: [
        {
          clinicalEpisodeId: '142000',
          persisted: false,
          changed: false,
          applicable: false,
        },
      ],
    });

    expect(repository.getAuthoritativeForDate).toHaveBeenCalledOnce();
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it('preserves aggregate retries when an older callable cannot provide scoped evidence', async () => {
    const historicalRecord = recordWithTwoEpisodes('revision-1');
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(historicalRecord),
    } as unknown as DailyRecordRepositoryPort;
    const sourceRecord = asStoredDailyRecordShape({
      ...record('revision-source'),
      date: '2026-07-30',
    });

    const result = await applyHistoricalCudyrBatchAuthoritatively({
      dailyRecord: repository,
      sourceRecord,
      censusDay: '2026-07-29',
      items: [{ clinicalEpisodeId: '142000', cudyr }],
      role: 'admin',
      runId: 'run-legacy-telemetry',
      applyBatch: vi.fn().mockResolvedValue({
        patientWrites: 1,
        historySnapshots: 1,
        retries: 1,
      }),
    });

    expect(result).toMatchObject({ retries: 1 });
    expect(result).not.toHaveProperty('persistence');
  });

  it.each([
    { censusDay: '2026-07-28', role: 'admin', label: 'an admin day outside the source run' },
    {
      censusDay: '2026-07-28',
      role: 'nurse_hospital',
      label: 'a nurse day outside the source run',
    },
    { censusDay: '2026-07-29', role: 'doctor_urgency', label: 'a non-CUDYR writer' },
  ] as const)('does not invoke authority for $label', async ({ censusDay, role }) => {
    const repository: DailyRecordRepositoryPort = {
      ...buildMockDailyRecordRepository(),
      getAuthoritativeForDate: vi.fn().mockResolvedValue(record('revision-1')),
    };
    const applyBatch = vi.fn();
    const sourceRecord = asStoredDailyRecordShape({
      ...record('revision-source'),
      date: '2026-07-30',
    });

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord,
        censusDay,
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        role,
        runId: 'run-authoritative',
        applyBatch,
      })
    ).resolves.toEqual({
      results: [
        {
          clinicalEpisodeId: '142000',
          persisted: false,
          changed: false,
          applicable: false,
        },
      ],
    });

    expect(repository.getAuthoritativeForDate).not.toHaveBeenCalled();
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it('rebuilds only pending CUDYR operations after a concurrent authoritative write', async () => {
    const initialRecord = DataFactory.createMockDailyRecord('2026-01-01', {
      ...recordWithTwoEpisodes('revision-1'),
      beds: {
        ...recordWithTwoEpisodes('revision-1').beds,
        H2C1: {
          ...createEmptyPatient('H2C1'),
          ...recordWithTwoEpisodes('revision-1').beds.H2C1,
          evaluationScores: { cudyr },
        },
      },
    });
    const repository: DailyRecordRepositoryPort = {
      ...buildMockDailyRecordRepository(),
      getAuthoritativeForDate: vi.fn().mockResolvedValue(initialRecord),
    };
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
    const sourceRecord = asStoredDailyRecordShape({
      ...record('revision-source'),
      date: '2026-07-30',
    });

    await applyHistoricalCudyrBatchAuthoritatively({
      dailyRecord: repository,
      sourceRecord,
      censusDay: '2026-07-29',
      items: [
        { clinicalEpisodeId: '142000', cudyr },
        { clinicalEpisodeId: '142001', cudyr: secondCudyr },
      ],
      role: 'admin',
      runId: 'run-authoritative',
      applyBatch,
    });

    const rebuildOperations = applyBatch.mock.calls[0]?.[0].rebuildOperations as (
      record: DailyRecord
    ) => unknown[];
    const concurrentRecord = DataFactory.createMockDailyRecord('2026-01-01', {
      ...initialRecord,
      beds: {
        H2C2: initialRecord.beds.H2C2,
      },
      lastUpdated: 'revision-2',
    });

    expect(() => rebuildOperations(concurrentRecord)).not.toThrow();
    expect(rebuildOperations(concurrentRecord)).toEqual([
      expect.objectContaining({
        patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
      }),
    ]);
  });

  it('isolates a concurrently removed historical episode during rebuild without aborting other patients', async () => {
    const initialRecord = recordWithTwoEpisodes('revision-1');
    const repository: DailyRecordRepositoryPort = {
      ...buildMockDailyRecordRepository(),
      getAuthoritativeForDate: vi.fn().mockResolvedValue(initialRecord),
    };
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
    const concurrentRecord = DataFactory.createMockDailyRecord('2026-01-01', {
      ...initialRecord,
      beds: {
        H2C2: initialRecord.beds.H2C2,
      },
      lastUpdated: 'revision-2',
    });
    const applyBatch = vi
      .fn()
      .mockImplementation(
        async (input: {
          rebuildOperations: (record: DailyRecord) => unknown[];
          refreshCommittedRecord?: () => Promise<unknown>;
        }) => {
          expect(input.rebuildOperations(concurrentRecord)).toEqual([
            expect.objectContaining({
              patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
            }),
          ]);
          expect(input.refreshCommittedRecord).toEqual(expect.any(Function));
          await input.refreshCommittedRecord?.();
          return { patientWrites: 1, historySnapshots: 1, retries: 1 };
        }
      );
    const sourceRecord = asStoredDailyRecordShape({
      ...record('revision-source'),
      date: '2026-07-30',
    });

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord,
        censusDay: '2026-07-29',
        items: [
          { clinicalEpisodeId: '142000', cudyr },
          { clinicalEpisodeId: '142001', cudyr: secondCudyr },
        ],
        role: 'admin',
        runId: 'run-partial-rebuild',
        applyBatch,
      })
    ).resolves.toEqual({
      results: [
        { clinicalEpisodeId: '142000', persisted: false, changed: false, applicable: false },
        { clinicalEpisodeId: '142001', persisted: true, changed: true },
      ],
      retries: 1,
    });
    // One initial read + one post-commit day-only refresh via refreshCommittedRecord.
    expect(repository.getAuthoritativeForDate).toHaveBeenCalledTimes(2);
  });
});
