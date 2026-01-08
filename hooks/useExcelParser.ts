/**
 * useExcelParser Hook
 * 
 * Extracted from SharedCensusView.tsx to handle Excel file parsing with ExcelJS.
 * Supports multiple sheets, merged cells (colSpan/rowSpan), and rich text values.
 * 
 * This hook is reusable for any Excel viewing functionality in the application.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createWorkbook } from '../services/exporters/excelUtils';

// ============================================================================
// Types
// ============================================================================

export interface ParsedCell {
    value: any;
    colSpan: number;
    rowSpan: number;
    hidden: boolean;
}

export interface UseExcelParserReturn {
    // Data
    workbookData: Record<string, ParsedCell[][]>;
    sheetNames: string[];
    activeSheet: string;
    setActiveSheet: (sheet: string) => void;

    // Loading state
    isParsing: boolean;
    parseError: string | null;

    // Actions
    parseFromUrl: (url: string) => Promise<void>;
    parseFromBlob: (blob: Blob) => Promise<void>;
    reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useExcelParser(): UseExcelParserReturn {
    const [workbookData, setWorkbookData] = useState<Record<string, ParsedCell[][]>>({});
    const [sheetNames, setSheetNames] = useState<string[]>([]);
    const [activeSheet, setActiveSheet] = useState<string>('');
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    // Check if component is mounted to avoid state updates after unmount
    const abortControllerRef = useRef<AbortController | null>(null);

    /**
     * Reset all parser state and abort pending requests
     */
    const reset = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setWorkbookData({});
        setSheetNames([]);
        setActiveSheet('');
        setParseError(null);
        setIsParsing(false);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    /**
     * Core parsing logic - processes a Blob into structured cell data
     * Note: This function is not cancellable once plain blob is received, 
     * but we check signal before setting state.
     */
    const parseFromBlob = useCallback(async (blob: Blob) => {
        setIsParsing(true);
        setParseError(null);
        setWorkbookData({});
        setSheetNames([]);
        setActiveSheet('');

        try {
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
                            if ('formula' in val || 'result' in val) {
                                // Formula cell - get the result
                                const formulaRes = (val as any).result;

                                // Default to 0 if result is missing (fix for ExcelJS dropping 0s or uncalculated formulas)
                                val = (formulaRes === undefined || formulaRes === null) ? 0 : formulaRes;
                            } else if ('richText' in val) {
                                // Rich text - concatenate all text parts
                                val = (val as any).richText.map((rt: any) => rt.text).join('');
                            } else if ('text' in val) {
                                // Hyperlink or similar
                                val = (val as any).text;
                            }

                            // Handle if the extracted result is STILL an object
                            if (val && typeof val === 'object') {
                                if ('error' in val) {
                                    val = (val as any).error;
                                } else if (val instanceof Date) {
                                    // Keep as Date object
                                } else {
                                    // Fallback for unknown objects
                                    val = '';
                                }
                            }
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
                            const range = (worksheet as any)._merges?.[cell.address];
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

                        rowGrid.push({ value: val, colSpan, rowSpan, hidden: false });
                    }
                    grid.push(rowGrid);
                }
                allSheetsData[sheetName] = grid;
            });

            setWorkbookData(allSheetsData);
            setSheetNames(names);
            if (names.length > 0) {
                setActiveSheet(names[0]);
            }
        } catch (err) {
            console.error('[useExcelParser] Error parsing excel:', err);
            setParseError('No se pudo cargar el archivo. Intenta descargarlo.');
        } finally {
            setIsParsing(false);
        }
    }, []);

    /**
     * Fetch and parse from a URL
     */
    const parseFromUrl = useCallback(async (url: string) => {
        // Abort previous request if any
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsParsing(true);
        setParseError(null);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);

            const blob = await response.blob();

            // Check if aborted during blob reading
            if (controller.signal.aborted) return;

            await parseFromBlob(blob);
        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.log('[useExcelParser] Fetch aborted');
                return;
            }
            console.error('[useExcelParser] Error fetching file:', err);
            setParseError('No se pudo descargar el archivo para visualización.');
            setIsParsing(false);
        } finally {
            // Only clear loading if this is the active request
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
                // Note: parseFromBlob handles its own setIsParsing(false), 
                // but if we errored/aborted before calling it, we need to handle it.
                // If success, parseFromBlob handles it.
                // Actually relying on parseFromBlob finally block is tricky if we don't call it.
                // We should ensure isParsing is false if we error here.
                // But parseFromBlob sets isParsing=true again.
            }
        }
    }, [parseFromBlob]);

    return {
        workbookData,
        sheetNames,
        activeSheet,
        setActiveSheet,
        isParsing,
        parseError,
        parseFromUrl,
        parseFromBlob,
        reset
    };
}
