import type { Worksheet } from 'exceljs';
import { DischargeData } from '@/types/domain/movements';
import { TITLE_STYLE, HEADER_FILL, BORDER_THIN } from '../styles';
import { formatAge } from '../formatters';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

export function addDischargesTable(
  sheet: Worksheet,
  discharges: DischargeData[],
  startRow: number
): number {
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = 'ALTAS DEL DÍA';
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
    'Estado',
    'Tipo Alta',
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
  if (discharges.length === 0) {
    const row = sheet.getRow(currentRow);
    row.getCell(1).value = 'Sin altas registradas';
    row.getCell(1).font = { italic: true };
    sheet.mergeCells(currentRow, 1, currentRow, headers.length);
    return currentRow + 1;
  }

  discharges.forEach((d, idx) => {
    const row = sheet.getRow(currentRow);
    const values = [
      idx + 1,
      normalizeCribDisplayText(d.bedName || d.bedId),
      d.bedType || '',
      d.patientName || '',
      d.rut || '',
      formatAge(d.age),
      d.diagnosis || '',
      d.status || '',
      d.isNested
        ? 'Alta asociada (cuna RN; no suma egreso)'
        : d.dischargeTypeOther || d.dischargeType || 'N/A',
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
