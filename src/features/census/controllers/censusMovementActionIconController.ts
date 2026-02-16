import type { CensusMovementActionKind } from '@/features/census/types/censusMovementActionTypes';

export type CensusMovementActionIconName = 'undo' | 'edit' | 'delete';

export const resolveCensusMovementActionIconName = (
  kind: CensusMovementActionKind
): CensusMovementActionIconName => {
  if (kind === 'undo') return 'undo';
  if (kind === 'edit') return 'edit';
  return 'delete';
};
