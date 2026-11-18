import type { Worksheet } from 'exceljs';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import { TITLE_STYLE, HEADER_FILL, BORDER_THIN } from '../styles';
import { formatAge } from '../formatters';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

interface MovementColumn<TMovement> {
  header: string;
  value: (movement: TMovement) => string;
}

/** One movement table of the day sheet, described as data: the builder below is the only layout. */
export interface MovementTable<TMovement> {
  title: string;
  emptyMessage: string;
  columns: readonly MovementColumn<TMovement>[];
}

interface MovementPatientFields {
  patientName: string;
  rut: string;
  age?: string;
  diagnosis: string;
}

/** Bed and type columns differ per table; patient, RUT, age and diagnosis read the same fields. */
const movementColumns = <TMovement extends MovementPatientFields>(
  bed: (movement: TMovement) => string,
  bedType: (movement: TMovement) => string,
  ...specific: MovementColumn<TMovement>[]
): MovementColumn<TMovement>[] => [
  { header: 'Cama', value: movement => normalizeCribDisplayText(bed(movement)) },
  { header: 'Tipo', value: bedType },
  { header: 'Paciente', value: movement => movement.patientName || '' },
  { header: 'RUT', value: movement => movement.rut || '' },
  { header: 'Edad', value: movement => formatAge(movement.age) },
  { header: 'Diagnóstico', value: movement => movement.diagnosis || '' },
  ...specific,
];

export const DISCHARGES_TABLE: MovementTable<DischargeData> = {
  title: 'ALTAS DEL DÍA',
  emptyMessage: 'Sin altas registradas',
  columns: movementColumns<DischargeData>(
    d => d.bedName || d.bedId,
    d => d.bedType || '',
    { header: 'Estado', value: d => d.status || '' },
    {
      header: 'Tipo Alta',
      value: d =>
        d.isNested
          ? 'Alta asociada (cuna RN; no suma egreso)'
          : d.dischargeTypeOther || d.dischargeType || 'N/A',
    }
  ),
};

export const TRANSFERS_TABLE: MovementTable<TransferData> = {
  title: 'TRASLADOS DEL DÍA',
  emptyMessage: 'Sin traslados registrados',
  columns: movementColumns<TransferData>(
    t => t.bedName || t.bedId,
    t => t.bedType || '',
    { header: 'Centro Destino', value: t => t.receivingCenterOther || t.receivingCenter || '' },
    { header: 'Evacuación', value: t => t.evacuationMethod || '' }
  ),
};

export const CMA_TABLE: MovementTable<CMAData> = {
  title: 'HOSPITALIZACIÓN DIURNA (CMA)',
  emptyMessage: 'Sin hospitalización diurna',
  columns: movementColumns<CMAData>(
    c => c.bedName,
    () => 'MEDIA',
    { header: 'Especialidad', value: c => c.specialty || '' },
    { header: 'Tipo', value: c => c.interventionType || '' }
  ),
};

/**
 * Writes the title, header row and one row per movement (numbered from 1), or a merged empty
 * message. Returns the first free row. The first three columns (#, Cama, Tipo) are centered.
 */
export function addMovementTable<TMovement>(
  sheet: Worksheet,
  table: MovementTable<TMovement>,
  movements: readonly TMovement[],
  startRow: number
): number {
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = table.title;
  titleRow.getCell(1).font = TITLE_STYLE;

  const headers = ['#', ...table.columns.map(column => column.header)];
  const headerRow = sheet.getRow(startRow + 1);
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = header;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER_THIN;
  });

  let currentRow = startRow + 2;
  if (movements.length === 0) {
    const row = sheet.getRow(currentRow);
    row.getCell(1).value = table.emptyMessage;
    row.getCell(1).font = { italic: true };
    sheet.mergeCells(currentRow, 1, currentRow, headers.length);
    return currentRow + 1;
  }

  movements.forEach((movement, idx) => {
    const row = sheet.getRow(currentRow);
    const values = [idx + 1, ...table.columns.map(column => column.value(movement))];
    values.forEach((value, cellIdx) => {
      const cell = row.getCell(cellIdx + 1);
      cell.value = value;
      cell.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: cellIdx <= 2 ? 'center' : 'left',
      };
      cell.border = BORDER_THIN;
    });
    currentRow++;
  });

  return currentRow;
}
