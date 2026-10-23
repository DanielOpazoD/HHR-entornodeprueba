/**
 * @module labExcelService
 * @description Excel export service for laboratory comparison data.
 * No React dependency — pure async function.
 */

import type { LabPatient } from '@/types/domain/labExamTypes';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { ExportConfig } from '../types/labViewerTypes';
import { formatLabExamColumnLabel } from '../controllers/labDateDisplayController';
import { parseLocalizedNumber, parseScientificValue } from '../controllers/labFormattingController';
import { createWorkbook } from '@/services/exporters/excelUtils';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { getTodayISO } from '@/utils/dateCoreUtils';

const logger = createScopedLogger('labExcelService');

const formatBirthDateForExport = (birthDate?: string): string => {
  if (!birthDate) return 'No registrada';

  const isoMatch = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  const slashMatch = birthDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${day}-${month}-${year}`;
  }

  return birthDate;
};

/**
 * Export the comparison table to an Excel file and trigger download.
 *
 * @param data - The processed analysis data.
 * @param config - Which dates and variables to include.
 * @param patient - Current patient context for worksheet heading.
 */
export const exportComparisonToExcel = async (
  data: LabAnalysisData,
  config: ExportConfig,
  patient: LabPatient | null
): Promise<void> => {
  try {
    const wb = await createWorkbook();
    const ws = wb.addWorksheet('Comparación Lab');

    const dates = data.examDates.filter(d => config.selectedDates.has(d));
    const vars = Object.keys(data.comparison).filter(v => config.selectedVars.has(v));

    const headingColumns = Math.max(dates.length + 1, 3);
    ws.mergeCells(1, 1, 1, headingColumns);
    ws.getCell(1, 1).value = 'Resumen de laboratorio';
    ws.getCell(1, 1).font = { bold: true, size: 14 };

    ws.getCell(3, 1).value = `Nombre: ${patient?.patientName?.trim() || 'No registrado'}`;
    ws.getCell(4, 1).value = `RUT: ${patient?.rut?.trim() || 'No registrado'}`;
    ws.getCell(5, 1).value = `Fecha de nacimiento: ${formatBirthDateForExport(patient?.birthDate)}`;
    [3, 4, 5].forEach(rowNumber => {
      ws.getRow(rowNumber).font = { bold: true, size: 11 };
    });
    ws.getRow(6).height = 8;

    // Header row
    ws.addRow([
      'Variable',
      ...dates.map(date => formatLabExamColumnLabel(date, config.includeTimeInColumns ?? true)),
    ]);
    const headerRow = ws.getRow(7);
    headerRow.font = { bold: true, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };

    // Data rows — write numbers as actual numbers so Excel doesn't flag them as text
    for (const name of vars) {
      const cells: (string | number)[] = [name];
      for (const date of dates) {
        const row = data.comparison[name]?.[date];
        if (!row) {
          cells.push('');
        } else {
          // For x10^N units, export the multiplied integer (e.g. 192000)
          const sci = parseScientificValue(row.result, row.unit);
          if (sci) {
            cells.push(sci.multiplied);
            continue;
          }
          // Regular numeric value
          const num = parseLocalizedNumber(row.result);
          if (!isNaN(num) && !row.result.includes('/')) {
            cells.push(num);
          } else {
            cells.push(row.result);
          }
        }
      }
      ws.addRow(cells);
    }

    // Auto-width columns
    ws.columns.forEach(col => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, cell => {
        const len = String(cell.value || '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 30);
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laboratorio_comparacion_${getTodayISO()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    logger.error('Failed to export comparison to Excel', error);
    throw error;
  }
};
