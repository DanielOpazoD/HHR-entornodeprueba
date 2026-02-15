import type { DischargeData } from '@/types';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';
import { buildMovementRowActions } from '@/features/census/controllers/censusMovementRowActionsController';

export const DISCHARGES_TABLE_HEADERS: readonly CensusMovementTableHeader[] = [
  { label: 'Cama Origen' },
  { label: 'Paciente' },
  { label: 'RUT / ID' },
  { label: 'Diagnóstico' },
  { label: 'Tipo Alta' },
  { label: 'Estado' },
  { label: 'Fecha / Hora Alta', className: 'text-center' },
  { label: 'Acciones', className: 'text-right print:hidden' },
] as const;

export const getDischargeStatusBadgeClassName = (status: DischargeData['status']): string => {
  return status === 'Fallecido' ? 'bg-black text-white' : 'bg-green-100 text-green-700';
};

interface DischargeRowActionHandlers {
  undoDischarge: (id: string) => void;
  editDischarge: (discharge: DischargeData) => void;
  deleteDischarge: (id: string) => void;
}

export const buildDischargeRowActions = (
  discharge: DischargeData,
  handlers: DischargeRowActionHandlers
) =>
  buildMovementRowActions(discharge, {
    onUndo: handlers.undoDischarge,
    onEdit: handlers.editDischarge,
    onDelete: handlers.deleteDischarge,
  });
