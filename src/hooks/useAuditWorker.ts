import { useState, useEffect, useRef, useCallback } from 'react';
import { AuditLogEntry, GroupedAuditLogEntry, AuditStats, WorkerFilterParams } from '@/types/audit';

export interface AuditWorkerResults {
    filteredLogs: AuditLogEntry[];
    displayLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
    stats: AuditStats | null;
}

export const useAuditWorker = () => {
    const [results, setResults] = useState<AuditWorkerResults>({
        filteredLogs: [],
        displayLogs: [],
        stats: null
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        // Initialize worker using Vite's URL constructor pattern
        const worker = new Worker(
            new URL('../services/admin/audit.worker.ts', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'AUDIT_DATA_PROCESSED') {
                setResults(payload);
                setIsProcessing(false);
            } else if (type === 'ERROR') {
                console.error('[AuditWorker Hook] Error:', payload.message);
                setIsProcessing(false);
            }
        };

        workerRef.current = worker;

        return () => {
            worker.terminate();
        };
    }, []);

    const processData = useCallback((
        logs: AuditLogEntry[],
        params: WorkerFilterParams,
        actionLabels: Record<string, string>,
        criticalActions: string[]
    ) => {
        if (!workerRef.current) return;

        setIsProcessing(true);
        workerRef.current.postMessage({
            type: 'PROCESS_AUDIT_DATA',
            payload: { logs, params, actionLabels, criticalActions }
        });
    }, []);

    return {
        results,
        isProcessing,
        processData
    };
};
