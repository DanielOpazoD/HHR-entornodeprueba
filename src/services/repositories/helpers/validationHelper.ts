import { DailyRecord } from '@/types';
import { DailyRecordSchema, parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';

/**
 * Validates a DailyRecord against the strict schema.
 * If strict validation fails, attempts to salvage the data using defaults.
 * 
 * @param record - The record to validate
 * @param date - The date identifier for reporting/salvage
 * @returns A strictly validated DailyRecord
 * @throws Error if the record is completely corrupt and cannot be salvaged
 */
export const validateAndSalvageRecord = (record: DailyRecord, date: string): DailyRecord => {
    try {
        // 1. Attempt strict parse
        return DailyRecordSchema.parse(record);
    } catch (err) {
        console.warn(`[RepositoryValidation] Strict validation failed for ${date}, attempting salvage...`, err);

        // 2. Fallback to salvage logic
        const salvaged = parseDailyRecordWithDefaults(record, date);

        // 3. Re-validate the salvaged record to guarantee it meets the schema
        try {
            return DailyRecordSchema.parse(salvaged);
        } catch (finalErr) {
            console.error(`[RepositoryValidation] Salvage failed strict validation for ${date}:`, finalErr);
            throw new Error(`Crítico: El registro del día ${date} está corrupto y no pudo ser recuperado automáticamente.`);
        }
    }
};
