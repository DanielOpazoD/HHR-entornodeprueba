import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from '@/features/rayen-import/hooks/rayenImportState';
import { useRayenClinicalFillRetry } from '@/features/rayen-import/hooks/useRayenClinicalFillRetry';
import { resetRayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';
import type { ClinicalRetryToken } from '@/features/rayen-import/contracts/clinicalStageResult';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const record = {
  date: '2026-08-08',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-08T09:00:00.000Z',
  rayenSync: {
    runId: 'persisted-run',
    status: 'applied',
    at: '2026-08-08T09:00:00.000Z',
    by: 'Operador HHR',
  },
} as DailyRecord;

const useRetryHarness = (
  onStart: (candidate: DailyRecord) => boolean,
  retryRequest: ClinicalRetryToken | null = null,
  activeRecord: DailyRecord = record
) => {
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const currentRecordRef = useRef<DailyRecord | null>(activeRecord);
  const [runClinicalStage] = useState(() =>
    vi.fn().mockResolvedValue({ status: 'complete' as const })
  );
  const retryTokenRef = useRef(retryRequest);
  const retry = useRayenClinicalFillRetry({
    currentRecord: activeRecord,
    currentRecordRef,
    runClinicalStage,
    retryTokenRef,
    setState,
    onStart,
  });
  return { state, retry, retryTokenRef, runClinicalStage };
};

describe('useRayenClinicalFillRetry', () => {
  beforeEach(() => {
    resetRayenFillProgress();
  });

  it('does not start a persisted retry while a newer execution owns the controller', async () => {
    const { result } = renderHook(() => useRetryHarness(() => false));

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).not.toHaveBeenCalled();
    expect(result.current.state.isSyncing).toBe(false);
    expect(result.current.state.error).toContain('otra sincronización en curso');
  });

  it('starts a persisted retry once the controller adopts its execution', async () => {
    const { result } = renderHook(() => useRetryHarness(() => true));

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).toHaveBeenCalledWith(record);
    expect(result.current.state.isSyncing).toBe(true);
    expect(result.current.state.error).toBeNull();
  });

  it('resumes a clinical-only retry from a structurally confirmed partial run', async () => {
    const partialRecord = {
      ...record,
      rayenSync: { ...record.rayenSync, status: 'partial' as const },
      rayenSyncHistory: [
        {
          id: 'persisted-run',
          startedAt: '2026-08-08T09:00:00.000Z',
          by: 'Operador HHR',
          status: 'partial' as const,
          structuralReview: {
            structureConfirmed: true,
            historicalCorrectionsPending: false,
            historicalCorrectionsRequireFreshCapture: false,
            isolatedConflicts: 0,
          },
        },
      ],
    } as DailyRecord;
    const { result } = renderHook(() =>
      useRetryHarness(() => true, null, partialRecord)
    );

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).toHaveBeenCalledWith(partialRecord);
    expect(result.current.state.isSyncing).toBe(true);
    expect(result.current.state.error).toBeNull();
  });

  it('does not bypass structural review for a partial run without a confirmed handoff', async () => {
    const partialRecord = {
      ...record,
      rayenSync: { ...record.rayenSync, status: 'partial' as const },
    } as DailyRecord;
    const { result } = renderHook(() => useRetryHarness(() => true, null, partialRecord));

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).not.toHaveBeenCalled();
    expect(result.current.state.error).toContain('No hay una sincronización clínica pendiente');
  });

  it('does not resume a completed run', async () => {
    const completedRecord = {
      ...record,
      rayenSync: { ...record.rayenSync, status: 'complete' as const },
    } as DailyRecord;
    const { result } = renderHook(() =>
      useRetryHarness(() => true, null, completedRecord)
    );

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).not.toHaveBeenCalled();
    expect(result.current.state.isSyncing).toBe(false);
    expect(result.current.state.error).toContain('No hay una sincronización clínica pendiente');
  });

  it('retries only the clinical episodes carried by the pending token', async () => {
    const retryRequest: ClinicalRetryToken = {
      type: 'clinical_retry',
      source: record,
      pendingClinicalEpisodeIds: ['episode-pending'],
    };
    const { result } = renderHook(() => useRetryHarness(() => true, retryRequest));

    await act(async () => result.current.retry());

    expect(result.current.runClinicalStage).toHaveBeenCalledWith(retryRequest);
  });

  it('discards a retry token from another day and run before starting', async () => {
    const staleRecord = {
      ...record,
      date: '2026-08-07',
      rayenSync: { ...record.rayenSync, runId: 'stale-run' },
    } as DailyRecord;
    const staleRetry: ClinicalRetryToken = {
      type: 'clinical_retry',
      source: staleRecord,
      pendingClinicalEpisodeIds: ['episode-stale'],
    };
    const { result } = renderHook(() => useRetryHarness(() => true, staleRetry));

    await act(async () => result.current.retry());

    expect(result.current.retryTokenRef.current).toBeNull();
    expect(result.current.runClinicalStage).toHaveBeenCalledWith(record);
  });

  it('uses the confirmed handoff run when its embedded snapshot has stale run evidence', async () => {
    const confirmedRecord = {
      ...record,
      rayenSyncHistory: [
        {
          id: 'persisted-run',
          startedAt: '2026-08-08T09:00:00.000Z',
          by: 'Operador HHR',
          status: 'applied' as const,
          policy: { mode: 'preview' as const, revision: 1 },
        },
      ],
    } as DailyRecord;
    const handoff = resolveConfirmedRayenCensusHandoff(
      {
        record: confirmedRecord,
        result: { date: confirmedRecord.date, outcome: 'clean' } as SaveDailyRecordResult,
      },
      { date: confirmedRecord.date, runId: 'persisted-run' }
    );
    const retryRequest: ClinicalRetryToken = {
      type: 'clinical_retry',
      source: {
        ...handoff,
        record: {
          ...confirmedRecord,
          rayenSync: { ...record.rayenSync!, runId: 'embedded-stale-run' },
        },
      },
      pendingClinicalEpisodeIds: ['episode-pending'],
    };
    const { result } = renderHook(() => useRetryHarness(() => true, retryRequest));

    await act(async () => result.current.retry());

    expect(result.current.retryTokenRef.current?.pendingClinicalEpisodeIds).toEqual([
      'episode-pending',
    ]);
    expect(result.current.runClinicalStage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clinical_retry',
        pendingClinicalEpisodeIds: ['episode-pending'],
        source: expect.objectContaining({
          runId: 'persisted-run',
          record,
        }),
      })
    );
  });
});
