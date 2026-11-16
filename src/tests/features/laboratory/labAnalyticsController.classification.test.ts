// @vitest-environment node
import './labAnalyticsController.testSupport';

import { describe, expect, it } from 'vitest';
import {
  buildExamColumnKey,
  comparisonSortIndex,
  isExcludedFromComparison,
  isTrendVariable,
} from '@/features/laboratory/controllers/labAnalyticsController';
import { buildExam } from './labAnalyticsController.testSupport';

describe('labAnalyticsController classification helpers', () => {
  describe('isTrendVariable', () => {
    it('returns true for Hemoglobina', () => {
      expect(isTrendVariable('Hemoglobina')).toBe(true);
    });

    it('returns true for ASAT/GOT', () => {
      expect(isTrendVariable('ASAT/GOT')).toBe(true);
    });

    it('returns false for unknown values', () => {
      expect(isTrendVariable('FooBar')).toBe(false);
    });
  });

  describe('isExcludedFromComparison', () => {
    it('returns true for Baciliformes', () => {
      expect(isExcludedFromComparison('Baciliformes')).toBe(true);
    });

    it('does not partially match Proteina C Reactiva', () => {
      expect(isExcludedFromComparison('Proteina C Reactiva')).toBe(false);
    });

    it('returns true for VLDL', () => {
      expect(isExcludedFromComparison('VLDL')).toBe(true);
    });
  });

  describe('comparisonSortIndex', () => {
    it('orders Hemoglobina before Creatinina', () => {
      expect(comparisonSortIndex('Hemoglobina')).toBeLessThan(comparisonSortIndex('Creatinina'));
    });

    it('orders Creatinina before ASAT/GOT', () => {
      expect(comparisonSortIndex('Creatinina')).toBeLessThan(comparisonSortIndex('ASAT/GOT'));
    });

    it('sends unknown variables after known ones', () => {
      const unknown = comparisonSortIndex('UnknownVariable');
      const known = comparisonSortIndex('Hemoglobina');
      expect(unknown).toBeGreaterThan(known);
    });
  });

  describe('buildExamColumnKey', () => {
    it('uses date and time when time is available', () => {
      expect(
        buildExamColumnKey(
          buildExam({
            id: '123',
            date: '06/04/2026',
            time: '13:08:43',
          }),
          '06/04/2026'
        )
      ).toBe('06/04/2026 13:08');
    });

    it('falls back to date plus id when time is missing', () => {
      expect(
        buildExamColumnKey(
          buildExam({
            id: '456',
            date: '06/04/2026',
            time: '',
          }),
          '06/04/2026'
        )
      ).toBe('06/04/2026 (#456)');
    });

    it('returns fallbackDate when exam is undefined', () => {
      expect(buildExamColumnKey(undefined, '01/01/2026')).toBe('01/01/2026');
    });
  });
});
