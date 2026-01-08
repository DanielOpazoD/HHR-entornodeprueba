import { describe, it, expect } from 'vitest';
import { DailyRecordSchema, parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';

describe('Handoff Checklist Synchronization Logic', () => {
    it('should include handoff checklist fields in DailyRecordSchema', () => {
        const rawData = {
            date: '2024-12-24',
            handoffDayChecklist: {
                escalaBraden: true,
                escalaRiesgoCaidas: false
            },
            handoffNightChecklist: {
                estadistica: true,
                conteoNoControlados: true,
                conteoNoControladosProximaFecha: '2024-12-25'
            },
            handoffNovedadesDayShift: 'Test Day',
            handoffNovedadesNightShift: 'Test Night'
        };

        const parsed = DailyRecordSchema.parse(rawData);

        expect(parsed.handoffDayChecklist).toEqual({
            escalaBraden: true,
            escalaRiesgoCaidas: false
        });
        expect(parsed.handoffNightChecklist?.conteoNoControlados).toBe(true);
        expect(parsed.handoffNovedadesDayShift).toBe('Test Day');
    });

    it('should recover handoff checklist fields in parseDailyRecordWithDefaults', () => {
        // Provide malformed data to force recovery logic
        const rawData = {
            date: '2024-12-24',
            beds: 'not-an-object', // This will fail strict parse
            handoffDayChecklist: { escalaBraden: true }
        };

        const parsed = parseDailyRecordWithDefaults(rawData, '2024-12-24');

        expect(parsed.handoffDayChecklist).toEqual({ escalaBraden: true });
        // The recovery logic should provide strings for novedades
        expect(typeof parsed.handoffNovedadesDayShift).toBe('string');
        expect(parsed.handoffNovedadesDayShift).toBe('');
    });
});
