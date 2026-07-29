import type { Worksheet } from 'exceljs';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { CensusStatistics } from '../../../calculations/statsCalculator';
import {
  getActiveCma,
  getStatisticalDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

export function addSummarySection(
  sheet: Worksheet,
  record: CensusExportRecord,
  stats: CensusStatistics,
  startRow: number
): number {
  // Calculate movement counts
  const discharges = getStatisticalDischarges(record.discharges);
  const transfers = getActiveTransfers(record.transfers);
  const cma = getActiveCma(record.cma);
  const deceased = discharges.filter(d => d.status === 'Fallecido').length;
  const altas = discharges.filter(d => d.status === 'Vivo').length;

  // Row 1: Section headers
  const headerRow = sheet.getRow(startRow);
  headerRow.getCell(1).value = 'CENSO CAMAS';
  headerRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  sheet.mergeCells(startRow, 1, startRow, 4);

  headerRow.getCell(5).value = 'MOVIMIENTOS';
  headerRow.getCell(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
  sheet.mergeCells(startRow, 5, startRow, 8);

  // Row 2: Labels
  const labelRow = sheet.getRow(startRow + 1);
  labelRow.getCell(1).value = 'Ocupadas';
  labelRow.getCell(2).value = 'Libres';
  labelRow.getCell(3).value = 'Bloqueadas';
  labelRow.getCell(4).value = 'Cunas RN';
  labelRow.getCell(5).value = 'Altas';
  labelRow.getCell(6).value = 'Traslados';
  labelRow.getCell(7).value = 'Hosp. Diurna';
  labelRow.getCell(8).value = 'Fallecidos';
  labelRow.eachCell(cell => {
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center' };
  });

  // Row 3: Values
  const valueRow = sheet.getRow(startRow + 2);
  valueRow.getCell(1).value = stats.occupiedBeds;
  valueRow.getCell(2).value = stats.availableCapacity;
  valueRow.getCell(3).value = stats.blockedBeds;
  valueRow.getCell(4).value = stats.clinicalCribsCount + stats.companionCribs;
  valueRow.getCell(5).value = altas;
  valueRow.getCell(6).value = transfers.length;
  valueRow.getCell(7).value = cma.length;
  valueRow.getCell(8).value = deceased;
  valueRow.eachCell(cell => {
    cell.alignment = { horizontal: 'center' };
  });

  return startRow + 3;
}
