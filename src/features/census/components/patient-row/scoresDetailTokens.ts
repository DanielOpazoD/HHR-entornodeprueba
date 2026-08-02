/**
 * Shared visual tokens + tiny formatters for the census "Scores" detail modal, factored out so the
 * summary cards (`ScoresDetailCards`) and the modal body (`ScoresDetailModal`) share one palette
 * without a circular import. Risk-level → colors is reused across chips, big numbers, left accents
 * and timeline dots.
 */

import type { BradenRiskLevel } from '@/types/domain/evaluationScores';
import { parseSourceRiskLevel } from '@/domain/evaluationScales/sourceRiskSeverity';

/** One risk-level's palette, reused across chips, big numbers, accents and timeline dots. */
export interface LevelTokens {
  chip: string;
  accent: string;
  number: string;
  dot: string;
  soft: string;
  label: string;
}

export const LEVEL_TOKENS: Record<BradenRiskLevel, LevelTokens> = {
  bajo: {
    chip: 'bg-emerald-100 text-emerald-800',
    accent: 'border-l-emerald-400',
    number: 'text-emerald-700',
    dot: 'bg-emerald-500',
    soft: 'bg-emerald-50 text-emerald-700',
    label: 'Riesgo bajo',
  },
  medio: {
    chip: 'bg-amber-100 text-amber-800',
    accent: 'border-l-amber-400',
    number: 'text-amber-700',
    dot: 'bg-amber-500',
    soft: 'bg-amber-50 text-amber-700',
    label: 'Riesgo medio',
  },
  alto: {
    chip: 'bg-red-100 text-red-800',
    accent: 'border-l-red-400',
    number: 'text-red-700',
    dot: 'bg-red-500',
    soft: 'bg-red-50 text-red-700',
    label: 'Riesgo alto',
  },
};

export const NEUTRAL_TOKENS: LevelTokens = {
  chip: 'bg-slate-100 text-slate-600',
  accent: 'border-l-slate-300',
  number: 'text-slate-700',
  dot: 'bg-slate-400',
  soft: 'bg-slate-50 text-slate-600',
  label: 'Sin interpretación',
};

// CUDYR category band → color (A highest acuity → D lowest), matching the census cell chip.
export const CUDYR_BAND: Record<
  'A' | 'B' | 'C' | 'D',
  { chip: string; accent: string; number: string }
> = {
  A: { chip: 'bg-rose-100 text-rose-800', accent: 'border-l-rose-400', number: 'text-rose-700' },
  B: {
    chip: 'bg-amber-100 text-amber-800',
    accent: 'border-l-amber-400',
    number: 'text-amber-700',
  },
  C: { chip: 'bg-sky-100 text-sky-800', accent: 'border-l-sky-400', number: 'text-sky-700' },
  D: {
    chip: 'bg-emerald-100 text-emerald-800',
    accent: 'border-l-emerald-400',
    number: 'text-emerald-700',
  },
};

export const tokensFor = (level: BradenRiskLevel | null): LevelTokens =>
  level ? LEVEL_TOKENS[level] : NEUTRAL_TOKENS;

export const formatIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  return year && month && day ? `${day}-${month}-${year}` : isoDay;
};

/** Derive a risk level from a source severity text ("Riesgo alto" → 'alto') for history coloring. */
export const severityLevel = parseSourceRiskLevel;
