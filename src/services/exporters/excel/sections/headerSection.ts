import type { Worksheet } from 'exceljs';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { MAIN_TITLE_STYLE } from '../styles';
import { resolvePresentedNightShiftNurses } from '@/services/staff/dailyRecordStaffingPresentation';

export function addHeaderSection(
  sheet: Worksheet,
  record: CensusExportRecord,
  startRow: number,
  snapshotLabel?: string
): number {
  const [year, month, day] = record.date.split('-');
  const formattedDate = `${day}-${month}-${year}`;

  // Title
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = 'CENSO CAMAS DIARIO - HOSPITAL HANGA ROA';
  titleRow.getCell(1).font = MAIN_TITLE_STYLE;
  sheet.mergeCells(startRow, 1, startRow, 6);

  // Date
  const dateRow = sheet.getRow(startRow + 1);
  dateRow.getCell(1).value = `Fecha: ${formattedDate}`;
  dateRow.getCell(1).font = { bold: true };

  // Nurses (Night Shift only as per requirement)
  const nurses = resolvePresentedNightShiftNurses(record);
  const nurseText = nurses.length > 0 ? nurses.join(', ') : 'Sin asignar';
  const nurseRow = sheet.getRow(startRow + 2);
  nurseRow.getCell(1).value = `Enfermeros/as Turno Noche: ${nurseText}`;
  nurseRow.getCell(1).font = { italic: true };

  if (!snapshotLabel) {
    return startRow + 3;
  }

  const snapshotRow = sheet.getRow(startRow + 3);
  snapshotRow.getCell(1).value = `Corte de datos: ${snapshotLabel}`;
  snapshotRow.getCell(1).font = { italic: true, size: 9 };

  return startRow + 4;
}
