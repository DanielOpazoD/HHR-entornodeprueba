import { Specialty } from '@/types/domain/patientClassification';

export const SUMMARY_OCCUPANCY_ALERT_THRESHOLD = 0.88;

export const SPECIALTY_COLUMNS = [
  { key: Specialty.MEDICINA, header: 'Med Int.' },
  { key: Specialty.CIRUGIA, header: 'Cirugía' },
  { key: Specialty.PSIQUIATRIA, header: 'Psiq.' },
  { key: Specialty.GINECOBSTETRICIA, header: 'Gineco.' },
  { key: Specialty.PEDIATRIA, header: 'Ped.' },
  { key: Specialty.TRAUMATOLOGIA, header: 'Trauma.' },
] as const;

export const SUMMARY_HEADERS = [
  'Fecha',
  'Ocupadas',
  'Libres',
  'Bloq.',
  'Cunas RN',
  '% Ocup.',
  'Altas',
  'Traslados',
  'H. Diurna',
  'Fallec.',
  ...SPECIALTY_COLUMNS.map(item => item.header),
];

export const SUMMARY_GROUP_HEADERS = [
  { cell: 'B5', value: 'CENSO CAMAS', fill: '#1F4E79' },
  { cell: 'G5', value: 'MOVIMIENTOS', fill: '#548235' },
  { cell: 'K5', value: 'PACIENTES POR ESPECIALIDAD', fill: '#BF8F00' },
] as const;

export const SUMMARY_CONSOLIDATED_ROWS = [
  { label: 'Promedio', formula: 'AVERAGE', fill: '#5B9BD5' },
  { label: 'Máximo', formula: 'MAX', fill: '#C0504D' },
  { label: 'Mínimo', formula: 'MIN', fill: '#70AD47' },
  { label: 'Total', formula: 'SUM', fill: '#7F7F7F' },
] as const;

export const getSummarySheetName = (monthName: string, year: string) =>
  `RESUMEN ${monthName} ${year}`;

export const getUpcPatientsSheetName = (monthName: string, year: string) =>
  `UPC PAC ${monthName} ${year}`;

export const UPC_DAILY_DETAIL_SHEET_NAME = 'UPC DET';
