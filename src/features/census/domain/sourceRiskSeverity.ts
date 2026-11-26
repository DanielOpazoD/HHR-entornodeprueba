import type { BradenRiskLevel } from '@/types/domain/evaluationScores';
import { removeAccents } from '@/utils/stringUtils';

/**
 * Maps the severity classification reported by Eloísa to the three visual risk bands used by HHR.
 * The original source label remains authoritative and is displayed verbatim; this mapper only
 * selects its color family. It must not be used to derive reapplication cadence.
 */
export const parseSourceRiskLevel = (severity: string | null): BradenRiskLevel | null => {
  const value = removeAccents(severity ?? '')
    .toLowerCase()
    .trim();

  if (value.includes('alto') || value.includes('sever')) return 'alto';
  if (value.includes('medio') || value.includes('moderad')) return 'medio';
  if (value.includes('bajo') || value.includes('leve') || value.includes('sin riesgo'))
    return 'bajo';
  return null;
};

export const sourceRiskLabel = (severity: string | null, fallback: string): string =>
  severity?.trim() || fallback;
