export type ClinicalEnrichmentBatchMode = 'off' | 'shadow' | 'enforced';

export const resolveClinicalEnrichmentBatchMode = (
  value: unknown = import.meta.env.VITE_RAYEN_CLINICAL_ENRICHMENT_BATCH_MODE
): ClinicalEnrichmentBatchMode => {
  switch (
    String(value || '')
      .trim()
      .toLowerCase()
  ) {
    case '':
      // The callable is an optional deployment. Keep the established path as the fail-safe
      // default so a missing function cannot block vitals, scores or devices. Enforced mode must
      // always be an explicit decision after the deployment and parity gates are green.
      return 'off';
    case 'shadow':
      return 'shadow';
    case 'enforced':
      return 'enforced';
    default:
      return 'off';
  }
};
