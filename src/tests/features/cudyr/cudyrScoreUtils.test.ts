// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CudyrScore } from '@/types/domain/cudyr';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  getDepScore,
  getRiskScore,
  getDepCategory,
  getRiskCategory,
  getCategoryColor,
  getCategorization,
  EMPTY_CUDYR_SCORE,
} from '@/services/cudyr/CudyrScoreUtils';

/* ================================================================== */
/*  CUDYR Score Utilities                                              */
/* ================================================================== */

describe('CudyrScoreUtils', () => {
  describe('EMPTY_CUDYR_SCORE', () => {
    it('has all 14 fields set to 0', () => {
      const keys = Object.keys(EMPTY_CUDYR_SCORE);
      expect(keys).toHaveLength(14);
      keys.forEach(key => {
        expect(EMPTY_CUDYR_SCORE[key as keyof CudyrScore]).toBe(0);
      });
    });
  });

  describe('getDepScore', () => {
    it('sums the 6 dependency items', () => {
      const score = DataFactory.createMockCudyr({
        changeClothes: 1,
        mobilization: 2,
        feeding: 3,
        elimination: 1,
        psychosocial: 2,
        surveillance: 3,
      });
      expect(getDepScore(score)).toBe(12);
    });

    it('returns 0 for empty scores', () => {
      expect(getDepScore(EMPTY_CUDYR_SCORE)).toBe(0);
    });

    it('handles max dependency scores (all 3s)', () => {
      const score = DataFactory.createMockCudyr({
        changeClothes: 3,
        mobilization: 3,
        feeding: 3,
        elimination: 3,
        psychosocial: 3,
        surveillance: 3,
      });
      expect(getDepScore(score)).toBe(18);
    });

    it('ignores risk fields in dependency calculation', () => {
      const score = DataFactory.createMockCudyr({
        changeClothes: 1,
        vitalSigns: 3,
        fluidBalance: 3,
        pharmacology: 3,
      });
      expect(getDepScore(score)).toBe(1);
    });
  });

  describe('getRiskScore', () => {
    it('sums the 8 risk items', () => {
      const score = DataFactory.createMockCudyr({
        vitalSigns: 1,
        fluidBalance: 2,
        oxygenTherapy: 3,
        airway: 1,
        proInterventions: 2,
        skinCare: 3,
        pharmacology: 1,
        invasiveElements: 2,
      });
      expect(getRiskScore(score)).toBe(15);
    });

    it('returns 0 for empty scores', () => {
      expect(getRiskScore(EMPTY_CUDYR_SCORE)).toBe(0);
    });

    it('handles max risk scores (all 3s = 24)', () => {
      const score = DataFactory.createMockCudyr({
        vitalSigns: 3,
        fluidBalance: 3,
        oxygenTherapy: 3,
        airway: 3,
        proInterventions: 3,
        skinCare: 3,
        pharmacology: 3,
        invasiveElements: 3,
      });
      expect(getRiskScore(score)).toBe(24);
    });

    it('ignores dependency fields in risk calculation', () => {
      const score = DataFactory.createMockCudyr({
        changeClothes: 3,
        mobilization: 3,
        feeding: 3,
        vitalSigns: 2,
      });
      expect(getRiskScore(score)).toBe(2);
    });
  });

  describe('getDepCategory', () => {
    it('returns "1" (DEPENDENCIA TOTAL) for scores 13-18', () => {
      expect(getDepCategory(13)).toBe('1');
      expect(getDepCategory(15)).toBe('1');
      expect(getDepCategory(18)).toBe('1');
    });

    it('returns "2" (DEPENDENCIA PARCIAL) for scores 7-12', () => {
      expect(getDepCategory(7)).toBe('2');
      expect(getDepCategory(10)).toBe('2');
      expect(getDepCategory(12)).toBe('2');
    });

    it('returns "3" (AUTOSUFICIENCIA PARCIAL) for scores 0-6', () => {
      expect(getDepCategory(0)).toBe('3');
      expect(getDepCategory(3)).toBe('3');
      expect(getDepCategory(6)).toBe('3');
    });
  });

  describe('getRiskCategory', () => {
    it('returns "A" (MAXIMO RIESGO) for scores 19-24', () => {
      expect(getRiskCategory(19)).toBe('A');
      expect(getRiskCategory(22)).toBe('A');
      expect(getRiskCategory(24)).toBe('A');
    });

    it('returns "B" (ALTO RIESGO) for scores 12-18', () => {
      expect(getRiskCategory(12)).toBe('B');
      expect(getRiskCategory(15)).toBe('B');
      expect(getRiskCategory(18)).toBe('B');
    });

    it('returns "C" (MEDIANO RIESGO) for scores 6-11', () => {
      expect(getRiskCategory(6)).toBe('C');
      expect(getRiskCategory(9)).toBe('C');
      expect(getRiskCategory(11)).toBe('C');
    });

    it('returns "D" (BAJO RIESGO) for scores 0-5', () => {
      expect(getRiskCategory(0)).toBe('D');
      expect(getRiskCategory(3)).toBe('D');
      expect(getRiskCategory(5)).toBe('D');
    });
  });

  describe('getCategoryColor', () => {
    it('returns red for category A', () => {
      expect(getCategoryColor('A')).toContain('red');
    });

    it('returns orange for category B', () => {
      expect(getCategoryColor('B')).toContain('orange');
    });

    it('returns yellow for category C', () => {
      expect(getCategoryColor('C')).toContain('yellow');
    });

    it('returns green for category D', () => {
      expect(getCategoryColor('D')).toContain('green');
    });

    it('returns slate fallback for unknown category', () => {
      expect(getCategoryColor('X')).toContain('slate');
    });
  });

  describe('getCategorization', () => {
    it('returns empty finalCat for an uncategorized patient (all zeros)', () => {
      const result = getCategorization(EMPTY_CUDYR_SCORE);
      expect(result.isCategorized).toBe(false);
      expect(result.finalCat).toBe('');
      expect(result.badgeColor).toContain('slate');
    });

    it('returns correct categorization for a high-risk high-dependency patient', () => {
      const score = DataFactory.createMockCudyr({
        changeClothes: 3,
        mobilization: 3,
        feeding: 3,
        elimination: 3,
        psychosocial: 3,
        surveillance: 3,
        vitalSigns: 3,
        fluidBalance: 3,
        oxygenTherapy: 3,
        airway: 3,
        proInterventions: 3,
        skinCare: 3,
        pharmacology: 3,
        invasiveElements: 3,
      });
      const result = getCategorization(score);
      expect(result.depScore).toBe(18);
      expect(result.riskScore).toBe(24);
      expect(result.depCat).toBe('1');
      expect(result.riskCat).toBe('A');
      expect(result.finalCat).toBe('A1');
      expect(result.isCategorized).toBe(true);
    });

    it('returns D3 for minimal non-zero scores', () => {
      const score = DataFactory.createMockCudyr({ changeClothes: 1 });
      const result = getCategorization(score);
      expect(result.finalCat).toBe('D3');
      expect(result.depScore).toBe(1);
      expect(result.riskScore).toBe(0);
      expect(result.isCategorized).toBe(true);
    });

    it('returns correct category for mid-range scores (B2)', () => {
      // depScore 7-12 = cat 2, riskScore 12-18 = cat B
      const score = DataFactory.createMockCudyr({
        changeClothes: 2,
        mobilization: 2,
        feeding: 2,
        elimination: 1,
        vitalSigns: 2,
        fluidBalance: 2,
        oxygenTherapy: 2,
        airway: 2,
        proInterventions: 2,
        skinCare: 2,
      });
      const result = getCategorization(score);
      expect(result.depCat).toBe('2');
      expect(result.riskCat).toBe('B');
      expect(result.finalCat).toBe('B2');
    });

    it('handles undefined cudyr (treats as empty)', () => {
      const result = getCategorization(undefined);
      expect(result.isCategorized).toBe(false);
      expect(result.finalCat).toBe('');
    });

    it('marks as categorized when only risk scores are non-zero', () => {
      const score = DataFactory.createMockCudyr({ vitalSigns: 1 });
      const result = getCategorization(score);
      expect(result.isCategorized).toBe(true);
      expect(result.riskScore).toBe(1);
      expect(result.depScore).toBe(0);
    });
  });
});

