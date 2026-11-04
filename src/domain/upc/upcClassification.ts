/**
 * Pure classification logic for UPC (Unidad de Paciente Crítico).
 *
 * Algorithm (protocol §8):
 *  1. Any UCI criterion present → UPC-UCI
 *  2. Any UTI criterion present (without UCI) → UPC-UTI
 *  3. Otherwise → null (No UPC, the implicit default)
 */

export type UpcClassification = 'UPC_UCI' | 'UPC_UTI' | null;

export interface UpcChecklist {
  readonly uciCriteria: ReadonlySet<string> | readonly string[];
  readonly utiCriteria: ReadonlySet<string> | readonly string[];
}

const hasAny = (criteria: ReadonlySet<string> | readonly string[]): boolean =>
  'size' in criteria ? criteria.size > 0 : criteria.length > 0;

export const resolveUpcClassification = (checklist: UpcChecklist): UpcClassification => {
  if (hasAny(checklist.uciCriteria)) return 'UPC_UCI';
  if (hasAny(checklist.utiCriteria)) return 'UPC_UTI';
  return null;
};

export const resolveUpcClassificationLabel = (classification: UpcClassification): string => {
  switch (classification) {
    case 'UPC_UCI':
      return 'UCI';
    case 'UPC_UTI':
      return 'UTI';
    default:
      return '';
  }
};
