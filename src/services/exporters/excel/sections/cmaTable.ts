import type { Worksheet } from 'exceljs';
import { CMAData } from '@/types/domain/movements';
import { TITLE_STYLE, HEADER_FILL, BORDER_THIN } from '../styles';
import { formatAge } from '../formatters';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

export function addCMATable(sheet: Worksheet, cma: CMAData[], startRow: number): number {
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = 'HOSPITALIZACIÓN DIURNA (CMA)';
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
    'Especialidad',
    'Tipo',
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
  if (cma.length === 0) {
    const row = sheet.getRow(currentRow);
    row.getCell(1).value = 'Sin hospitalización diurna';
    row.getCell(1).font = { italic: true };
    sheet.mergeCells(currentRow, 1, currentRow, headers.length);
    return currentRow + 1;
  }

  cma.forEach((c, idx) => {
    const row = sheet.getRow(currentRow);
    const values = [
      idx + 1,
      normalizeCribDisplayText(c.bedName),
      'MEDIA',
      c.patientName || '',
      c.rut || '',
      formatAge(c.age),
      c.diagnosis || '',
      c.specialty || '',
      c.interventionType || '',
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
