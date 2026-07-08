import React from 'react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

interface CensusMovementDateActionsCellsProps {
  recordDate: string;
  movementDate?: string;
  movementTime?: string;
  actions: CensusMovementActionDescriptor[];
  children?: React.ReactNode;
  actionsPresentation?: 'buttons' | 'menu';
}

export const CensusMovementDateActionsCells: React.FC<CensusMovementDateActionsCellsProps> = ({
  recordDate,
  movementDate,
  movementTime,
  actions,
  children,
  actionsPresentation = 'buttons',
}) => (
  <>
    <td className="p-2 text-center align-middle">
      <CensusMovementDateTimeCell
        recordDate={recordDate}
        movementDate={movementDate}
        movementTime={movementTime}
      />
    </td>
    <CensusMovementActionsCell actions={actions} presentation={actionsPresentation}>
      {children}
    </CensusMovementActionsCell>
  </>
);
