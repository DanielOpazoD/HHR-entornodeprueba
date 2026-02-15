import { describe, expect, it } from 'vitest';
import { resolveDiagnosisToggleUiState } from '@/features/census/controllers/censusDiagnosisHeaderController';

describe('censusDiagnosisHeaderController', () => {
    it('returns free-text toggle metadata when diagnosis mode is free', () => {
        const result = resolveDiagnosisToggleUiState('free');

        expect(result).toEqual({
            isCie10Mode: false,
            title: 'Modo texto libre (clic para cambiar a CIE-10)',
            buttonClassName: 'bg-white border border-slate-300 text-slate-400 hover:text-medical-600'
        });
    });

    it('returns cie10 toggle metadata when diagnosis mode is cie10', () => {
        const result = resolveDiagnosisToggleUiState('cie10');

        expect(result).toEqual({
            isCie10Mode: true,
            title: 'Modo CIE-10 (clic para cambiar a texto libre)',
            buttonClassName: 'bg-medical-600 text-white'
        });
    });
});
