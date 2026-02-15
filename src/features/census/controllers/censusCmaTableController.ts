import type { CMAData } from '@/types';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

export const CMA_TABLE_HEADERS: readonly CensusMovementTableHeader[] = [
  { label: 'Cama', className: 'w-20' },
  { label: 'Tipo Intervención', className: 'w-40' },
  { label: 'Paciente', className: 'w-48' },
  { label: 'RUT', className: 'w-32' },
  { label: 'Edad', className: 'w-14 text-center' },
  { label: 'Diagnóstico', className: 'min-w-[180px]' },
  { label: 'Especialidad', className: 'w-28' },
  { label: 'Hora Alta', className: 'w-20 text-center' },
  { label: 'Acciones', className: 'w-16 text-right print:hidden' },
] as const;

export const resolveCmaUndoButtonTitle = (item: Pick<CMAData, 'originalBedId'>): string =>
  item.originalBedId ? 'Deshacer: Restaurar paciente a la cama' : 'Deshacer (sin datos originales)';