/* ================================================================== */
/*  DataFactory.createMockCudyr                                        */
/* ================================================================== */

describe('DataFactory.createMockCudyr', () => {
  it('creates a CUDYR score with all zeros by default', () => {
    const score = DataFactory.createMockCudyr();
    Object.values(score).forEach(v => expect(v).toBe(0));
  });

  it('applies partial overrides', () => {
    const score = DataFactory.createMockCudyr({ changeClothes: 3, pharmacology: 2 });
    expect(score.changeClothes).toBe(3);
    expect(score.pharmacology).toBe(2);
    expect(score.mobilization).toBe(0);
  });

  it('overrides are type-safe against CudyrScore interface', () => {
    const score = DataFactory.createMockCudyr({
      vitalSigns: 1,
      fluidBalance: 2,
    });
    expect(score.vitalSigns).toBe(1);
    expect(score.fluidBalance).toBe(2);
  });
});

/* ================================================================== */
/*  Edge case: boundary values for category thresholds                 */
/* ================================================================== */

describe('CUDYR category boundary values', () => {
  it('dep score 6 -> cat 3, score 7 -> cat 2', () => {
    expect(getDepCategory(6)).toBe('3');
    expect(getDepCategory(7)).toBe('2');
  });

  it('dep score 12 -> cat 2, score 13 -> cat 1', () => {
    expect(getDepCategory(12)).toBe('2');
    expect(getDepCategory(13)).toBe('1');
  });

  it('risk score 5 -> cat D, score 6 -> cat C', () => {
    expect(getRiskCategory(5)).toBe('D');
    expect(getRiskCategory(6)).toBe('C');
  });

  it('risk score 11 -> cat C, score 12 -> cat B', () => {
    expect(getRiskCategory(11)).toBe('C');
    expect(getRiskCategory(12)).toBe('B');
  });

  it('risk score 18 -> cat B, score 19 -> cat A', () => {
    expect(getRiskCategory(18)).toBe('B');
    expect(getRiskCategory(19)).toBe('A');
  });
});
