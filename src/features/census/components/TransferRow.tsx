import React from 'react';

import type { TransferData } from '@/types';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
} from '@/features/census/controllers/censusTransfersTableController';

interface TransferRowProps {
  item: TransferData;
  recordDate: string;
  onUndo: (id: string) => Promise<void>;
  onEdit: (item: TransferData) => void;
  onDelete: (id: string) => Promise<void>;
}

export const TransferRow: React.FC<TransferRowProps> = React.memo(
  ({ item, recordDate, onUndo, onEdit, onDelete }) => {
    const escortLabel = getTransferEscortLabel(item);

    return (
      <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
        <td className="p-2 font-medium text-slate-700">
          {item.bedName} <span className="text-[10px] text-slate-400">({item.bedType})</span>
        </td>
        <td className="p-2 text-slate-800 font-medium">{item.patientName}</td>
        <td className="p-2 font-mono text-xs text-slate-500">{item.rut}</td>
        <td className="p-2 text-slate-600">{item.diagnosis}</td>
        <td className="p-2 text-slate-600">{item.evacuationMethod}</td>
        <td className="p-2 text-slate-600">
          <div>{getTransferCenterLabel(item)}</div>
          {escortLabel && (
            <div className="text-[10px] text-slate-400 mt-0.5 italic">{escortLabel}</div>
          )}
        </td>
        <td className="p-2 text-center">
          <CensusMovementDateTimeCell
            recordDate={recordDate}
            movementDate={item.movementDate}
            movementTime={item.time}
          />
        </td>
        <CensusMovementActionsCell
          actions={buildTransferRowActions(item, {
            undoTransfer: onUndo,
            editTransfer: onEdit,
            deleteTransfer: onDelete,
          })}
        />
      </tr>
    );
  }
);

TransferRow.displayName = 'TransferRow';
