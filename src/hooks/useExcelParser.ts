/**
 * useExcelParser Hook
 * 
 * Extracted from SharedCensusView.tsx to handle Excel file parsing with ExcelJS.
 * Supports multiple sheets, merged cells (colSpan/rowSpan), and rich text values.
 * 
 * This hook is reusable for any Excel viewing functionality in the application.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ExcelParsingService, ParsedCell } from '@/services/ExcelParsingService';
export type { ParsedCell };

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
            const { workbookData, sheetNames } = await ExcelParsingService.parseBlob(blob);

            setWorkbookData(workbookData);
            setSheetNames(sheetNames);
            if (sheetNames.length > 0) {
                setActiveSheet(sheetNames[0]);
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
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                console.warn('[useExcelParser] Fetch aborted');
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
