import React from 'react';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import {
  CensusMovementActionsMenu,
  type CensusMovementMenuContext,
} from '@/features/census/components/CensusMovementActionsMenu';

interface CensusMovementActionsCellProps {
  actions: CensusMovementActionDescriptor[];
  context: CensusMovementMenuContext;
  children?: React.ReactNode;
}

export const CensusMovementActionsCell: React.FC<CensusMovementActionsCellProps> = ({
  actions,
  context,
  children,
}) => {
  const actionViewModels = useCensusMovementActionsCellModel(actions);

  return (
    <td className="p-2 print:hidden align-middle">
      <div className="flex flex-wrap items-center justify-end gap-2 h-full">
        <CensusMovementActionsMenu actions={actionViewModels} context={context} />
        {children}
      </div>
    </td>
  );
};
