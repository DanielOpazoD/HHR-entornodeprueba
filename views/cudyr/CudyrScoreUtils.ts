/**
 * Utility functions for CUDYR score calculations and categorization.
 */

import { CudyrScore } from '@/types';

// ============================================================================
// Empty CUDYR Score Template
// ============================================================================

export const EMPTY_CUDYR_SCORE: CudyrScore = {
    changeClothes: 0,
    mobilization: 0,
    feeding: 0,
    elimination: 0,
    psychosocial: 0,
    surveillance: 0,
    vitalSigns: 0,
    fluidBalance: 0,
    oxygenTherapy: 0,
    airway: 0,
    proInterventions: 0,
    skinCare: 0,
    pharmacology: 0,
    invasiveElements: 0
};

// ============================================================================
// Score Calculation Functions
// ============================================================================

/**
 * Calculate dependency score (sum of 6 dependency items)
 * Range: 0-18 (6 items × max 3 points each)
 */
export const getDepScore = (c: CudyrScore): number => {
    return (c.changeClothes || 0) +
        (c.mobilization || 0) +
        (c.feeding || 0) +
        (c.elimination || 0) +
        (c.psychosocial || 0) +
        (c.surveillance || 0);
};

/**
 * Calculate risk score (sum of 8 risk items)
 * Range: 0-24 (8 items × max 3 points each)
 */
export const getRiskScore = (c: CudyrScore): number => {
    return (c.vitalSigns || 0) +
        (c.fluidBalance || 0) +
        (c.oxygenTherapy || 0) +
        (c.airway || 0) +
        (c.proInterventions || 0) +
        (c.skinCare || 0) +
        (c.pharmacology || 0) +
        (c.invasiveElements || 0);
};

// ============================================================================
// Category Functions
// ============================================================================

/**
 * Get dependency category based on score
 * 1 = DEPENDENCIA TOTAL: 13-18
 * 2 = DEPENDENCIA PARCIAL: 7-12
 * 3 = AUTOSUFICIENCIA PARCIAL: 0-6
 */
export const getDepCategory = (score: number): string => {
    if (score >= 13) return '1';
    if (score >= 7) return '2';
    return '3';
};

/**
 * Get risk category based on score
 * A = MÁXIMO RIESGO: 19-24
 * B = ALTO RIESGO: 12-18
 * C = MEDIANO RIESGO: 6-11
 * D = BAJO RIESGO: 0-5
 */
export const getRiskCategory = (score: number): string => {
    if (score >= 19) return 'A';
    if (score >= 12) return 'B';
    if (score >= 6) return 'C';
    return 'D';
};

/**
 * Get color classes for risk category badge
 */
export const getCategoryColor = (riskCat: string): string => {
    switch (riskCat) {
        case 'A': return 'bg-red-600 text-white';
        case 'B': return 'bg-orange-500 text-white';
        case 'C': return 'bg-yellow-400 text-slate-900';
        case 'D': return 'bg-green-600 text-white';
        default: return 'bg-slate-200';
    }
};

/**
 * Calculate full categorization for a patient
 */
export const getCategorization = (cudyr: CudyrScore | undefined) => {
    const c = cudyr || EMPTY_CUDYR_SCORE;
    const depScore = getDepScore(c);
    const riskScore = getRiskScore(c);
    const depCat = getDepCategory(depScore);
    const riskCat = getRiskCategory(riskScore);
    const finalCat = `${riskCat}${depCat}`;
    const badgeColor = getCategoryColor(riskCat);
    const isCategorized = depScore > 0 || riskScore > 0;

    return {
        depScore,
        riskScore,
        depCat,
        riskCat,
        finalCat,
        badgeColor,
        isCategorized
    };
};
