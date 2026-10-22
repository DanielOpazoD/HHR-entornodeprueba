/**
 * @fileoverview Validation tests for the laboratory comparison and trend catalogs.
 * Ensures no duplicates, no overlap between exclude/order, and trend groups integrity.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARISON_EXCLUDE,
  COMPARISON_ORDER,
} from '@/features/laboratory/constants/labComparisonCatalogConstants';
import { TREND_GROUPS } from '@/features/laboratory/constants/labTrendConstants';

describe('labConstants integrity', () => {
  it('COMPARISON_EXCLUDE has no duplicates', () => {
    const set = new Set(COMPARISON_EXCLUDE);
    expect(set.size).toBe(COMPARISON_EXCLUDE.length);
  });

  it('COMPARISON_ORDER has no duplicates', () => {
    const set = new Set(COMPARISON_ORDER);
    expect(set.size).toBe(COMPARISON_ORDER.length);
  });

  it('no overlap between COMPARISON_EXCLUDE and COMPARISON_ORDER', () => {
    const excludeSet = new Set(COMPARISON_EXCLUDE.map(e => e.toLowerCase()));
    const overlap = COMPARISON_ORDER.filter(o => excludeSet.has(o.toLowerCase()));
    expect(overlap).toEqual([]);
  });

  it('all TREND_GROUPS have unique labels', () => {
    const labels = TREND_GROUPS.map(g => g.label);
    const set = new Set(labels);
    expect(set.size).toBe(labels.length);
  });

  it('all TREND_GROUPS have non-empty patterns', () => {
    for (const group of TREND_GROUPS) {
      expect(group.patterns.length).toBeGreaterThan(0);
    }
  });
});
