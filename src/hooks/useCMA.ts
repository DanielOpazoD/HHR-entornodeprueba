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

    const addCMA = (data: Omit<CMAData, 'id' | 'timestamp'>) => {
        if (!record) return;

        // Normalize data before saving
        const normalizedData = normalizePatientData(data);

        const newEntry: CMAData = {
            ...data,
            ...normalizedData,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
        };

        const currentList = record.cma || [];

        saveAndUpdate({
            ...record,
            cma: [...currentList, newEntry]
        });
    };

    const deleteCMA = (id: string) => {
        if (!record) return;
        const currentList = record.cma || [];
        saveAndUpdate({
            ...record,
            cma: currentList.filter(item => item.id !== id)
        });
    };

    const updateCMA = (id: string, updates: Partial<CMAData>) => {
        if (!record) return;

        // Normalize data before saving
        const normalizedUpdates = normalizePatientData(updates);

        const currentList = record.cma || [];
        saveAndUpdate({
            ...record,
            cma: currentList.map(item =>
                item.id === id ? { ...item, ...normalizedUpdates } : item
            )
        });
    };

    return {
        addCMA,
        deleteCMA,
        updateCMA
    };
};
