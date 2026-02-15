import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';

describe('usePatientRowUiState', () => {
    it('opens and closes all row modals state slices', () => {
        const { result } = renderHook(() => usePatientRowUiState());

        expect(result.current.showDemographics).toBe(false);
        expect(result.current.showExamRequest).toBe(false);
        expect(result.current.showHistory).toBe(false);

        act(() => {
            result.current.openDemographics();
            result.current.openExamRequest();
            result.current.openHistory();
        });

        expect(result.current.showDemographics).toBe(true);
        expect(result.current.showExamRequest).toBe(true);
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
});
