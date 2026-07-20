import type { CensusMovementActionKind } from '@/features/census/types/censusMovementActionTypes';

export type CensusMovementActionIconName =
  | 'undo'
  | 'viewDocuments'
  | 'hospitalizationReports'
  | 'edit'
  | 'delete'
  | 'convert';

export const resolveCensusMovementActionIconName = (
  kind: CensusMovementActionKind
): CensusMovementActionIconName => {
  if (kind === 'undo') return 'undo';
  if (kind === 'viewDocuments') return 'viewDocuments';
  if (kind === 'hospitalizationReports') return 'hospitalizationReports';
  if (kind === 'edit') return 'edit';
  if (kind === 'convert') return 'convert';
  return 'delete';
};
