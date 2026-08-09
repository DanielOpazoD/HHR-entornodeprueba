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

const useRetryHarness = (onStart: (candidate: DailyRecord) => boolean) => {
  const [state, setState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
  const currentRecordRef = useRef<DailyRecord | null>(record);
  const [fillClinicalData] = useState(() => vi.fn().mockResolvedValue(undefined));
  const retry = useRayenClinicalFillRetry({
    currentRecord: record,
    currentRecordRef,
    fillClinicalData,
    setState,
    onStart,
  });
  return { state, retry, fillClinicalData };
};

describe('useRayenClinicalFillRetry', () => {
  beforeEach(() => {
    resetRayenFillProgress();
  });

  it('does not start a persisted retry while a newer execution owns the controller', async () => {
    const { result } = renderHook(() => useRetryHarness(() => false));

    await act(async () => result.current.retry());

    expect(result.current.fillClinicalData).not.toHaveBeenCalled();
    expect(result.current.state.isSyncing).toBe(false);
    expect(result.current.state.error).toContain('otra sincronización en curso');
  });

  it('starts a persisted retry once the controller adopts its execution', async () => {
    const { result } = renderHook(() => useRetryHarness(() => true));

    await act(async () => result.current.retry());

    expect(result.current.fillClinicalData).toHaveBeenCalledWith(record);
    expect(result.current.state.isSyncing).toBe(true);
    expect(result.current.state.error).toBeNull();
  });
});
