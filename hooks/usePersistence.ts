import { useCallback } from 'react';
import { useNotification } from '../context/UIContext';
import {
    logDailyRecordCreated,
    logDailyRecordDeleted
} from '../services/admin/auditService';
import {
    getPreviousDay,
    initializeDay,
    save,
    deleteDay
} from '../services/repositories/DailyRecordRepository';
import { generateDemoRecord } from '../services/utils/demoDataGenerator';
import { DailyRecord } from '../types';

interface UsePersistenceProps {
    currentDateString: string;
    markLocalChange: () => void;
    setRecord: (record: DailyRecord | null) => void;
}

/**
 * Hook to manage day lifecycle and persistence operations.
 * Extracts "Create", "Delete", and "Demo" logic from useDailyRecord.
 */
export const usePersistence = ({
    currentDateString,
    markLocalChange,
    setRecord
}: UsePersistenceProps) => {
    const { success, warning } = useNotification();

    /**
     * Creates a new daily record for the current date.
     */
    const createDay = useCallback(async (copyFromPrevious: boolean, specificDate?: string) => {
        let prevDate: string | undefined = undefined;

        if (copyFromPrevious) {
            if (specificDate) {
                prevDate = specificDate;
            } else {
                const prevRecord = await getPreviousDay(currentDateString);
                if (prevRecord) {
                    prevDate = prevRecord.date;
                } else {
                    warning("No se encontró registro anterior", "No hay datos del día previo para copiar.");
                    return;
                }
            }
        }

        const newRecord = await initializeDay(currentDateString, prevDate);
        markLocalChange();
        setRecord(newRecord);

        const sourceMsg = prevDate ? `Copiado desde ${prevDate}` : 'Registro en blanco';
        success('Día creado', sourceMsg);

        logDailyRecordCreated(currentDateString, copyFromPrevious ? (specificDate || 'previous_day') : 'blank');
    }, [currentDateString, warning, success, markLocalChange, setRecord]);

    /**
     * Generates demo data for testing.
     */
    const generateDemo = useCallback(async () => {
        const demoRecord = generateDemoRecord(currentDateString);
        await save(demoRecord);
        markLocalChange();
        setRecord({ ...demoRecord });
    }, [currentDateString, markLocalChange, setRecord]);

    /**
     * Deletes the current day's record.
     */
    const resetDay = useCallback(async () => {
        await deleteDay(currentDateString);
        setRecord(null);
        success('Registro eliminado', 'El registro del día ha sido eliminado.');

        logDailyRecordDeleted(currentDateString);
    }, [currentDateString, setRecord, success]);

    return {
        createDay,
        generateDemo,
        resetDay
    };
};
