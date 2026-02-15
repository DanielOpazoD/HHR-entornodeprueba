import React from 'react';
import clsx from 'clsx';

import {
  useDailyRecordActions,
  useDailyRecordData,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { ArrowRightLeft } from 'lucide-react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
  TRANSFERS_TABLE_HEADERS,
} from '@/features/census/controllers/censusTransfersTableController';
import { resolveTransfersSectionState } from '@/features/census/controllers/censusTransfersSectionController';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
  const { record } = useDailyRecordData();
  const { transfers } = useDailyRecordMovements() || { transfers: [] };
  const { undoTransfer, deleteTransfer } = useDailyRecordActions();
  const { confirm } = useConfirmDialog();
  const { handleEditTransfer } = useCensusActionCommands();
  const sectionState = resolveTransfersSectionState(transfers);

  if (!sectionState.isRenderable) return null;

  const handleUndoTransfer = React.useCallback(
    async (id: string) => {
      const accepted = await confirm({
        title: 'Deshacer traslado',
        message: 'Esta acción restaurará al paciente a su cama. ¿Deseas continuar?',
        confirmText: 'Deshacer',
        cancelText: 'Cancelar',
        variant: 'warning',
      });
      if (!accepted) {
        return;
      }
      undoTransfer(id);
    },
    [confirm, undoTransfer]
  );

  const handleDeleteTransfer = React.useCallback(
    async (id: string) => {
      const accepted = await confirm({
        title: 'Eliminar traslado',
        message: 'Esta acción eliminará el registro de traslado. ¿Deseas continuar?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        variant: 'danger',
      });
      if (!accepted) {
        return;
      }
      deleteTransfer(id);
    },
    [confirm, deleteTransfer]
  );

  return (
    <div className="card mt-6 animate-fade-in print:p-2 print:border-t-2 print:border-slate-800 print:shadow-none">
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shadow-sm">
            <ArrowRightLeft size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 leading-tight">Traslados</h2>
          </div>
        </div>
      </div>

      <div className="p-4">
        {sectionState.isEmpty ? (
          <p className="text-slate-400 italic text-sm text-center py-4">
            No hay traslados registrados para hoy.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm print:text-xs">
              <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                <tr>
                  {TRANSFERS_TABLE_HEADERS.map(header => (
                    <th key={header.label} className={clsx('px-3 py-2.5', header.className)}>
                      {header.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionState.transfers.map(t => {
                  const escortLabel = getTransferEscortLabel(t);

                  return (
                    <tr
                      key={t.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300"
                    >
                      <td className="p-2 font-medium text-slate-700">
                        {t.bedName}{' '}
                        <span className="text-[10px] text-slate-400">({t.bedType})</span>
                      </td>
                      <td className="p-2 text-slate-800 font-medium">{t.patientName}</td>
                      <td className="p-2 font-mono text-xs text-slate-500">{t.rut}</td>
                      <td className="p-2 text-slate-600">{t.diagnosis}</td>
                      <td className="p-2 text-slate-600">{t.evacuationMethod}</td>
                      <td className="p-2 text-slate-600">
                        <div>{getTransferCenterLabel(t)}</div>
                        {escortLabel && (
                          <div className="text-[10px] text-slate-400 mt-0.5 italic">
                            {escortLabel}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <CensusMovementDateTimeCell
                          recordDate={record?.date || ''}
                          movementDate={t.movementDate}
                          movementTime={t.time}
                        />
                      </td>
                      <CensusMovementActionsCell
                        actions={buildTransferRowActions(t, {
                          undoTransfer: id => {
                            void handleUndoTransfer(id);
                          },
                          editTransfer: handleEditTransfer,
                          deleteTransfer: id => {
                            void handleDeleteTransfer(id);
                          },
                        })}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
