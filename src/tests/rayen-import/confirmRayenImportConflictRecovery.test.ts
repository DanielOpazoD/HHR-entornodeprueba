import { describe, expect, it, vi } from 'vitest';
import { applyConfirmedRayenImport } from '@/features/rayen-import/hooks/confirmRayenImport';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

describe('applyConfirmedRayenImport · recuperación de conflictos envueltos', () => {
  it('reintenta también un conflicto que llega solo con el mensaje canónico de concurrencia', async () => {
    // El repositorio puede envolver el CAS rechazado en un Error genérico; el
    // mensaje canónico basta para replanificar en vez de matar la corrida.
    const stale = record('stale');
    const fresh = record('fresh');
    const initialDiff = {} as CensusImportDiff;
    const expected = { record: fresh, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error(
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.'
    );
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(expected);
    const onRetry = vi.fn();

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: stale,
        diff: initialDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord: vi.fn().mockResolvedValue(fresh),
        replanDiff: vi.fn().mockResolvedValue(initialDiff),
        createId: () => 'id',
        onRetry,
      })
    ).resolves.toMatchObject({ appliedDiff: initialDiff });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenCalledTimes(2);
  });
});
