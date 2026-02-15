import React from 'react';
import { PatientActionMenu } from './PatientActionMenu';
import type { PatientActionMenuCallbacks, RowMenuAlign } from './patientRowContracts';

interface PatientMainRowActionCellProps extends PatientActionMenuCallbacks {
  isBlocked: boolean;
  readOnly: boolean;
  align: RowMenuAlign;
}

export const PatientMainRowActionCell: React.FC<PatientMainRowActionCellProps> = ({
  isBlocked,
  readOnly,
  align,
  onAction,
  onViewDemographics,
  onViewExamRequest,
  onViewHistory,
}) => (
  <td className="p-0 text-center border-r border-slate-200 relative w-10 print:hidden">
    <PatientActionMenu
      isBlocked={isBlocked}
      onAction={onAction}
      onViewDemographics={onViewDemographics}
      onViewExamRequest={onViewExamRequest}
      onViewHistory={onViewHistory}
      readOnly={readOnly}
      align={align}
    />
  </td>
);
