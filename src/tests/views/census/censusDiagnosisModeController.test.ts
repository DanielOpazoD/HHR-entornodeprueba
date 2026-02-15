import { describe, expect, it, vi } from 'vitest';
import {
    DIAGNOSIS_MODE_STORAGE_KEY,
    executeToggleDiagnosisMode,
    getNextDiagnosisMode,
    parseDiagnosisMode,
    resolveInitialDiagnosisMode
} from '@/features/census/controllers/censusDiagnosisModeController';

describe('censusDiagnosisModeController', () => {
    it('parses only cie10 as cie10 and falls back to free', () => {
        expect(parseDiagnosisMode('cie10')).toBe('cie10');
        expect(parseDiagnosisMode('free')).toBe('free');
        expect(parseDiagnosisMode('invalid')).toBe('free');
        expect(parseDiagnosisMode(null)).toBe('free');
    });

    it('resolves initial mode from storage and handles read failures', () => {
        const validStorage = {
            getItem: vi.fn().mockReturnValue('cie10'),
            setItem: vi.fn()
        };
        expect(resolveInitialDiagnosisMode(validStorage)).toBe('cie10');

        const throwingStorage = {
            getItem: vi.fn(() => {
                throw new Error('read failed');
            }),
            setItem: vi.fn()
        };
        expect(resolveInitialDiagnosisMode(throwingStorage)).toBe('free');
        expect(resolveInitialDiagnosisMode(null)).toBe('free');
    });

    it('computes next mode deterministically', () => {
        expect(getNextDiagnosisMode('free')).toBe('cie10');
        expect(getNextDiagnosisMode('cie10')).toBe('free');
    });

    it('toggles and persists when storage write succeeds', () => {
        const storage = {
            getItem: vi.fn(),
            setItem: vi.fn()
        };

        const result = executeToggleDiagnosisMode('free', storage);

        expect(result).toEqual({
            nextMode: 'cie10',
            persisted: true
        });
        expect(storage.setItem).toHaveBeenCalledWith(
            DIAGNOSIS_MODE_STORAGE_KEY,
            'cie10'
        );
    });

    it('toggles without throwing when storage write fails', () => {
        const storage = {
            getItem: vi.fn(),
            setItem: vi.fn(() => {
                throw new Error('quota');
            })
        };

        const result = executeToggleDiagnosisMode('cie10', storage);

        expect(result).toEqual({
            nextMode: 'free',
            persisted: false
        });
    });
});
