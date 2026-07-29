import type { Worksheet } from 'exceljs';
import { TransferData } from '@/types/domain/movements';
import { TITLE_STYLE, HEADER_FILL, BORDER_THIN } from '../styles';
import { formatAge } from '../formatters';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

export function addTransfersTable(
  sheet: Worksheet,
  transfers: TransferData[],
  startRow: number
): number {
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = 'TRASLADOS DEL DÍA';
  titleRow.getCell(1).font = TITLE_STYLE;
  startRow += 1;

  const headers = [
    '#',
    'Cama',
    'Tipo',
    'Paciente',
    'RUT',
    'Edad',
    'Diagnóstico',
    'Centro Destino',
    'Evacuación',
  ];
  const headerRow = sheet.getRow(startRow);
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER_THIN;
  });

  let currentRow = startRow + 1;
  if (transfers.length === 0) {
    const row = sheet.getRow(currentRow);
    row.getCell(1).value = 'Sin traslados registrados';
    row.getCell(1).font = { italic: true };
    sheet.mergeCells(currentRow, 1, currentRow, headers.length);
    return currentRow + 1;
  }

  transfers.forEach((t, idx) => {
    const destination = t.receivingCenterOther || t.receivingCenter || '';
    const row = sheet.getRow(currentRow);
    const values = [
      idx + 1,
      normalizeCribDisplayText(t.bedName || t.bedId),
      t.bedType || '',
      t.patientName || '',
      t.rut || '',
      formatAge(t.age),
      t.diagnosis || '',
      destination,
      t.evacuationMethod || '',
    ];

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
