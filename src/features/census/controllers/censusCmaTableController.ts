import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

export const CMA_TABLE_HEADERS: readonly CensusMovementTableHeader[] = [
  { label: 'Cama', className: 'w-20' },
  { label: 'Tipo Intervención', className: 'w-40' },
  { label: 'Paciente', className: 'min-w-52' },
  { label: 'Diagnóstico', className: 'min-w-[180px]' },
  { label: 'Fecha', className: 'w-28 text-center' },
  { label: 'Acciones', className: 'w-16 text-right print:hidden' },
] as const;

export const resolveCmaUndoButtonTitle = (item: Pick<CMAData, 'originalBedId'>): string =>
  item.originalBedId ? 'Deshacer: Restaurar paciente a la cama' : 'Deshacer (sin datos originales)';
