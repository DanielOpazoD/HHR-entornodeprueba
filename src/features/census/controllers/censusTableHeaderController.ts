import type { TableColumnConfig } from '@/context/TableConfigContext';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isVisibleCensusColumn } from '@/features/census/controllers/censusTableColumnProfileController';

export type CensusHeaderColumnKey = Exclude<keyof TableColumnConfig, 'actions'>;

export interface CensusHeaderColumnDefinition {
  key: CensusHeaderColumnKey;
  label: string;
  title?: string;
  className?: string;
}

export interface CensusHeaderCellModel {
  key: CensusHeaderColumnKey;
  kind: 'diagnosis' | 'standard';
  label: string;
  title?: string;
  className?: string;
}

/**
 * Rediseño censo 2026: las columnas RUT y Edad se integran a la columna única
 * "Paciente" (PatientIdentityCell) y la columna C.QX queda oculta sin borrar el
 * campo surgicalComplication. Para reactivar C.QX, restaurar la entrada:
 *   { key: 'cqx', label: 'C.QX', title: 'Comp. Quirurgica' },
 * y quitar 'cqx' de HIDDEN_CENSUS_COLUMNS.
 */
export const CENSUS_HEADER_COLUMNS: readonly CensusHeaderColumnDefinition[] = [
  { key: 'bed', label: 'Cama' },
  { key: 'type', label: 'Tipo' },
  { key: 'name', label: 'Paciente' },
  { key: 'diagnosis', label: 'Diagnóstico' },
  { key: 'specialty', label: 'Esp' },
  { key: 'status', label: 'Estado' },
  // La columna `admission` se reutiliza para Signos Vitales (rediseño "centro de vigilancia" 2026);
  // la fecha de ingreso vive junto al RUT en la celda Paciente. La clave se mantiene por compatibilidad.
  { key: 'admission', label: 'Signos', title: 'Signos vitales (PA · FC · SatO₂ · T°)' },
  { key: 'dmi', label: 'DMI', title: 'Dispositivos médicos invasivos' },
  { key: 'scores', label: 'Scores', title: 'Escalas de enfermería (Braden UPP · Downton caídas)' },
  { key: 'upc', label: 'UPC', className: 'border-r-0' },
] as const;

export const resolveVisibleHeaderColumns = (
  columns: readonly CensusHeaderColumnDefinition[] = CENSUS_HEADER_COLUMNS,
  accessProfile: CensusAccessProfile = 'default'
): CensusHeaderColumnDefinition[] =>
  columns.filter(column => isVisibleCensusColumn(column.key, accessProfile));

const buildCensusHeaderCellModel = (
  column: CensusHeaderColumnDefinition
): CensusHeaderCellModel => ({
  key: column.key,
  kind: column.key === 'diagnosis' ? 'diagnosis' : 'standard',
  label: column.label,
  title: column.title,
  className: column.className,
});

export const buildCensusHeaderCellModels = (
  columns: readonly CensusHeaderColumnDefinition[] = CENSUS_HEADER_COLUMNS,
  accessProfile: CensusAccessProfile = 'default'
): CensusHeaderCellModel[] =>
  resolveVisibleHeaderColumns(columns, accessProfile).map(buildCensusHeaderCellModel);
