import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDiagnosisMode } from '@/features/census/hooks/useDiagnosisMode';

describe('useDiagnosisMode', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses free as default mode when storage is empty', () => {
        const { result } = renderHook(() => useDiagnosisMode());

        expect(result.current.diagnosisMode).toBe('free');
    });

    it('reads persisted cie10 mode and toggles back to free', () => {
        localStorage.setItem('hhr_diagnosis_mode', 'cie10');

        const { result } = renderHook(() => useDiagnosisMode());

        expect(result.current.diagnosisMode).toBe('cie10');

        act(() => {
            result.current.toggleDiagnosisMode();
        });

        expect(result.current.diagnosisMode).toBe('free');
        expect(localStorage.getItem('hhr_diagnosis_mode')).toBe('free');
    });

    it('ignores invalid storage values and falls back to free', () => {
        localStorage.setItem('hhr_diagnosis_mode', 'invalid');

        const { result } = renderHook(() => useDiagnosisMode());

        expect(result.current.diagnosisMode).toBe('free');
    });

    it('toggles mode even when persistence fails', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        const { result } = renderHook(() => useDiagnosisMode());

        act(() => {
            result.current.toggleDiagnosisMode();
        });

        expect(result.current.diagnosisMode).toBe('cie10');
    });

    it('falls back to free when storage read throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        const { result } = renderHook(() => useDiagnosisMode());

        expect(result.current.diagnosisMode).toBe('free');
    });
});
