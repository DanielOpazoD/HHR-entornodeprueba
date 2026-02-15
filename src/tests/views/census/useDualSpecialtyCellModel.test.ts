import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { useDualSpecialtyCellModel } from '@/features/census/components/patient-row/useDualSpecialtyCellModel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types';

describe('useDualSpecialtyCellModel', () => {
  it('exposes derived labels/state and add/remove handlers', () => {
    const onFieldChange = vi.fn();
    const onChange = vi.fn().mockReturnValue(onFieldChange);
    const data = DataFactory.createMockPatient('R1', {
      specialty: Specialty.MEDICINA,
      secondarySpecialty: undefined,
    });

    const { result } = renderHook(() =>
      useDualSpecialtyCellModel({
        data,
        onChange,
      })
    );

    expect(result.current.state.hasSecondary).toBe(false);
    expect(typeof result.current.primaryLabel).toBe('string');

    const addEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleAddSecondary(addEvent);
    });

    expect(onChange).toHaveBeenCalledWith('secondarySpecialty');
    expect(onFieldChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ value: '' }),
      })
    );
  });
});
