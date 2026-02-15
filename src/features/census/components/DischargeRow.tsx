import React from 'react';
import clsx from 'clsx';

import type { DischargeData } from '@/types';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import {
  buildDischargeRowActions,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';

interface DischargeRowProps {
  item: DischargeData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: DischargeData) => void;
  onDelete: (id: string) => Promise<void>;
}

export const DischargeRow: React.FC<DischargeRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onDelete }) => (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
      <td className="p-2 font-medium text-slate-700">
        {item.bedName} <span className="text-[10px] text-slate-400">({item.bedType})</span>
      </td>
      <td className="p-2 text-slate-800 font-medium">{item.patientName}</td>
      <td className="p-2 font-mono text-xs text-slate-500">{item.rut}</td>
      <td className="p-2 text-slate-600">{item.diagnosis}</td>
      <td className="p-2 text-xs text-slate-500">{item.dischargeType || '-'}</td>
      <td className="p-2">
        <span
          className={clsx(
            'px-2 py-1 rounded-full text-[11px] font-bold print:border print:border-slate-400',
            getDischargeStatusBadgeClassName(item.status)
          )}
        >
          {item.status}
        </span>
      </td>
      <td className="p-2 text-center">
        <CensusMovementDateTimeCell
          recordDate={recordDate}
          movementDate={item.movementDate}
          movementTime={item.time}
        />
      </td>
      <CensusMovementActionsCell
        actions={buildDischargeRowActions(item, {
          undoDischarge: onUndo,
          editDischarge: onEdit,
          deleteDischarge: onDelete,
        })}
      />
    </tr>
  )
);

DischargeRow.displayName = 'DischargeRow';
