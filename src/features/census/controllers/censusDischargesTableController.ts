import type { DischargeData } from '@/types';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

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

export interface DischargeTimeUpdateCommand {
  id: string;
  status: DischargeData['status'];
  dischargeType: DischargeData['dischargeType'];
  dischargeTypeOther: DischargeData['dischargeTypeOther'];
  movementDate?: DischargeData['movementDate'];
  time: string;
}

export const resolveDischargeTimeUpdateCommand = (
  discharges: DischargeData[],
  dischargeId: string,
  newTime: string,
  movementDate?: string
): DischargeTimeUpdateCommand | null => {
  const discharge = discharges.find(entry => entry.id === dischargeId);
  if (!discharge) {
    return null;
  }

  return {
    id: discharge.id,
    status: discharge.status,
    dischargeType: discharge.dischargeType,
    dischargeTypeOther: discharge.dischargeTypeOther,
    movementDate: movementDate ?? discharge.movementDate,
    time: newTime,
  };
};

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
): CensusMovementActionDescriptor[] => {
  return [
    {
      kind: 'undo',
      title: 'Deshacer (Restaurar a Cama)',
      className: 'text-slate-400 hover:text-slate-600',
      onClick: () => handlers.undoDischarge(discharge.id),
    },
    {
      kind: 'edit',
      title: 'Editar',
      className: 'text-medical-500 hover:text-medical-700',
      onClick: () => handlers.editDischarge(discharge),
    },
    {
      kind: 'delete',
      title: 'Eliminar Registro',
      className: 'text-red-400 hover:text-red-600',
      onClick: () => handlers.deleteDischarge(discharge.id),
    },
  ];
};
