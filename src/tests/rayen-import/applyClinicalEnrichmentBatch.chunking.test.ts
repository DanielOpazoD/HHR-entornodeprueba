import { describe, expect, it } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '@/features/rayen-import/domain/rebuildClinicalEnrichmentOperations';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createDependencies, operations, record } from './applyClinicalEnrichmentBatch.fixtures';

describe('applyClinicalEnrichmentBatch chunking', () => {
  it('fails closed when one target exceeds the callable budget', async () => {
    const deps = createDependencies();
    const oversized: ClinicalFillPatchOperation[] = [
      {
        target: operations[0].target,
        patch: {
          'beds.H2C1.deviceDetails': { oversized: 'x'.repeat(510_000) },
        },
      },
    ];

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-large',
        operations: oversized,
        ...deps,
      })
    ).rejects.toThrow('excede por sí sola el límite transaccional');

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('fails before the first enforced mutation when more than 32 targets require fragments', async () => {
    const deps = createDependencies();
    const manyOperations: ClinicalFillPatchOperation[] = Array.from({ length: 33 }, (_, index) => {
      const bedId = `B${String(index + 1).padStart(2, '0')}`;
      return {
        target: {
          censusDate: record.date,
          bedId,
          clinicalEpisodeId: `episode-${index + 1}`,
        },
        patch: {
          [`beds.${bedId}.vitalSigns`]: { systolic: 100 + index },
        } as ClinicalFillPatchOperation['patch'],
      };
    });
    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-chunked',
        operations: manyOperations,
        rebuildOperations: () => manyOperations,
        ...deps,
      })
    ).rejects.toThrow('excede una transacción atómica segura');

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate patient targets for the same episode before invoking authority', async () => {
    const deps = createDependencies();
    const duplicateEpisodeOperations: ClinicalFillPatchOperation[] = [
      operations[0],
      {
        target: { ...operations[0].target, bedId: 'H2C2' },
        patch: { 'beds.H2C2.vitalSigns': { heartRate: 71 } },
      },
    ];

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-duplicate-logical-target',
        operations: duplicateEpisodeOperations,
        ...deps,
      })
    ).rejects.toThrow('mismo episodio más de una vez');

    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('fails before the first enforced mutation when the combined payload exceeds 500 KB', async () => {
    const deps = createDependencies();
    const largeOperations: ClinicalFillPatchOperation[] = ['H2C1', 'H2C2'].map((bedId, index) => ({
      target: {
        censusDate: record.date,
        bedId,
        clinicalEpisodeId: `episode-large-${index + 1}`,
      },
      patch: {
        [`beds.${bedId}.deviceDetails`]: { payload: 'x'.repeat(260_000) },
      } as ClinicalFillPatchOperation['patch'],
    }));

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-enforced-byte-chunks',
        operations: largeOperations,
        rebuildOperations: () => largeOperations,
        ...deps,
      })
    ).rejects.toThrow('excede una transacción atómica segura');

    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });

  it('keeps a rebuilt episode in its chunk after the patient changes beds', async () => {
    const deps = createDependencies();
    const refreshedRecord = {
      ...record,
      lastUpdated: '2026-07-28T10:03:00.000Z',
      meta: { revision: 9 },
    } as DailyRecord;
    const movedOperation: ClinicalFillPatchOperation = {
      target: {
        ...operations[0].target,
        bedId: 'H2C2',
      },
      patch: {
        'beds.H2C2.evaluationScores': { cudyr: { category: 'C1' } },
      },
    };
    deps.refreshRecord.mockResolvedValue(refreshedRecord);
    deps.invoke.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'revision_mismatch',
    });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-moved-bed',
      operations: [operations[0]],
      rebuildOperations: () => [movedOperation],
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        mutationId: 'mutation-fixed',
        baseRevision: 9,
        patches: [expect.objectContaining({ bedId: 'H2C2' })],
      })
    );
    expect(result).toMatchObject({ patientWrites: 1, retries: 1 });
  });

  it('coalesces multiple clinical sources for one moved episode after a version conflict', async () => {
    const deps = createDependencies();
    const baseRecord = {
      ...record,
      beds: {
        H2C1: {
          bedId: 'H2C1',
          clinicalEpisodeId: 'episode-1',
          evaluationScores: { braden: { total: 16 } },
          vitalSigns: { heartRate: 70 },
        },
      },
    } as unknown as DailyRecord;
    const refreshedRecord = {
      ...baseRecord,
      beds: {
        H2C2: {
          ...baseRecord.beds.H2C1,
          bedId: 'H2C2',
        },
      },
      lastUpdated: '2026-07-28T10:04:00.000Z',
      meta: { revision: 9 },
    } as DailyRecord;
    const splitOperations: ClinicalFillPatchOperation[] = [
      {
        target: operations[0].target,
        patch: { 'beds.H2C1.evaluationScores': { braden: { total: 18 } } },
        clinicalFieldCount: 1,
      },
      {
        target: operations[0].target,
        patch: { 'beds.H2C1.vitalSigns': { heartRate: 82 } },
        clinicalFieldCount: 1,
      },
    ];
    deps.refreshRecord.mockResolvedValue(refreshedRecord);
    deps.invoke.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'revision_mismatch',
    });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record: baseRecord,
      runId: 'run-coalesced-rebuild',
      operations: splitOperations,
      rebuildOperations: currentRecord =>
        rebuildClinicalEnrichmentOperations({
          baseRecord,
          currentRecord,
          operations: splitOperations,
        }),
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        mutationId: 'mutation-fixed',
        baseRevision: 9,
        patches: [
          expect.objectContaining({
            bedId: 'H2C2',
            clinicalEpisodeId: 'episode-1',
            fields: {
              evaluationScores: { braden: { total: 18 } },
              vitalSigns: { heartRate: 82 },
            },
          }),
        ],
      })
    );
    expect(result).toMatchObject({ patientWrites: 1, retries: 1 });
  });

  it('rejects a route outside the operation target before invoking the backend', async () => {
    const deps = createDependencies();
    const invalid = [
      {
        ...operations[0],
        patch: { 'beds.H9C9.patientName': 'No permitido' },
      },
    ];

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-1',
        operations: invalid,
        ...deps,
      })
    ).rejects.toThrow('ruta fuera del paciente');
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});
