import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientInputSectionBindings } from '@/features/census/components/patient-row/usePatientInputSectionBindings';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('usePatientInputSectionBindings', () => {
  it('returns section bindings wired with shared state', () => {
    const data = DataFactory.createMockPatient('R1');
    const onDemo = vi.fn();
    const onChange = {
      text: vi.fn(),
      check: vi.fn(),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    const { result } = renderHook(() =>
      usePatientInputSectionBindings({
        data,
        currentDateString: '2026-02-15',
        isSubRow: false,
        isEmpty: false,
        isLocked: false,
        diagnosisMode: 'free',
        hasRutError: false,
        handleDebouncedText: vi.fn(),
        onDemo,
        onChange,
      })
    );

    expect(result.current.identity.shared.data).toBe(data);
    expect(result.current.identity.onDemo).toBe(onDemo);
    expect(result.current.clinical.diagnosisMode).toBe('free');
  });

  it('memoizes output when dependencies do not change', () => {
    const data = DataFactory.createMockPatient('R2');
    const onDemo = vi.fn();
    const handleDebouncedText = vi.fn();
    const onChange = {
      text: vi.fn(),
      check: vi.fn(),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    const { result, rerender } = renderHook(props => usePatientInputSectionBindings(props), {
      initialProps: {
        data,
        currentDateString: '2026-02-15',
        isSubRow: false,
        isEmpty: false,
        isLocked: false,
        diagnosisMode: 'free' as const,
        hasRutError: false,
        handleDebouncedText,
        onDemo,
        onChange,
      },
    });

    const first = result.current;
    rerender({
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      isEmpty: false,
      isLocked: false,
      diagnosisMode: 'free' as const,
      hasRutError: false,
      handleDebouncedText,
      onDemo,
      onChange,
    });

    expect(result.current).toBe(first);
  });
});
