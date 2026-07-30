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
      return 'enforced';
    case 'shadow':
      return 'shadow';
    case 'enforced':
      return 'enforced';
    default:
      return 'off';
  }
};
