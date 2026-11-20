import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientActionMenu } from '@/features/census/components/patient-row/usePatientActionMenu';

describe('usePatientActionMenu', () => {
  it('returns utility actions according to blocked state', () => {
    const { result } = renderHook(() =>
      usePatientActionMenu({
        isBlocked: true,
        readOnly: false,
        onAction: vi.fn(),
      })
    );

    expect(result.current.utilityActions.map(action => action.action)).toEqual(['clear']);
  });

  it('runs row action and closes menu', () => {
    const onAction = vi.fn();
    const { result } = renderHook(() =>
      usePatientActionMenu({
        isBlocked: false,
        readOnly: false,
        onAction,
      })
    );

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.handleAction('copy');
    });

    expect(onAction).toHaveBeenCalledWith('copy');
    expect(result.current.isOpen).toBe(false);
  });

  it('runs optional handlers and closes menu', () => {
    const onViewHistory = vi.fn();
    const onViewExamRequest = vi.fn();
    const { result } = renderHook(() =>
      usePatientActionMenu({
        isBlocked: false,
        readOnly: false,
        onAction: vi.fn(),
        onViewHistory,
        onViewExamRequest,
      })
    );

    act(() => {
      result.current.toggle();
    });

    act(() => {
      result.current.handleViewHistory();
    });

    expect(onViewHistory).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.toggle();
      result.current.handleViewExamRequest();
    });

    expect(onViewExamRequest).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
  });
});
