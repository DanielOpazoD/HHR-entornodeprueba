import React from 'react';
import { Trash2, Undo2 } from 'lucide-react';

import type { CMAData } from '@/types';
import { CMA_INTERVENTION_TYPES } from '@/features/census/controllers/censusCmaController';
import { resolveCmaUndoButtonTitle } from '@/features/census/controllers/censusCmaTableController';

interface CmaSectionRowProps {
  item: CMAData;
  onUpdate: (id: string, field: keyof CMAData, value: CMAData[keyof CMAData]) => void;
  onUndo: (item: CMAData) => Promise<void>;
  onDelete: (id: string) => void;
}

export const CmaSectionRow: React.FC<CmaSectionRowProps> = React.memo(
  ({ item, onUpdate, onUndo, onDelete }) => (
    <tr className="hover:bg-slate-50 group border-b border-slate-100 last:border-0">
      <td className="p-2">
        <span className="text-xs font-medium text-slate-700">{item.bedName || '-'}</span>
      </td>
      <td className="p-2">
        <select
          className="w-full p-1 border border-slate-200 hover:border-slate-300 rounded focus:border-orange-400 focus:ring-1 focus:ring-orange-400 text-xs text-slate-600 bg-white transition-colors"
          value={item.interventionType || 'Cirugía Mayor Ambulatoria'}
          onChange={event => onUpdate(item.id, 'interventionType', event.target.value)}
        >
          {CMA_INTERVENTION_TYPES.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2">
        <span className="text-[13px] font-medium text-slate-800">{item.patientName || '-'}</span>
      </td>
      <td className="p-2">
        <span className="text-[11px] font-mono text-slate-500">{item.rut || '-'}</span>
      </td>
      <td className="p-2 text-center">
        <span className="text-[11px] text-slate-400">{item.age || '-'}</span>
      </td>
      <td className="p-2">
        <span className="text-[12px] text-slate-600">{item.diagnosis || '-'}</span>
      </td>
      <td className="p-2">
        <span className="text-xs text-slate-600">{item.specialty || '-'}</span>
      </td>
      <td className="p-2 text-center">
        <input
          type="time"
          step="300"
          className="text-xs font-medium text-slate-600 bg-green-50 px-2 py-1 rounded border border-green-200 w-20 text-center"
          value={item.dischargeTime || ''}
          onChange={event => onUpdate(item.id, 'dischargeTime', event.target.value)}
        />
      </td>
      <td className="p-2 text-right print:hidden">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => void onUndo(item)}
            className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title={resolveCmaUndoButtonTitle(item)}
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Eliminar registro"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
);

CmaSectionRow.displayName = 'CmaSectionRow';
