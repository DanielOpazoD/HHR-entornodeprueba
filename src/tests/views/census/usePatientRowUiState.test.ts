import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';

describe('usePatientRowUiState', () => {
  it('keeps a single active row modal at a time and closes it cleanly', () => {
    const { result } = renderHook(() => usePatientRowUiState());

    expect(result.current.showDemographics).toBe(false);
    expect(result.current.showExamRequest).toBe(false);
    expect(result.current.showHistory).toBe(false);

    act(() => {
      result.current.openDemographics();
    });

    expect(result.current.showDemographics).toBe(true);
    expect(result.current.showExamRequest).toBe(false);
    expect(result.current.showHistory).toBe(false);

    act(() => {
      result.current.openExamRequest();
    });

    expect(result.current.showDemographics).toBe(false);
    expect(result.current.showExamRequest).toBe(true);
    expect(result.current.showHistory).toBe(false);

    act(() => {
      result.current.openHistory();
    });

    expect(result.current.showDemographics).toBe(false);
    expect(result.current.showExamRequest).toBe(false);
    expect(result.current.showHistory).toBe(true);

    act(() => {
      result.current.closeDemographics();
      result.current.closeExamRequest();
      result.current.closeHistory();
    });

    expect(result.current.showDemographics).toBe(false);
    expect(result.current.showExamRequest).toBe(false);
    expect(result.current.showHistory).toBe(false);
  });

  it('preserves object and callback references across rerenders when modal state is unchanged', () => {
    const { result, rerender } = renderHook(() => usePatientRowUiState());
    const initial = result.current;

    rerender();

    expect(result.current).toBe(initial);
    expect(result.current.openDemographics).toBe(initial.openDemographics);
  });
});
