import { describe, it, expect } from 'vitest';
import {
    getDepScore,
    getRiskScore,
    getDepCategory,
    getRiskCategory,
    getCategoryColor,
    getCategorization,
    EMPTY_CUDYR_SCORE
} from '@/features/cudyr/services/CudyrScoreUtils';
import { CudyrScore } from '@/types';

describe('CudyrScoreUtils', () => {

    describe('getDepScore', () => {

        it('should return 0 for empty scores', () => {
            expect(getDepScore(EMPTY_CUDYR_SCORE)).toBe(0);
        });

        it('should sum all dependency fields correctly', () => {
            const score: CudyrScore = {
                ...EMPTY_CUDYR_SCORE,
                changeClothes: 2,
                mobilization: 3,
                feeding: 1,
                elimination: 2,
                psychosocial: 1,
                surveillance: 3
            };
            expect(getDepScore(score)).toBe(12); // 2+3+1+2+1+3
        });

    });

    describe('getRiskScore', () => {

        it('should return 0 for empty scores', () => {
            expect(getRiskScore(EMPTY_CUDYR_SCORE)).toBe(0);
        });

        it('should sum all risk fields correctly', () => {
            const score: CudyrScore = {
                ...EMPTY_CUDYR_SCORE,
                vitalSigns: 3,
                fluidBalance: 2,
                oxygenTherapy: 3,
                airway: 3,
                proInterventions: 2,
                skinCare: 1,
                pharmacology: 3,
                invasiveElements: 2
            };
            expect(getRiskScore(score)).toBe(19); // 3+2+3+3+2+1+3+2
        });

    });

    describe('getDepCategory', () => {

        it('should return "3" for scores 0-6 (Autosuficiencia Parcial)', () => {
            expect(getDepCategory(0)).toBe('3');
            expect(getDepCategory(3)).toBe('3');
            expect(getDepCategory(6)).toBe('3');
        });

        it('should return "2" for scores 7-12 (Dependencia Parcial)', () => {
            expect(getDepCategory(7)).toBe('2');
            expect(getDepCategory(10)).toBe('2');
            expect(getDepCategory(12)).toBe('2');
        });

        it('should return "1" for scores 13-18 (Dependencia Total)', () => {
            expect(getDepCategory(13)).toBe('1');
            expect(getDepCategory(15)).toBe('1');
            expect(getDepCategory(18)).toBe('1');
        });

    });

    describe('getRiskCategory', () => {

        it('should return "D" for scores 0-5 (Bajo Riesgo)', () => {
            expect(getRiskCategory(0)).toBe('D');
            expect(getRiskCategory(3)).toBe('D');
            expect(getRiskCategory(5)).toBe('D');
        });

        it('should return "C" for scores 6-11 (Mediano Riesgo)', () => {
            expect(getRiskCategory(6)).toBe('C');
            expect(getRiskCategory(8)).toBe('C');
            expect(getRiskCategory(11)).toBe('C');
        });

        it('should return "B" for scores 12-18 (Alto Riesgo)', () => {
            expect(getRiskCategory(12)).toBe('B');
            expect(getRiskCategory(15)).toBe('B');
            expect(getRiskCategory(18)).toBe('B');
        });

        it('should return "A" for scores 19-24 (Máximo Riesgo)', () => {
            expect(getRiskCategory(19)).toBe('A');
            expect(getRiskCategory(22)).toBe('A');
            expect(getRiskCategory(24)).toBe('A');
        });

    });

    describe('getCategoryColor', () => {

        it('should return red colors for category A', () => {
            expect(getCategoryColor('A')).toContain('red');
        });

        it('should return orange colors for category B', () => {
            expect(getCategoryColor('B')).toContain('orange');
        });

        it('should return yellow colors for category C', () => {
            expect(getCategoryColor('C')).toContain('yellow');
        });

        it('should return green colors for category D', () => {
            expect(getCategoryColor('D')).toContain('green');
        });

    });

    describe('getCategorization', () => {

        it('should return complete categorization for a patient', () => {
            const score: CudyrScore = {
                ...EMPTY_CUDYR_SCORE,
                changeClothes: 2,
                mobilization: 2,
                feeding: 2,
                elimination: 2,
                psychosocial: 2,
                surveillance: 2,
                vitalSigns: 2,
                fluidBalance: 2,
                oxygenTherapy: 2,
                airway: 2,
                proInterventions: 2,
                skinCare: 2,
                pharmacology: 2,
                invasiveElements: 2
            };

            const result = getCategorization(score);

            expect(result.depScore).toBe(12);
            expect(result.riskScore).toBe(16);
            expect(result.depCat).toBe('2');
            expect(result.riskCat).toBe('B');
            expect(result.finalCat).toBe('B2');
            expect(result.isCategorized).toBe(true);
        });

        it('should handle undefined cudyr', () => {
            const result = getCategorization(undefined);

            expect(result.depScore).toBe(0);
            expect(result.riskScore).toBe(0);
            expect(result.isCategorized).toBe(false);
        });

    });

});
