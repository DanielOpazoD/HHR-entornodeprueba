import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useModalFormFlow } from '@/features/census/hooks/useModalFormFlow';

interface TestFormState {
  time: string;
  date: string;
}

interface TestFormErrors {
  time?: string;
  date?: string;
}

describe('useModalFormFlow', () => {
  it('re-initializes form state when modal opens', () => {
    const { result, rerender } = renderHook(
      ({ isOpen, initialTime }) =>
        useModalFormFlow<TestFormState, TestFormErrors, TestFormState>({
          isOpen,
          resolveInitialState: () => ({ time: initialTime, date: '2026-02-15' }),
          createInitialErrors: () => ({}),
          validate: () => ({}),
          buildPayload: state => state,
          onConfirm: vi.fn(),
        }),
      {
        initialProps: { isOpen: false, initialTime: '08:00' },
      }
    );

    act(() => {
      result.current.setFormField('time', '10:00');
    });
    expect(result.current.formState.time).toBe('10:00');

    rerender({ isOpen: true, initialTime: '09:00' });
    expect(result.current.formState.time).toBe('09:00');
  });

  it('clears field errors when updating related form values', () => {
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useModalFormFlow<TestFormState, TestFormErrors, TestFormState>({
        isOpen: true,
        resolveInitialState: () => ({ time: '', date: '2026-02-15' }),
        createInitialErrors: () => ({}),
        validate: state => ({
          time: state.time ? undefined : 'Hora requerida',
        }),
        buildPayload: state => state,
        onConfirm,
      })
    );

    act(() => {
      result.current.submit();
    });
    expect(result.current.errors.time).toBe('Hora requerida');

    act(() => {
      result.current.setFormField('time', '11:00', ['time']);
    });
    expect(result.current.errors.time).toBeUndefined();
  });

  it('submits payload only when validation passes', () => {
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useModalFormFlow<TestFormState, TestFormErrors, string>({
        isOpen: true,
        resolveInitialState: () => ({ time: '', date: '2026-02-15' }),
        createInitialErrors: () => ({}),
        validate: state => ({
          time: state.time ? undefined : 'Hora requerida',
        }),
        buildPayload: state => `${state.date} ${state.time}`,
        onConfirm,
      })
    );

    act(() => {
      result.current.submit();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => {
      result.current.patchFormState({ time: '12:30' }, ['time']);
    });

    act(() => {
      result.current.submit();
    });

    expect(onConfirm).toHaveBeenCalledWith('2026-02-15 12:30');
  });
});
