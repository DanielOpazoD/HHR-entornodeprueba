import type { SpecialtyCatalogRule } from '@/services/specialty/specialtyJevClient';
import { normalizeDiagnosisCode } from './specialtyRulesHistoryModel';

/** One decision per normalized diagnosis, even across repeated clicks. */
export const upsertSpecialtyRule = (
  rules: SpecialtyCatalogRule[],
  code: string,
  specialty: string
): SpecialtyCatalogRule[] => {
  const normalized = normalizeDiagnosisCode(code);
  const existing = rules.find(rule => normalizeDiagnosisCode(rule.cie10Code) === normalized);
  if (!existing && rules.length >= 128) return rules;
  const decision =
    specialty === 'review' ? { kind: 'review' as const } : { kind: 'assign' as const, specialty };
  const next: SpecialtyCatalogRule = {
    id: existing?.id ?? `clinical_${normalized.replace('.', '_')}`,
    cie10Code: normalized,
    scope: 'all',
    ...decision,
    revision: existing
      ? existing.revision +
        Number((existing.kind === 'review' ? 'review' : existing.specialty) !== specialty)
      : 1,
  };
  return [...rules.filter(rule => normalizeDiagnosisCode(rule.cie10Code) !== normalized), next];
};
