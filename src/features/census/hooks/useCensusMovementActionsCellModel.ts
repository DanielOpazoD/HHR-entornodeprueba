import { useMemo } from 'react';
import {
  resolveCensusMovementActionIconName,
  type CensusMovementActionIconName,
} from '@/features/census/controllers/censusMovementActionIconController';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

export interface CensusMovementActionViewModel extends CensusMovementActionDescriptor {
  key: string;
  iconName: CensusMovementActionIconName;
}

export const useCensusMovementActionsCellModel = (
  actions: CensusMovementActionDescriptor[]
): CensusMovementActionViewModel[] =>
  useMemo(
    () =>
      actions.map((action, index) => ({
        ...action,
        key: `${action.kind}-${index}`,
        iconName: resolveCensusMovementActionIconName(action.kind),
      })),
    [actions]
  );
