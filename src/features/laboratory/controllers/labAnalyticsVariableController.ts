import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { COMPARISON_EXCLUDE, COMPARISON_ORDER } from '../constants/labComparisonCatalogConstants';
import { TREND_GROUPS } from '../constants/labTrendConstants';

const ALL_TREND_PATTERNS = TREND_GROUPS.flatMap(g => g.patterns);

/** Check if a variable name matches any trend pattern (case-insensitive, partial). */
export const isTrendVariable = (analysis: string): boolean => {
  const lower = analysis.toLowerCase();
  return ALL_TREND_PATTERNS.some(p => lower.includes(p.toLowerCase()));
};

/** Find which trend group a variable belongs to. */
export const findTrendGroup = (analysis: string): string | null => {
  const lower = analysis.toLowerCase();
  for (const group of TREND_GROUPS) {
    if (group.patterns.some(p => lower.includes(p.toLowerCase()))) {
      return group.label;
    }
  }
  return null;
};

/**
 * Check if a variable should be excluded from the comparison table.
 * Uses partial case-insensitive matching against {@link COMPARISON_EXCLUDE}.
 */
export const isExcludedFromComparison = (analysis: string): boolean => {
  const lower = analysis.toLowerCase();
  return COMPARISON_EXCLUDE.some(e => lower.includes(e.toLowerCase()));
};

/**
 * Get the clinical priority sort index for a variable name.
 * Lower index = shown first in the comparison table.
 */
export const comparisonSortIndex = (name: string): number => {
  const lower = name.toLowerCase();
  for (let i = 0; i < COMPARISON_ORDER.length; i++) {
    if (lower.includes(COMPARISON_ORDER[i].toLowerCase())) return i;
  }
  return COMPARISON_ORDER.length + 1;
};

/**
 * Build a unique column key for each exam occurrence.
 * Uses "DD/MM/YYYY HH:MM" when time is available, otherwise "DD/MM/YYYY (#ID)".
 * Colliding orders in the same minute retain their full time and order ID.
 */
export const buildExamColumnKey = (
  exam: SyslabExamItem | undefined,
  fallbackDate: string,
  examList: SyslabExamItem[] = []
): string => {
  if (!exam) return fallbackDate;
  const date = exam.date || fallbackDate;
  const time = exam.time ? exam.time.substring(0, 5) : '';
  const collides =
    time &&
    examList.some(
      candidate =>
        candidate.id !== exam.id &&
        (candidate.date || fallbackDate) === date &&
        candidate.time?.substring(0, 5) === time
    );
  if (collides) return `${date} ${exam.time} (#${exam.id})`;
  return time ? `${date} ${time}` : `${date} (#${exam.id})`;
};
