import React from 'react';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import { CensusMovementActionButton } from '@/features/census/components/CensusMovementActionButton';

interface CensusMovementActionsCellProps {
  actions: CensusMovementActionDescriptor[];
}

export const CensusMovementActionsCell: React.FC<CensusMovementActionsCellProps> = ({
  actions,
}) => {
  const actionViewModels = useCensusMovementActionsCellModel(actions);

  return (
    <td className="p-2 flex justify-end gap-2 print:hidden">
      {actionViewModels.map(action => (
        <CensusMovementActionButton key={action.key} action={action} />
      ))}
    </td>
  );
};
