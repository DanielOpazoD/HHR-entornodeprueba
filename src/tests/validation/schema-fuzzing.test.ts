import { describe, it, expect } from 'vitest';
import {
    safeParseDailyRecord,
    parseDailyRecordWithDefaults
} from '@/schemas/zodSchemas';

describe('Data Schema Resilience (Fuzzing)', () => {
    it('should fail gracefully on totally corrupted data', () => {
        const corrupted = {
            date: 12345, // Should be string
            beds: "not-an-object",
            discharges: null
        };

        const result = safeParseDailyRecord(corrupted);
        expect(result).toBeNull();
    });

    it('should recover basic structure using parseDailyRecordWithDefaults', () => {
        const partiallyCorrupted = {
            date: '2024-12-25',
            beds: 'INVALID_DATA',
            nurses: 'NOT_AN_ARRAY'
        };

        const result = parseDailyRecordWithDefaults(partiallyCorrupted, '2024-12-25');

        expect(result.date).toBe('2024-12-25');
        expect(result.beds).toEqual({}); // Recovered default
        expect(Array.isArray(result.nurses)).toBe(true); // Recovered default
    });

    it('should handle unexpected enum values in PatientData', () => {
        const invalidPatient = {
            date: '2024-12-25',
            beds: {
                'BED_01': {
                    patientName: 'CORRUPT TEST',
                    status: 'SUPER_GRAVE', // Invalid enum
                    biologicalSex: 'ROBOT' // Invalid enum
                }
            }
        };

        const result = safeParseDailyRecord(invalidPatient);
        // Currently safeParse returns null if ANY part fails
        expect(result).toBeNull();
    });

    it('should passthrough extra fields (forward compatibility)', () => {
        const dataWithFutureFields = {
            date: '2024-12-25',
            beds: {},
            newFeatureFlag: true,
            v4Metadata: { region: 'hospital' }
        };

        const result = safeParseDailyRecord(dataWithFutureFields);
        expect(result).not.toBeNull();
        expect((result as any).newFeatureFlag).toBe(true);
    });
});
