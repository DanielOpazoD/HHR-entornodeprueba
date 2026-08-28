import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  applyHistoricalCudyrBatch,
  applyHistoricalCudyrBatchAuthoritatively,
} from '@/features/rayen-import/hooks/applyHistoricalCudyr';
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

const sourceRecord = (): DailyRecord =>
  ({ ...record('revision-source'), date: '2026-07-30' }) as unknown as DailyRecord;

describe('historical CUDYR remote authority', () => {
  it('never consults a local fallback when Firestore authority is unavailable', async () => {
    const repository = {
      getAuthoritativeForDate: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('local-stale') }),
    } as unknown as DailyRecordRepositoryPort;

    await expect(
      applyHistoricalCudyrBatch({
        dailyRecord: repository,
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
      })
    ).rejects.toThrow('Firestore unavailable');

    expect(repository.getForDateWithMeta).not.toHaveBeenCalled();
    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('preserves an authoritative administrative result and adjacent scales', async () => {
    const historicalRecord = record('revision-1');
    historicalRecord.beds.H2C1.evaluationScores = {
      braden: { total: 18 },
      downton: { total: 2 },
      cudyr: {
        category: 'D2',
        recordedDate: '2026-07-29',
        source: 'HHR · ajuste administrativo',
      },
    } as never;
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(historicalRecord),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn();

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord: sourceRecord(),
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
        runId: 'run-authoritative',
        applyBatch,
      })
    ).resolves.toEqual({
      results: [
        {
          clinicalEpisodeId: '142000',
          persisted: false,
          changed: false,
          administrativeOverridePreserved: true,
        },
      ],
    });

    expect(applyBatch).not.toHaveBeenCalled();
    expect(historicalRecord.beds.H2C1.evaluationScores).toMatchObject({
      braden: { total: 18 },
      downton: { total: 2 },
      cudyr: { category: 'D2', source: 'HHR · ajuste administrativo' },
    });
  });

  it('drops a rebuilt operation when a concurrent administrative adjustment becomes authoritative', async () => {
    const administrativeRecord = record('revision-2');
    administrativeRecord.beds.H2C1.evaluationScores = {
      cudyr: {
        category: 'D2',
        recordedDate: '2026-07-29',
        source: 'HHR · ajuste administrativo',
      },
    } as never;
    const repository = {
      getAuthoritativeForDate: vi.fn().mockResolvedValue(record('revision-1')),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn().mockImplementation(
      async (input: { rebuildOperations: (record: DailyRecord) => unknown[] }) => {
        expect(input.rebuildOperations(administrativeRecord)).toEqual([]);
        return { patientWrites: 0, historySnapshots: 0, retries: 1 };
      }
    );

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord: sourceRecord(),
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
        runId: 'run-concurrent-admin',
        applyBatch,
      })
    ).resolves.toEqual({
      results: [
        {
          clinicalEpisodeId: '142000',
          persisted: false,
          changed: false,
          administrativeOverridePreserved: true,
        },
      ],
      retries: 1,
    });
  });

  it('keeps enforced work pending when the authoritative remote read fails', async () => {
    const repository = {
      getAuthoritativeForDate: vi.fn().mockRejectedValue(new Error('remote read failed')),
      getForDateWithMeta: vi.fn().mockResolvedValue({ record: record('local-stale') }),
    } as unknown as DailyRecordRepositoryPort;
    const applyBatch = vi.fn();

    await expect(
      applyHistoricalCudyrBatchAuthoritatively({
        dailyRecord: repository,
        sourceRecord: sourceRecord(),
        censusDay: '2026-07-29',
        items: [{ clinicalEpisodeId: '142000', cudyr }],
        isAdmin: true,
        runId: 'run-remote-failure',
        applyBatch,
      })
    ).rejects.toThrow('remote read failed');

    expect(repository.getForDateWithMeta).not.toHaveBeenCalled();
    expect(applyBatch).not.toHaveBeenCalled();
  });
});
