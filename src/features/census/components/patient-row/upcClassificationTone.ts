import type { UpcClassification } from '@/domain/upc/upcClassification';

/**
 * The one UPC tone of the census (cell, checklist, history and classification window): UCI red,
 * UTI amber, no classification neutral. Presentation, so it lives with the census, not the domain.
 */
export const resolveUpcBadgeColor = (
  classification: UpcClassification
): { text: string; bg: string; border: string; ring: string } => {
  switch (classification) {
    case 'UPC_UCI':
      return {
        text: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        ring: 'ring-red-200',
      };
    case 'UPC_UTI':
      return {
        text: 'text-amber-700',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        ring: 'ring-amber-200',
      };
    default:
      return {
        text: 'text-slate-400',
        bg: 'bg-transparent',
        border: 'border-transparent',
        ring: 'ring-slate-200',
      };
  }
};
