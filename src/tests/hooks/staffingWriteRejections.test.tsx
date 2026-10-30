import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDetailedStaffingManagement,
  useNurseManagement,
  useTensManagement,
} from '@/hooks/useNurseManagement';
import { DailyRecordFreshnessGateError } from '@/hooks/controllers/dailyRecordFreshnessGateError';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';

const record = DataFactory.createMockDailyRecord('2026-04-03');
const refusal = () => new DailyRecordFreshnessGateError('Estamos verificando los últimos datos.');
const detail: DailyRecordStaffingDetailsV1 = {
  day: { nurses: [], tens: [] },
  night: { nurses: [], tens: [] },
};
const flushRejections = () => new Promise(resolve => setTimeout(resolve, 0));

describe('a refused staffing write', () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    unhandled.mockClear();
    process.on('unhandledRejection', unhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
  });

  it.each([
    [
      'nurse',
      (patch: () => Promise<void>) =>
        renderHook(() => useNurseManagement(record, patch)).result.current.updateNurse,
    ],
    [
      'TENS',
      (patch: () => Promise<void>) =>
        renderHook(() => useTensManagement(record, patch)).result.current.updateTens,
    ],
  ])('leaves no rejection behind from the %s selector and lets it retry', async (_role, build) => {
    const patch = vi.fn<() => Promise<void>>().mockRejectedValueOnce(refusal());
    patch.mockResolvedValue(undefined);
    const select = build(patch);

    select('day', 0, 'Persona Sintética');
    await flushRejections();
    expect(unhandled).not.toHaveBeenCalled();

    select('day', 0, 'Persona Sintética');
    await flushRejections();
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('still tells the staffing modal that its save failed', async () => {
    const patch = vi.fn<() => Promise<void>>().mockRejectedValue(refusal());
    const { result } = renderHook(() => useDetailedStaffingManagement(record, patch));

    await expect(result.current.updateDetailedStaffing(detail)).rejects.toThrow(
      DailyRecordFreshnessGateError
    );
  });
});
