import type { TableColumnConfig } from '@/context/TableConfigContext';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

/**
 * Columnas ocultas para todos los perfiles (rediseño censo 2026):
 * - rut / age: integradas a la columna única "Paciente" (PatientIdentityCell).
 * - cqx: oculta sin borrar el campo surgicalComplication ni su CheckboxCell.
 * - type: "Tipo de cama" oculta; su lugar lo ocupa ahora el Estado clínico (círculo). El
 *   componente PatientMainRowBedTypeCell se conserva para reactivación futura.
 * Las claves siguen existiendo en TableColumnConfig para no romper configuraciones
 * guardadas ni fixtures; solo dejan de renderizarse y aportan ancho 0.
 */
export const HIDDEN_CENSUS_COLUMNS: readonly (keyof TableColumnConfig)[] = [
  'rut',
  'age',
  'cqx',
  'type',
  // Especialidad: ya no es columna propia; se muestra como etiqueta de texto junto a la fecha de
  // ingreso en la celda "Paciente" (PatientIdentityCell). Se sigue editando desde el editor de
  // Diagnóstico. La clave se mantiene por compatibilidad.
  'specialty',
] as const;

export const SPECIALIST_HIDDEN_CENSUS_COLUMNS: readonly (keyof TableColumnConfig)[] = [
  'status',
  'dmi',
  'scores',
  'cqx',
  'upc',
] as const;

const SPECIALIST_MINIMUM_COLUMN_WIDTHS: Readonly<Partial<TableColumnConfig>> = {
  actions: 28,
  bed: 40,
  name: 170,
  diagnosis: 200,
  admission: 90,
};

const zeroHiddenCensusColumns = (columns: TableColumnConfig): TableColumnConfig => {
  const next = { ...columns };
  for (const column of HIDDEN_CENSUS_COLUMNS) {
    next[column] = 0;
  }
  return next;
};

export const isVisibleCensusColumn = (
  column: keyof TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): boolean =>
  !HIDDEN_CENSUS_COLUMNS.includes(column) &&
  (!isSpecialistCensusAccessProfile(accessProfile) ||
    !SPECIALIST_HIDDEN_CENSUS_COLUMNS.includes(column));

export const resolveVisibleCensusColumnKeys = (
  columns: TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): Array<keyof TableColumnConfig> =>
  (Object.keys(columns) as Array<keyof TableColumnConfig>).filter(column =>
    isVisibleCensusColumn(column, accessProfile)
  );

export const resolveVisibleCensusColumns = (
  columns: TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): TableColumnConfig => {
  // Presentation minimums also protect older saved compact configurations.
  // Do not persist these values: the user's column preferences remain intact.
  const baseColumns = zeroHiddenCensusColumns({
    ...columns,
    actions: Math.max(columns.actions, 40),
    bed: Math.max(columns.bed, 64),
    name: Math.max(columns.name, 380),
    diagnosis: Math.max(columns.diagnosis, 280),
    status: Math.max(columns.status, 28),
    admission: Math.max(columns.admission, 96),
    scores: Math.max(columns.scores, 180),
    upc: Math.max(columns.upc, 64),
  });

  if (!isSpecialistCensusAccessProfile(accessProfile)) {
    return baseColumns;
  }

  return {
    ...baseColumns,
    actions: Math.max(
      baseColumns.actions,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.actions ?? baseColumns.actions
    ),
    bed: Math.max(baseColumns.bed, SPECIALIST_MINIMUM_COLUMN_WIDTHS.bed ?? baseColumns.bed),
    name: Math.max(baseColumns.name, SPECIALIST_MINIMUM_COLUMN_WIDTHS.name ?? baseColumns.name),
    diagnosis: Math.max(
      baseColumns.diagnosis,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.diagnosis ?? baseColumns.diagnosis
    ),
    admission: Math.max(
      baseColumns.admission,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.admission ?? baseColumns.admission
    ),
    status: 0,
    dmi: 0,
    scores: 0,
    upc: 0,
  };
};

export const resolveVisibleCensusColumnCount = (
  columns: TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): number => resolveVisibleCensusColumnKeys(columns, accessProfile).length;

export const resolveVisibleCensusTotalWidth = (
  columns: TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): number =>
  (
    Object.entries(resolveVisibleCensusColumns(columns, accessProfile)) as Array<
      [keyof TableColumnConfig, number]
    >
  ).reduce(
    (sum, [column, width]) => (isVisibleCensusColumn(column, accessProfile) ? sum + width : sum),
    0
  );
