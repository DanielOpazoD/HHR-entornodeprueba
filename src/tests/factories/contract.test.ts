import { describe, it, expect } from 'vitest';
import {
    CudyrScoreSchema,
    PatientDataSchema,
    DailyRecordSchema,
    DischargeDataSchema,
    TransferDataSchema,
    CMADataSchema,
    ClinicalEventSchema
} from '@/schemas/zodSchemas';
import { DataFactory } from './DataFactory';

describe('DataFactory Contract Tests', () => {
    it('generates valid CUDYR score', () => {
        const mock = DataFactory.createMockCudyr();
        const result = CudyrScoreSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid PatientData', () => {
        const mock = DataFactory.createMockPatient('R1');
        const result = PatientDataSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid DailyRecord', () => {
        const mock = DataFactory.createMockDailyRecord('2025-01-08');
        const result = DailyRecordSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid DischargeData', () => {
        const mock = DataFactory.createMockDischarge();
        const result = DischargeDataSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid TransferData', () => {
        const mock = DataFactory.createMockTransfer();
        const result = TransferDataSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid CMAData', () => {
        const mock = DataFactory.createMockCMA();
        const result = CMADataSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });

    it('generates valid ClinicalEvent', () => {
        const mock = DataFactory.createMockClinicalEvent();
        const result = ClinicalEventSchema.safeParse(mock);
        if (!result.success) console.error(result.error);
        expect(result.success).toBe(true);
    });
});
