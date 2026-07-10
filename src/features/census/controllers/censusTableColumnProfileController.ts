import type { TableColumnConfig } from '@/context/TableConfigContext';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

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
  type: 40,
  name: 150,
  rut: 100,
  age: 40,
  diagnosis: 200,
  specialty: 80,
  admission: 90,
};

export const isVisibleCensusColumn = (
  column: keyof TableColumnConfig,
  accessProfile: CensusAccessProfile = 'default'
): boolean =>
  !isSpecialistCensusAccessProfile(accessProfile) ||
  !SPECIALIST_HIDDEN_CENSUS_COLUMNS.includes(column);

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
  if (!isSpecialistCensusAccessProfile(accessProfile)) {
    return columns;
  }

  return {
    ...columns,
    actions: Math.max(columns.actions, SPECIALIST_MINIMUM_COLUMN_WIDTHS.actions ?? columns.actions),
    bed: Math.max(columns.bed, SPECIALIST_MINIMUM_COLUMN_WIDTHS.bed ?? columns.bed),
    type: Math.max(columns.type, SPECIALIST_MINIMUM_COLUMN_WIDTHS.type ?? columns.type),
    name: Math.max(columns.name, SPECIALIST_MINIMUM_COLUMN_WIDTHS.name ?? columns.name),
    rut: Math.max(columns.rut, SPECIALIST_MINIMUM_COLUMN_WIDTHS.rut ?? columns.rut),
    age: Math.max(columns.age, SPECIALIST_MINIMUM_COLUMN_WIDTHS.age ?? columns.age),
    diagnosis: Math.max(
      columns.diagnosis,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.diagnosis ?? columns.diagnosis
    ),
    specialty: Math.max(
      columns.specialty,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.specialty ?? columns.specialty
    ),
    admission: Math.max(
      columns.admission,
      SPECIALIST_MINIMUM_COLUMN_WIDTHS.admission ?? columns.admission
    ),
    status: 0,
    dmi: 0,
    scores: 0,
    cqx: 0,
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
