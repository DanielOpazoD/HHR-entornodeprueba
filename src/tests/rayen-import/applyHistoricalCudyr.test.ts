import { canWritePreviousDay } from '@/features/rayen-import/domain/previousDayCorrections';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { applyHistoricalCudyrBatchAuthoritatively } from '@/features/rayen-import/hooks/applyHistoricalCudyr';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

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
  ({
    date: '2026-07-29',
    beds: {
      H2C1: {
        bedId: 'H2C1',
        patientName: 'Paciente',
        clinicalEpisodeId: '142000',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: revision,
  }) as unknown as DailyRecord;

const recordWithTwoEpisodes = (revision: string): DailyRecord =>
  ({
    ...record(revision),
    beds: {
      ...record(revision).beds,
      H2C2: {
        bedId: 'H2C2',
        patientName: 'Paciente dos',
        clinicalEpisodeId: '142001',
      },
    },
  }) as unknown as DailyRecord;

describe('applyHistoricalCudyr', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the structural 48-hour window unchanged for a non-admin operator', () => {
    vi.useFakeTimers();
    try {
      const day = '2026-07-29';
      const midnight = new Date(`${day}T00:00:00`).getTime();
      vi.setSystemTime(midnight + 172_800_000 - 1);
      expect(canWritePreviousDay(day, false)).toBe(true);
      vi.setSystemTime(midnight + 172_800_000);
      expect(canWritePreviousDay(day, false)).toBe(false);
      expect(canWritePreviousDay(day, true)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['admin', 'nurse_hospital'] as const)(
    'persists historical CUDYR for %s through the source run',
    async role => {
      const historicalRecord = recordWithTwoEpisodes('revision-1');
      const repository = {
        getAuthoritativeForDate: vi.fn().mockResolvedValue(historicalRecord),
      } as unknown as DailyRecordRepositoryPort;
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
      const sourceRecord = {
        ...record('revision-source'),
        date: '2026-07-30',
      } as unknown as DailyRecord;

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
          mode: 'enforced',
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
      const concurrentRecord = {
        ...historicalRecord,
        beds: {
          ...historicalRecord.beds,
          H2C1: {
            ...historicalRecord.beds.H2C1,
            evaluationScores: { braden: { total: 19 } },
          },
        },
      } as unknown as DailyRecord;
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
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn();
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

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
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

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
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(record('revision-1')),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn();
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

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
    const initialRecord = {
      ...recordWithTwoEpisodes('revision-1'),
      beds: {
        ...recordWithTwoEpisodes('revision-1').beds,
        H2C1: {
          ...recordWithTwoEpisodes('revision-1').beds.H2C1,
          evaluationScores: { cudyr },
        },
      },
    } as unknown as DailyRecord;
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(initialRecord),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const secondCudyr: ImportedCudyr = { ...cudyr, category: 'B2', author: 'Otra enfermera' };
    const sourceRecord = {
      ...record('revision-source'),
      date: '2026-07-30',
    } as unknown as DailyRecord;

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
    const concurrentRecord = {
      ...initialRecord,
      beds: {
        H2C2: initialRecord.beds.H2C2,
      },
      lastUpdated: 'revision-2',
    } as unknown as DailyRecord;

    expect(() => rebuildOperations(concurrentRecord)).not.toThrow();
    expect(rebuildOperations(concurrentRecord)).toEqual([
      expect.objectContaining({
        patch: { 'beds.H2C2.evaluationScores': { cudyr: secondCudyr } },
      }),
    ]);
  });
});
