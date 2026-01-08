/**
 * CUDYR Excel Export Service
 * Generates monthly Excel reports with CUDYR statistics.
 * 
 * IMPORTANT: This service exports ONLY aggregated statistics, 
 * NO patient names or RUTs are included for privacy compliance.
 * 
 * The monthly summary uses Excel formulas that reference daily sheets
 * for improved auditability and calculation transparency.
 * 
 * @module services/exporters/cudyrExportService
 */

import { saveAs } from 'file-saver';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { getDailyRecordsPath } from '@/constants/firestorePaths';
import { DailyRecord } from '@/types';
import { createWorkbook, BORDER_THIN } from './excelUtils';
import {
    getCudyrMonthlyTotals,
    CudyrCategory,
    CudyrDailySummary,
    CategoryCounts
} from '../calculations/cudyrSummary';
import type { Worksheet } from 'exceljs';

// ============================================================================
// Constants
// ============================================================================

const CATEGORIES: CudyrCategory[] = [
    'A1', 'A2', 'A3',
    'B1', 'B2', 'B3',
    'C1', 'C2', 'C3',
    'D1', 'D2', 'D3'
];

const MONTHS_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Row positions in daily sheets (must match addDailySummaryTable layout)
const DAILY_SHEET_CATEGORY_START_ROW = 4; // Categories start at row 4 (A1 is row 4, A2 is row 5, etc.)
const DAILY_SHEET_TOTAL_ROW = 16; // Total row is at row 16
const DAILY_SHEET_OCCUPIED_ROW = 19; // Occupied count at row 19
const DAILY_SHEET_CATEGORIZED_ROW = 20; // Categorized count at row 20

// ============================================================================
// Helper Functions
// ============================================================================

const formatDateDMY = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
};

/**
 * Escapes sheet name for use in Excel formulas.
 * Sheet names with special characters need to be quoted.
 */
const escapeSheetName = (name: string): string => {
    // If contains special chars, wrap in single quotes
    if (/[^\w]/.test(name)) {
        return `'${name}'`;
    }
    return name;
};

// Workaround for ExcelJS bug where result=0 is skipped/dropped when writing to buffer
// We convert 0 to string "0" to force it to be written.
const safeResult = (val: number | string): number | string => {
    return val === 0 ? "0" : val;
};

/**
 * Adds the CUDYR summary table to a daily worksheet.
 * Format: CAT | UTI | MEDIA | TOTAL
 */
