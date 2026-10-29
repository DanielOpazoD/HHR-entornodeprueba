import { useMemo } from 'react';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

export interface CensusMovementActionViewModel extends CensusMovementActionDescriptor {
  key: string;
}

export const useCensusMovementActionsCellModel = (
  actions: CensusMovementActionDescriptor[]
): CensusMovementActionViewModel[] =>
  useMemo(
    () =>
      actions.map((action, index) => ({
        ...action,
        key: `${action.kind}-${index}`,
      })),
    [actions]
  );
