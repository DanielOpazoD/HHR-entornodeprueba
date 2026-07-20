import React from 'react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import type { MovementProvenance } from '@/types/domain/movements';
import { MovementProvenanceBadge } from '@/features/census/components/MovementProvenanceBadge';
import { StatisticalDischargeProvenanceBadge } from '@/features/census/components/StatisticalDischargeProvenanceBadge';

interface StatisticalDischargeReportAction {
  clinicalEpisodeId: string;
  patientName: string;
}

interface CensusMovementDateActionsCellsProps {
  recordDate: string;
  movementDate?: string;
  movementTime?: string;
  movementProvenance?: MovementProvenance;
  statisticalDischargeReport?: StatisticalDischargeReportAction;
  actions: CensusMovementActionDescriptor[];
  children?: React.ReactNode;
  actionsPresentation?: 'buttons' | 'menu';
}

export const CensusMovementDateActionsCells: React.FC<CensusMovementDateActionsCellsProps> = ({
  recordDate,
  movementDate,
  movementTime,
  movementProvenance,
  statisticalDischargeReport,
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
      {movementProvenance && statisticalDischargeReport ? (
        <StatisticalDischargeProvenanceBadge
          provenance={movementProvenance}
          clinicalEpisodeId={statisticalDischargeReport.clinicalEpisodeId}
          patientName={statisticalDischargeReport.patientName}
        />
      ) : (
        <MovementProvenanceBadge provenance={movementProvenance} />
      )}
    </td>
    <CensusMovementActionsCell actions={actions} presentation={actionsPresentation}>
      {children}
    </CensusMovementActionsCell>
  </>
);
