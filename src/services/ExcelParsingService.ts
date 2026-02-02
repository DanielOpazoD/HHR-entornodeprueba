import { createWorkbook } from '@/services/exporters/excelUtils';

export interface ParsedCell {
    value: string | number | Date | null | boolean;
    colSpan: number;
    rowSpan: number;
    hidden: boolean;
}

interface ExcelRichText {
    text: string;
}

interface ExcelFormula {
    formula?: string;
    result?: unknown;
}

interface ExcelErrorValue {
    error: string;
}

interface InternalWorksheet {
    _merges?: Record<string, { top: number; left: number; bottom: number; right: number }>;
}

/**
 * Service to handle complex Excel parsing logic outside of React hooks.
 * This ensures the logic is testable and reusable.
 * 
 * Uses ExcelJS for robust handling of formats, merged cells, and rich text.
 */
export const ExcelParsingService = {
    /**
     * Parses an Excel Blob into a structured workbook data object.
     * @param blob The Excel file as a Blob.
     * @returns A promise resolving to an object containing sheet names and their corresponding grids.
     */
    async parseBlob(blob: Blob): Promise<{
        workbookData: Record<string, ParsedCell[][]>;
        sheetNames: string[];
    }> {
        const workbook = await createWorkbook();
        const buffer = await blob.arrayBuffer();
        await workbook.xlsx.load(buffer);

        const allSheetsData: Record<string, ParsedCell[][]> = {};
        const names: string[] = [];

        workbook.eachSheet((worksheet) => {
            const sheetName = worksheet.name;
            names.push(sheetName);

            const grid: ParsedCell[][] = [];
            const rowsCount = worksheet.rowCount;
            const colsCount = worksheet.columnCount;
            const hiddenCells = new Set<string>();

            for (let r = 1; r <= rowsCount; r++) {
                const rowGrid: ParsedCell[] = [];
                const row = worksheet.getRow(r);

                for (let c = 1; c <= colsCount; c++) {
                    const cellRef = `${r},${c}`;

                    // Skip cells that are part of a merge (not the master cell)
                    if (hiddenCells.has(cellRef)) {
                        rowGrid.push({ value: null, colSpan: 1, rowSpan: 1, hidden: true });
                        continue;
                    }

                    const cell = row.getCell(c);
                    let val = cell.value;

                    // Extract actual value from complex cell types
                    if (val && typeof val === 'object') {
                        if ('richText' in val && Array.isArray((val as { richText: unknown }).richText)) {
                            // Rich text - concatenate all text parts
                            val = ((val as { richText: ExcelRichText[] }).richText).map((rt) => rt.text).join('');
                        } else if ('formula' in val || 'result' in val) {
                            // Formula cell - get the result
                            const formulaRes = (val as ExcelFormula).result;
                            // Default to 0 if result is missing
                            val = (formulaRes === undefined || formulaRes === null) ? 0 : formulaRes as string | number | Date;
                        } else if ('text' in val) {
                            // Hyperlink or similar
                            val = (val as { text: string }).text;
                        }

                        // Handle if the extracted result is STILL an object
                        if (val && typeof val === 'object') {
                            if ('error' in val) {
                                val = (val as ExcelErrorValue).error;
                            } else if (val instanceof Date) {
                                // Keep as Date object
                            } else {
                                // Fallback for unknown objects
                                val = '';
                            }
                        }
                    }

                    // Ensure val is of allowed type or cast to string
                    let finalVal: string | number | Date | null | boolean = null;
                    if (val === null || val === undefined) finalVal = null;
                    else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val instanceof Date) {
                        finalVal = val;
                    } else {
                        finalVal = String(val);
                    }

                    let colSpan = 1;
                    let rowSpan = 1;

                    // Handle merged cells
                    if (cell.isMerged) {
                        const master = cell.master;

                        // If this is not the master cell, mark as hidden
                        if (master.address !== cell.address) {
                            rowGrid.push({ value: null, colSpan: 1, rowSpan: 1, hidden: true });
                            continue;
                        }

                        // Get merge range from worksheet internal data
                        const worksheetInternal = worksheet as unknown as InternalWorksheet;
                        const range = worksheetInternal._merges?.[cell.address];
                        if (range) {
                            colSpan = range.right - range.left + 1;
                            rowSpan = range.bottom - range.top + 1;

                            // Mark all cells in the merge as hidden (except master)
                            for (let mr = range.top; mr <= range.bottom; mr++) {
                                for (let mc = range.left; mc <= range.right; mc++) {
                                    if (mr === r && mc === c) continue;
                                    hiddenCells.add(`${mr},${mc}`);
                                }
                            }
                        }
                    }

                    rowGrid.push({ value: finalVal, colSpan, rowSpan, hidden: false });
                }
                grid.push(rowGrid);
            }
            allSheetsData[sheetName] = grid;
        });

        return {
            workbookData: allSheetsData,
            sheetNames: names
        };
    }
};
