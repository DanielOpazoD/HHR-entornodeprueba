import React from 'react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

interface CensusMovementDateActionsCellsProps {
  recordDate: string;
  movementDate?: string;
  movementTime?: string;
  actions: CensusMovementActionDescriptor[];
}

export const CensusMovementDateActionsCells: React.FC<CensusMovementDateActionsCellsProps> = ({
  recordDate,
  movementDate,
  movementTime,
  actions,
}) => (
  <>
    <td className="p-2 text-center">
      <CensusMovementDateTimeCell
        recordDate={recordDate}
        movementDate={movementDate}
        movementTime={movementTime}
      />
    </td>
    <CensusMovementActionsCell actions={actions} />
  </>
);
