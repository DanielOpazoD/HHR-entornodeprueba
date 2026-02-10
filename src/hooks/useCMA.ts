import { useMemo, useCallback, useRef, useEffect } from 'react';
import { DailyRecord, CMAData } from '@/types';
import { capitalizeWords } from '@/utils/stringUtils';
import { formatRut, isValidRut, isPassportFormat } from '@/utils/rutUtils';

/**
 * Normalize CMA patient data fields
 */
const normalizePatientData = (data: Partial<CMAData>): Partial<CMAData> => {
    const normalized = { ...data };

    // Capitalize patient name
    if (normalized.patientName && typeof normalized.patientName === 'string') {
        normalized.patientName = capitalizeWords(normalized.patientName.trim());
    }

    // Format RUT (if not passport)
    if (normalized.rut && typeof normalized.rut === 'string') {
        const trimmedRut = normalized.rut.trim();
        if (!isPassportFormat(trimmedRut)) {
            const formatted = formatRut(trimmedRut);
            if (isValidRut(formatted)) {
                normalized.rut = formatted;
            }
        }
    }

    return normalized;
};

export const useCMA = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void
) => {
    const recordRef = useRef(record);
    useEffect(() => { recordRef.current = record; }, [record]);

    const addCMA = useCallback((data: Omit<CMAData, 'id' | 'timestamp'>) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        // Normalize data before saving
        const normalizedData = normalizePatientData(data);

        const newEntry: CMAData = {
            ...data,
            ...normalizedData,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
        };

        const currentList = currentRecord.cma || [];

        saveAndUpdate({
            ...currentRecord,
            cma: [...currentList, newEntry]
        });
    }, [saveAndUpdate]);

    const deleteCMA = useCallback((id: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const currentList = currentRecord.cma || [];
        saveAndUpdate({
            ...currentRecord,
            cma: currentList.filter(item => item.id !== id)
        });
    }, [saveAndUpdate]);

    const updateCMA = useCallback((id: string, updates: Partial<CMAData>) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        // Normalize data before saving
        const normalizedUpdates = normalizePatientData(updates);

        const currentList = currentRecord.cma || [];
        saveAndUpdate({
            ...currentRecord,
            cma: currentList.map(item =>
                item.id === id ? { ...item, ...normalizedUpdates } : item
            )
        });
    }, [saveAndUpdate]);

    return useMemo(() => ({
        addCMA,
        deleteCMA,
        updateCMA
    }), [addCMA, deleteCMA, updateCMA]);
};