const addDailySummaryTable = (
    sheet: Worksheet,
    counts: CategoryCounts,
    utiTotal: number,
    mediaTotal: number,
    startRow: number
): number => {
    // Header row
    const headerRow = sheet.getRow(startRow);
    headerRow.values = ['CAT', 'UTI', 'MEDIA', 'TOTAL'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };
    ['A', 'B', 'C', 'D'].forEach(col => {
        const cell = sheet.getCell(`${col}${startRow}`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.border = BORDER_THIN;
    });

    // Category rows
    let currentRow = startRow + 1;
    CATEGORIES.forEach(cat => {
        const row = sheet.getRow(currentRow);
        const utiCount = counts.uti[cat];
        const mediaCount = counts.media[cat];
        row.values = [cat, utiCount, mediaCount, utiCount + mediaCount];
        row.alignment = { horizontal: 'center' };
        ['A', 'B', 'C', 'D'].forEach(col => {
            sheet.getCell(`${col}${currentRow}`).border = BORDER_THIN;
        });
        currentRow++;
    });

    // Total row
    const totalRow = sheet.getRow(currentRow);
    totalRow.values = ['TOTAL', utiTotal, mediaTotal, utiTotal + mediaTotal];
    totalRow.font = { bold: true };
    totalRow.alignment = { horizontal: 'center' };
    ['A', 'B', 'C', 'D'].forEach(col => {
        const cell = sheet.getCell(`${col}${currentRow}`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = BORDER_THIN;
    });

    return currentRow + 1;
};

/**
 * Adds occupation statistics section to daily sheets.
 */
const addDailyOccupationStats = (
    sheet: Worksheet,
    occupiedCount: number,
    categorizedCount: number,
    startRow: number
): number => {
    const sectionRow = sheet.getRow(startRow);
    sectionRow.values = ['Estadísticas de Ocupación'];
    sectionRow.font = { bold: true, size: 11 };
    sheet.mergeCells(`A${startRow}:D${startRow}`);

    // Occupied count
    const occupiedRow = sheet.getRow(startRow + 1);
    occupiedRow.values = ['Camas Ocupadas', occupiedCount];
    occupiedRow.getCell(1).font = { bold: true };
    occupiedRow.getCell(2).alignment = { horizontal: 'center' };

    // Categorized count
    const categorizedRow = sheet.getRow(startRow + 2);
    categorizedRow.values = ['Pacientes Categorizados', categorizedCount];
    categorizedRow.getCell(1).font = { bold: true };
    categorizedRow.getCell(2).alignment = { horizontal: 'center' };

    // Index (formula within the daily sheet)
    const indexRow = sheet.getRow(startRow + 3);
    const indexVal = occupiedCount > 0 ? Math.round((categorizedCount / occupiedCount) * 100) : 0;

    indexRow.values = ['Índice de Categorización'];
    indexRow.getCell(1).font = { bold: true };
    // Use formula: B(categorized) / B(occupied) * 100
    const indexCell = sheet.getCell(`B${startRow + 3}`);
    indexCell.value = {
        formula: `IF(B${startRow + 1}=0,0,ROUND(B${startRow + 2}/B${startRow + 1}*100,0))`,
        result: safeResult(indexVal)
    };
    indexCell.numFmt = '0"%"';
    indexCell.alignment = { horizontal: 'center' };

    return startRow + 4;
};

/**
 * Adds the monthly summary table with FORMULAS referencing daily sheets.
 * Includes calculated results for web preview compatibility.
 */
const addMonthlySummaryTableWithFormulas = (
    sheet: Worksheet,
    sheetNames: string[],
    startRow: number,
    totals: CategoryCounts,
    utiTotal: number,
    mediaTotal: number
): number => {
    // Header row
    const headerRow = sheet.getRow(startRow);
    headerRow.values = ['CAT', 'UTI', 'MEDIA', 'TOTAL'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };
    ['A', 'B', 'C', 'D'].forEach(col => {
        const cell = sheet.getCell(`${col}${startRow}`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.border = BORDER_THIN;
    });

    // Category rows with formulas
    let currentRow = startRow + 1;
    CATEGORIES.forEach((cat, idx) => {
        const row = sheet.getRow(currentRow);
        const dailyDataRow = DAILY_SHEET_CATEGORY_START_ROW + idx; // Row in daily sheets

        // Category label
        row.getCell(1).value = cat;
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(1).border = BORDER_THIN;

        const utiVal = totals.uti[cat];
        const mediaVal = totals.media[cat];
        const totalVal = utiVal + mediaVal;

        // UTI formula: SUM of column B from all daily sheets
        const utiFormula = sheetNames.map(name => `${escapeSheetName(name)}!B${dailyDataRow}`).join('+');
        row.getCell(2).value = { formula: utiFormula, result: safeResult(utiVal) };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(2).border = BORDER_THIN;

        // MEDIA formula: SUM of column C from all daily sheets
        const mediaFormula = sheetNames.map(name => `${escapeSheetName(name)}!C${dailyDataRow}`).join('+');
        row.getCell(3).value = { formula: mediaFormula, result: safeResult(mediaVal) };
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(3).border = BORDER_THIN;

        // TOTAL formula: B + C in this row
        row.getCell(4).value = { formula: `B${currentRow}+C${currentRow}`, result: safeResult(totalVal) };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(4).border = BORDER_THIN;

        currentRow++;
    });

    // Total row with formulas
    const totalMsgVal = utiTotal + mediaTotal;
    const totalRow = sheet.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: 'center' };
    totalRow.getCell(1).border = BORDER_THIN;

    // Sum of UTI column
    totalRow.getCell(2).value = { formula: `SUM(B${startRow + 1}:B${currentRow - 1})`, result: safeResult(utiTotal) };
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(2).alignment = { horizontal: 'center' };
    totalRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    totalRow.getCell(2).border = BORDER_THIN;

    // Sum of MEDIA column
    totalRow.getCell(3).value = { formula: `SUM(C${startRow + 1}:C${currentRow - 1})`, result: safeResult(mediaTotal) };
    totalRow.getCell(3).font = { bold: true };
    totalRow.getCell(3).alignment = { horizontal: 'center' };
    totalRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    totalRow.getCell(3).border = BORDER_THIN;

    // Sum of TOTAL column
    totalRow.getCell(4).value = { formula: `SUM(D${startRow + 1}:D${currentRow - 1})`, result: safeResult(totalMsgVal) };
    totalRow.getCell(4).font = { bold: true };
    totalRow.getCell(4).alignment = { horizontal: 'center' };
    totalRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    totalRow.getCell(4).border = BORDER_THIN;

    return currentRow + 1;
};

/**
 * Adds occupation statistics with FORMULAS referencing daily sheets.
 * Includes calculated results for web preview compatibility.
 */
const addMonthlyOccupationStatsWithFormulas = (
    sheet: Worksheet,
    sheetNames: string[],
    startRow: number,
    totalOccupied: number,
    totalCategorized: number
): number => {
    const sectionRow = sheet.getRow(startRow);
    sectionRow.values = ['Estadísticas de Ocupación (Acumulado)'];
    sectionRow.font = { bold: true, size: 11 };
    sheet.mergeCells(`A${startRow}:D${startRow}`);

    // Occupied count with formula
    const occupiedRow = sheet.getRow(startRow + 1);
    occupiedRow.getCell(1).value = 'Camas Ocupadas';
    occupiedRow.getCell(1).font = { bold: true };
    const occupiedFormula = sheetNames.map(name => `${escapeSheetName(name)}!B${DAILY_SHEET_OCCUPIED_ROW}`).join('+');
    occupiedRow.getCell(2).value = { formula: occupiedFormula, result: safeResult(totalOccupied) };
    occupiedRow.getCell(2).alignment = { horizontal: 'center' };

    // Categorized count with formula
    const categorizedRow = sheet.getRow(startRow + 2);
    categorizedRow.getCell(1).value = 'Pacientes Categorizados';
    categorizedRow.getCell(1).font = { bold: true };
    const categorizedFormula = sheetNames.map(name => `${escapeSheetName(name)}!B${DAILY_SHEET_CATEGORIZED_ROW}`).join('+');
    categorizedRow.getCell(2).value = { formula: categorizedFormula, result: safeResult(totalCategorized) };
    categorizedRow.getCell(2).alignment = { horizontal: 'center' };

    // Index with formula
    const indexRow = sheet.getRow(startRow + 3);
    const indexVal = totalOccupied > 0 ? Math.round((totalCategorized / totalOccupied) * 100) : 0;

    indexRow.getCell(1).value = 'Índice de Categorización';
    indexRow.getCell(1).font = { bold: true };
    indexRow.getCell(2).value = {
        formula: `IF(B${startRow + 1}=0,0,ROUND(B${startRow + 2}/B${startRow + 1}*100,0))`,
        result: indexVal
    };

    indexRow.getCell(2).numFmt = '0"%"';
    indexRow.getCell(2).alignment = { horizontal: 'center' };

    return startRow + 4;
};

// ============================================================================
// Firestore Fetch Helper
// ============================================================================

/**
 * Fetches a DailyRecord from Firestore by date string.
 */
const fetchDailyRecord = async (dateStr: string): Promise<DailyRecord | null> => {
    try {
        const docRef = doc(db, getDailyRecordsPath(), dateStr);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return snapshot.data() as DailyRecord;
        }
        return null;
    } catch (error) {
        console.warn(`[CudyrExport] Failed to fetch record for ${dateStr}:`, error);
        return null;
    }
};

/**
 * Generates and downloads a monthly CUDYR Excel report.
 */
export const generateCudyrMonthlyExcel = async (
    year: number,
    month: number,
    endDate?: string,
    currentRecord?: DailyRecord | null
): Promise<void> => {
    // ... (workbook creation)
    const workbook = await createWorkbook();
    workbook.creator = 'Hospital Hanga Roa';
    workbook.created = new Date();

    // Fetch monthly data
    const monthlySummary = await getCudyrMonthlyTotals(year, month, endDate, fetchDailyRecord, currentRecord);

    // ... (sheet creation logic - kept same but updating call below)
    const summarySheet = workbook.addWorksheet('Resumen Mensual', {
        properties: { tabColor: { argb: 'FF4CAF50' } }
    });
    // ... (columns setup)
    summarySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];
    const dailySheetNames: string[] = [];

    // Daily sheets loop
    monthlySummary.dailySummaries.forEach((daySummary: CudyrDailySummary) => {
        const sheetName = formatDateDMY(daySummary.date);
        dailySheetNames.push(sheetName);
        const daySheet = workbook.addWorksheet(sheetName);
        // ... (daily sheet populating logic is fine as it uses values directly, except index formula in addDailyOccupationStats)
        // CHECK: addDailyOccupationStats logic inside loop
        // It uses addDailyOccupationStats. Let's look at THAT function in original file.
        // It's line 124. It creates index formula.
        // I should probably update that one too if we want daily index to show up correctly in preview.
        // But let's finish the monthly one first.

        daySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];
        daySheet.getCell('A1').value = `CUDYR - ${sheetName}`;
        daySheet.getCell('A1').font = { bold: true, size: 12 };
        daySheet.mergeCells('A1:D1');

        let rowNum = 3;
        rowNum = addDailySummaryTable(daySheet, daySummary.counts, daySummary.utiTotal, daySummary.mediaTotal, rowNum);

        // This function also puts formulas!
        rowNum = 18;

        // We need to update addDailyOccupationStats too?
        // Let's verify addDailyOccupationStats in original code
        // It calculates Index with formula: line 153.
        // Yes, I should update it to include result too.

        addDailyOccupationStats(daySheet, daySummary.occupiedCount, daySummary.categorizedCount, rowNum);
    });

    // ... (Summary sheet population)
    const endDateFormatted = endDate ? formatDateDMY(endDate) : `${new Date(year, month, 0).getDate()}-${String(month).padStart(2, '0')}-${year}`;
    const title = `Resumen CUDYR - ${MONTHS_ES[month - 1]} ${year} (hasta ${endDateFormatted})`;
    summarySheet.getCell('A1').value = title;
    summarySheet.getCell('A1').font = { bold: true, size: 14 };
    summarySheet.mergeCells('A1:D1');

    if (dailySheetNames.length > 0) {
        let currentRow = 3;
        currentRow = addMonthlySummaryTableWithFormulas(
            summarySheet,
            dailySheetNames,
            currentRow,
            monthlySummary.totals,
            monthlySummary.utiTotal,
            monthlySummary.mediaTotal
        );

        currentRow += 2;
        addMonthlyOccupationStatsWithFormulas(
            summarySheet,
            dailySheetNames,
            currentRow,
            monthlySummary.totalOccupied,
            monthlySummary.totalCategorized
        );
    } else {
        // ...
        summarySheet.getCell('A3').value = 'No hay datos para el período seleccionado.';
        summarySheet.getCell('A3').font = { italic: true, color: { argb: 'FF888888' } };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileName = `CUDYR_${MONTHS_ES[month - 1]}_${year}.xlsx`;
    saveAs(blob, fileName);
};

