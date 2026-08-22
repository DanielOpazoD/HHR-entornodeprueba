import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { useRayenImportConfirmation } from '@/features/rayen-import/hooks/useRayenImportConfirmation';

const mocks = vi.hoisted(() => ({
  applyConfirmedRayenImport: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/confirmRayenImport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/hooks/confirmRayenImport')>()),
  applyConfirmedRayenImport: mocks.applyConfirmedRayenImport,
}));

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 1,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 1,
  },
} as CensusImportDiff;

const record = {
  date: '2026-07-28',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-07-28T10:00:00.000Z',
} as DailyRecord;

describe('useRayenImportConfirmation execution ownership', () => {
  it('enqueues a committed handoff after its reviewed UI execution is cancelled', async () => {
    let resolvePersistence!: (value: unknown) => void;
    let resolveClinicalStage!: (value: { status: 'complete' }) => void;
    mocks.applyConfirmedRayenImport.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    const executionRef = {
      current: {
        context: {
          runId: 'run-1',
          requestId: 'request-1',
          selectedDate: record.date,
        },
        pending: { runId: 'run-1', selectedDate: record.date },
        stage: { type: 'awaiting_review' },
        outcome: { structuralConflicts: 0, skippedItems: 0 },
      },
    };
    const runClinicalStage = vi.fn(
      () =>
        new Promise<{ status: 'complete' }>(resolve => {
          resolveClinicalStage = resolve;
        })
    );
    const { result } = renderHook(() =>
      useRayenImportConfirmation({
        currentRecord: record,
        currentRecordRef: { current: record },
        state: {
          diff,
          isPreviewOpen: true,
          isBusy: false,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: null,
        },
        setState: vi.fn(),
        executionRef: executionRef as never,
        dispatchExecution: vi.fn(),
        transitionExecution: vi.fn(),
        preparedSyncContextRef: { current: { record, runId: 'run-1' } } as never,
        structuralReplanRef: {
          current: {
            runId: 'run-1',
            requestId: 'request-1',
            selectedDate: record.date,
            clinicalDay: record.date,
            replan: vi.fn(),
          },
        },
        selectedDateRef: { current: record.date },
        dailyRecord: {} as never,
        isAdmin: false,
        ensureRun: vi.fn().mockReturnValue({ id: 'run-1' }),
        failRun: vi.fn(),
        recordRunPerformance: vi.fn(),
        applyDiff: vi.fn() as never,
        runClinicalStage,
        loadAuthoritativeStructuralRecord: vi.fn(),
        runSerializedPersistence: operation => operation(),
      })
    );

    const confirmation = result.current();
    executionRef.current = {
      ...executionRef.current,
      context: { ...executionRef.current.context, requestId: 'request-2' },
      stage: { type: 'cancelled' },
    };
    resolvePersistence({
      appliedDiff: diff,
      skipped: [],
      historicalCorrectionsPending: false,
      confirmedHandoff: {},
    });

    await vi.waitFor(() => expect(runClinicalStage).toHaveBeenCalledOnce());
    let confirmationSettled = false;
    void confirmation.then(() => {
      confirmationSettled = true;
    });
    await Promise.resolve();
    expect(confirmationSettled).toBe(false);

    resolveClinicalStage({ status: 'complete' });
    await act(async () => confirmation);

    expect(runClinicalStage).toHaveBeenCalledOnce();
    expect(runClinicalStage).toHaveBeenCalledWith({});
  });
});
