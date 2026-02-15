import React from 'react';

import {
  useDailyRecordActions,
  useDailyRecordData,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import {
  buildDischargeRowActions,
  DISCHARGES_TABLE_HEADERS,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';
import { resolveDischargesSectionState } from '@/features/census/controllers/censusDischargesSectionController';

// Interface for props removed as data comes from context

export const DischargesSection: React.FC = () => {
  const { record } = useDailyRecordData();
  const { discharges } = useDailyRecordMovements() || { discharges: [] };
  const { undoDischarge, deleteDischarge } = useDailyRecordActions();
  const { confirm } = useConfirmDialog();
  const { handleEditDischarge } = useCensusActionCommands();
  const sectionState = resolveDischargesSectionState(discharges);

  if (!sectionState.isRenderable) return null;

  const handleUndoDischarge = React.useCallback(
    async (id: string) => {
      const accepted = await confirm({
        title: 'Deshacer alta',
        message: 'Esta acción restaurará al paciente a su cama. ¿Deseas continuar?',
        confirmText: 'Deshacer',
        cancelText: 'Cancelar',
        variant: 'warning',
      });
      if (!accepted) {
        return;
      }
      undoDischarge(id);
    },
    [confirm, undoDischarge]
  );

  const handleDeleteDischarge = React.useCallback(
    async (id: string) => {
      const accepted = await confirm({
        title: 'Eliminar alta',
        message: 'Esta acción eliminará el registro de alta. ¿Deseas continuar?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        variant: 'danger',
      });
      if (!accepted) {
        return;
      }
      deleteDischarge(id);
    },
    [confirm, deleteDischarge]
  );

  return (
    <div className="card mt-6 animate-fade-in print:p-2 print:border-t-2 print:border-slate-800 print:shadow-none">
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-green-50 text-green-600 rounded-lg shadow-sm">
            <CheckCircle size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-tight">Altas</h2>
          </div>
        </div>
      </div>

      <div className="p-4">
        {sectionState.isEmpty ? (
          <p className="text-slate-400 italic text-sm text-center py-4">
            No hay altas registradas para este día.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm print:text-xs">
              <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                <tr>
                  {DISCHARGES_TABLE_HEADERS.map(header => (
                    <th key={header.label} className={clsx('px-3 py-2.5', header.className)}>
                      {header.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionState.discharges.map(d => (
                  <tr
                    key={d.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300"
                  >
                    <td className="p-2 font-medium text-slate-700">
                      {d.bedName} <span className="text-[10px] text-slate-400">({d.bedType})</span>
                    </td>
                    <td className="p-2 text-slate-800 font-medium">{d.patientName}</td>
                    <td className="p-2 font-mono text-xs text-slate-500">{d.rut}</td>
                    <td className="p-2 text-slate-600">{d.diagnosis}</td>
                    <td className="p-2 text-xs text-slate-500">{d.dischargeType || '-'}</td>
                    <td className="p-2">
                      <span
                        className={clsx(
                          'px-2 py-1 rounded-full text-[11px] font-bold print:border print:border-slate-400',
                          getDischargeStatusBadgeClassName(d.status)
                        )}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <CensusMovementDateTimeCell
                        recordDate={record?.date || ''}
                        movementDate={d.movementDate}
                        movementTime={d.time}
                      />
                    </td>
                    <CensusMovementActionsCell
                      actions={buildDischargeRowActions(d, {
                        undoDischarge: id => {
                          void handleUndoDischarge(id);
                        },
                        editDischarge: handleEditDischarge,
                        deleteDischarge: id => {
                          void handleDeleteDischarge(id);
                        },
                      })}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
