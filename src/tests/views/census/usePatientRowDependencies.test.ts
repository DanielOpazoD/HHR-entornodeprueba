import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';
import { useDailyRecordBedActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBedActions: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('usePatientRowDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDailyRecordBedActions).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordBedActions>>({
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple: vi.fn(),
        toggleBedType: vi.fn(),
      })
    );
    vi.mocked(useConfirmDialog).mockReturnValue(
      asHookValue<ReturnType<typeof useConfirmDialog>>({
        confirm: vi.fn(),
        alert: vi.fn(),
      })
    );
  });

  it('returns patient-row runtime dependencies from context hooks', () => {
    const { result } = renderHook(() => usePatientRowDependencies());

    expect(typeof result.current.updatePatient).toBe('function');
    expect(typeof result.current.updateClinicalCrib).toBe('function');
    expect(typeof result.current.toggleBedType).toBe('function');
    expect(typeof result.current.confirm).toBe('function');
    expect(typeof result.current.alert).toBe('function');
  });
});
