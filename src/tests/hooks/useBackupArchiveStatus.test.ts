import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupArchiveStatus } from '@/hooks/useBackupArchiveStatus';

const controls = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
      resolve = done;
    });
    return { promise, resolve };
  };
  return {
    deferred,
    storageReady: deferred(),
    storageStarted: deferred(),
    presenterReady: deferred(),
    presenterStarted: deferred(),
    lookup: vi.fn(),
    present: vi.fn(),
    record: vi.fn(),
  };
});

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: controls.record,
}));

const outcome = {
  status: 'success',
  data: { exists: true, lookup: { exists: true, status: 'found' } },
  issues: [],
};
const warning = vi.fn();
const error = vi.fn();
const props = {
  currentDateString: '2026-10-03',
  currentModule: 'CENSUS',
  selectedShift: 'day' as const,
  canVerifyArchiveStatus: true,
  warning,
  error,
};
let idleCallback: IdleRequestCallback;
const cancelIdleCallback = vi.fn();
const startLookup = () => {
  act(() => idleCallback({ didTimeout: false, timeRemaining: () => 50 }));
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  controls.storageReady = controls.deferred();
  controls.storageStarted = controls.deferred();
  controls.presenterReady = controls.deferred();
  controls.presenterStarted = controls.deferred();
  vi.doMock('@/application/backup-export/backupExportStorageUseCases', async () => {
    controls.storageStarted.resolve();
    await controls.storageReady.promise;
    return { executeLookupBackupArchiveStatus: controls.lookup };
  });
  vi.doMock('@/hooks/controllers/backupStorageOutcomeController', async () => {
    controls.presenterStarted.resolve();
    await controls.presenterReady.promise;
    return { presentBackupLookupOutcome: controls.present };
  });
  controls.lookup.mockReset().mockResolvedValue(outcome);
  controls.present.mockReset().mockReturnValue({ channel: null });
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    idleCallback = callback;
    return 1;
  });
  vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
});

afterEach(async () => {
  cleanup();
  controls.storageReady.resolve();
  controls.presenterReady.resolve();
  await vi.dynamicImportSettled();
  vi.unstubAllGlobals();
});

describe('useBackupArchiveStatus lifecycle', () => {
  it('cancels the queued idle lookup when the view closes', async () => {
    const { unmount } = renderHook(() => useBackupArchiveStatus(props));
    unmount();
    expect(cancelIdleCallback).toHaveBeenCalledWith(1);
    controls.storageReady.resolve();
    controls.presenterReady.resolve();
    await vi.dynamicImportSettled();
    expect(controls.lookup).not.toHaveBeenCalled();
  });

  it('does not start a remote lookup after its lazy module loads for a closed view', async () => {
    const { unmount } = renderHook(() => useBackupArchiveStatus(props));
    startLookup();
    await controls.storageStarted.promise;
    unmount();
    controls.storageReady.resolve();
    controls.presenterReady.resolve();
    await vi.dynamicImportSettled();
    expect(controls.lookup).not.toHaveBeenCalled();
  });

  it('discards a pending lookup result after changing day', async () => {
    const read = controls.deferred();
    controls.lookup.mockImplementation(async () => {
      await read.promise;
      return outcome;
    });
    controls.storageReady.resolve();
    controls.presenterReady.resolve();
    const { result, rerender } = renderHook(useBackupArchiveStatus, { initialProps: props });
    startLookup();
    await vi.dynamicImportSettled();
    expect(controls.lookup).toHaveBeenCalledOnce();
    rerender({ ...props, currentDateString: '2026-10-04', canVerifyArchiveStatus: false });
    await act(async () => read.resolve());
    expect(result.current.isArchived).toBe(false);
    expect(controls.record).not.toHaveBeenCalled();
    expect(controls.present).not.toHaveBeenCalled();
  });

  it.each(['warning', 'error'])(
    'discards an obsolete %s notice after its presenter loads',
    async channel => {
      controls.storageReady.resolve();
      controls.present.mockReturnValue({
        channel,
        title: 'Respaldo',
        message: 'Aviso de otra fecha',
      });
      const { result, rerender } = renderHook(useBackupArchiveStatus, { initialProps: props });
      startLookup();
      await act(async () => controls.presenterStarted.promise);
      expect(result.current.isArchived).toBe(true);
      rerender({ ...props, currentDateString: '2026-10-04', canVerifyArchiveStatus: false });
      controls.presenterReady.resolve();
      await vi.dynamicImportSettled();
      expect(result.current.isArchived).toBe(false);
      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );

  it('preserves the current lookup, archived state, telemetry and notice', async () => {
    controls.storageReady.resolve();
    controls.presenterReady.resolve();
    controls.present.mockReturnValue({
      channel: 'warning',
      title: 'Respaldo',
      message: 'Aviso actual',
    });
    const { result } = renderHook(() => useBackupArchiveStatus(props));
    startLookup();
    await act(async () => vi.dynamicImportSettled());
    expect(controls.lookup).toHaveBeenCalledWith({
      backupType: 'census',
      date: '2026-10-03',
      shift: 'day',
    });
    expect(result.current.isArchived).toBe(true);
    expect(controls.record).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith('Respaldo', 'Aviso actual');
    expect(error).not.toHaveBeenCalled();
  });
});