export const generateCudyrMonthlyExcelBlob = async (
    year: number,
    month: number,
    endDate?: string,
    currentRecord?: DailyRecord | null
): Promise<Blob> => {
    const workbook = await createWorkbook();
    workbook.creator = 'Hospital Hanga Roa';
    workbook.created = new Date();

    const monthlySummary = await getCudyrMonthlyTotals(year, month, endDate, fetchDailyRecord, currentRecord);

    const summarySheet = workbook.addWorksheet('Resumen Mensual', {
        properties: { tabColor: { argb: 'FF4CAF50' } }
    });
    summarySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];

    const dailySheetNames: string[] = [];

    monthlySummary.dailySummaries.forEach((daySummary: CudyrDailySummary) => {
        const sheetName = formatDateDMY(daySummary.date);
        dailySheetNames.push(sheetName);

        const daySheet = workbook.addWorksheet(sheetName);
        daySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];

        daySheet.getCell('A1').value = `CUDYR - ${sheetName}`;
        daySheet.getCell('A1').font = { bold: true, size: 12 };
        daySheet.mergeCells('A1:D1');

        let rowNum = 3;
        rowNum = addDailySummaryTable(daySheet, daySummary.counts, daySummary.utiTotal, daySummary.mediaTotal, rowNum);

        rowNum = 18;
        addDailyOccupationStats(daySheet, daySummary.occupiedCount, daySummary.categorizedCount, rowNum);
    });

    const endDateFormatted = endDate ? formatDateDMY(endDate) : `${new Date(year, month, 0).getDate()}-${String(month).padStart(2, '0')}-${year}`;
    const title = `Resumen CUDYR - ${MONTHS_ES[month - 1]} ${year} (hasta ${endDateFormatted})`;
    summarySheet.getCell('A1').value = title;
    summarySheet.getCell('A1').font = { bold: true, size: 14 };
    summarySheet.mergeCells('A1:D1');

    if (dailySheetNames.length > 0) {
        let currentRow = 3;
        currentRow = addMonthlySummaryTableWithFormulas(
            summarySheet,
            dailySheetNames,
            currentRow,
            monthlySummary.totals,
            monthlySummary.utiTotal,
            monthlySummary.mediaTotal
        );

        currentRow += 2;
        addMonthlyOccupationStatsWithFormulas(
            summarySheet,
            dailySheetNames,
            currentRow,
            monthlySummary.totalOccupied,
            monthlySummary.totalCategorized
        );
    } else {
        summarySheet.getCell('A3').value = 'No hay datos para el período seleccionado.';
        summarySheet.getCell('A3').font = { italic: true, color: { argb: 'FF888888' } };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
