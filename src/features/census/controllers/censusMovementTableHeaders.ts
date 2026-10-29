import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

export const buildCensusMovementTableHeaders = (
  detailLabels: readonly [string, string]
): readonly CensusMovementTableHeader[] => [
  { label: 'Cama', className: 'w-16' },
  { label: 'Paciente', className: 'w-[24%]' },
  { label: 'Diagnóstico' },
  ...detailLabels.map(label => ({ label, className: 'w-[12%]' })),
  { label: 'Fecha', className: 'w-32 text-center' },
  { label: 'Acciones', className: 'w-40 text-right print:hidden' },
];
