/**
 * Tests for zodSchemas.ts
 * Tests Zod validation schemas and safe parsing utilities
 */

import { describe, it, expect, vi } from 'vitest';
import {
    PatientDataSchema,
    DischargeDataSchema,
    TransferDataSchema,
    CMADataSchema,
    DailyRecordSchema,
    CudyrScoreSchema,
    DeviceInfoSchema,
    DeviceDetailsSchema,
    BedTypeSchema,
    safeParseDailyRecord,
    parseDailyRecordWithDefaults,
} from '@/schemas/zodSchemas';

describe('zodSchemas', () => {
    describe('BedTypeSchema', () => {
        it('should accept valid bed types', () => {
            expect(BedTypeSchema.parse('UTI')).toBe('UTI');
            expect(BedTypeSchema.parse('MEDIA')).toBe('MEDIA');
        });

        it('should reject invalid bed types', () => {
            expect(() => BedTypeSchema.parse('INVALID')).toThrow();
        });
    });

    describe('CudyrScoreSchema', () => {
        it('should parse valid CUDYR scores', () => {
            const score = CudyrScoreSchema.parse({
                changeClothes: 2,
                mobilization: 3,
                feeding: 1,
                elimination: 0,
                psychosocial: 0,
                surveillance: 0,
                vitalSigns: 0,
                fluidBalance: 0,
                oxygenTherapy: 0,
                airway: 0,
                proInterventions: 0,
                skinCare: 0,
                pharmacology: 0,
                invasiveElements: 0,
            });
            expect(score.changeClothes).toBe(2);
            expect(score.mobilization).toBe(3);
            expect(score.feeding).toBe(1);
        });

        it('should handle missing fields gracefully (resilience)', () => {
            const score = CudyrScoreSchema.parse({});
            expect(score.changeClothes).toBe(0);
            expect(score.mobilization).toBe(0);
        });

        it('should handle partial scores gracefully', () => {
            const score = CudyrScoreSchema.parse({ feeding: 2 });
            expect(score.feeding).toBe(2);
            expect(score.changeClothes).toBe(0);
        });
    });

    describe('DeviceInfoSchema', () => {
        it('should parse valid device info', () => {
            const info = DeviceInfoSchema.parse({
                installationDate: '2026-01-15',
                note: 'CVC inserted',
            });
            expect(info.installationDate).toBe('2026-01-15');
            expect(info.note).toBe('CVC inserted');
        });

        it('should accept empty object', () => {
            const info = DeviceInfoSchema.parse({});
            expect(info).toEqual({});
        });
    });

    describe('DeviceDetailsSchema', () => {
        it('should parse valid device details', () => {
            const details = DeviceDetailsSchema.parse({
                CUP: { installationDate: '2026-01-10' },
                CVC: { note: 'Right subclavian' },
            });
            expect(details.CUP?.installationDate).toBe('2026-01-10');
            expect(details.CVC?.note).toBe('Right subclavian');
        });

        it('should accept empty object', () => {
            const details = DeviceDetailsSchema.parse({});
            expect(details).toEqual({});
        });
    });

    describe('PatientDataSchema', () => {
        it('should parse valid patient data', () => {
            const patient = PatientDataSchema.parse({
                bedId: 'UTI-01',
                patientName: 'Juan Pérez',
                rut: '12.345.678-9',
                pathology: 'Neumonía',
                specialty: 'Med Interna',
                status: 'Estable',
                admissionDate: '2026-01-15',
                admissionTime: '10:00',
            });
            expect(patient.patientName).toBe('Juan Pérez');
            expect(patient.specialty).toBe('Med Interna');
        });

        it('should apply defaults for missing fields', () => {
            const patient = PatientDataSchema.parse({});
            expect(patient.bedId).toBe('');
            expect(patient.isBlocked).toBe(false);
            expect(patient.patientName).toBe('');
            expect(patient.devices).toEqual([]);
        });

        it('should parse patient with clinicalCrib', () => {
            const patient = PatientDataSchema.parse({
                bedId: 'M-01',
                patientName: 'Madre',
                clinicalCrib: {
                    bedId: 'M-01-CRIB',
                    patientName: 'Bebé',
                },
            });
            expect(patient.clinicalCrib?.patientName).toBe('Bebé');
        });

        it('should allow additional fields (passthrough)', () => {
            const patient = PatientDataSchema.parse({
                customField: 'custom value',
            });
            expect((patient as any).customField).toBe('custom value');
        });
    });

    describe('DischargeDataSchema', () => {
        it('should parse valid discharge data', () => {
            const discharge = DischargeDataSchema.parse({
                id: 'discharge-1',
                bedName: 'UTI-01',
                bedId: 'uti_01',
                patientName: 'Juan Pérez',
                status: 'Vivo',
                dischargeType: 'Domicilio (Habitual)',
            });
            expect(discharge.id).toBe('discharge-1');
            expect(discharge.status).toBe('Vivo');
        });

        it('should apply defaults for missing fields', () => {
            const discharge = DischargeDataSchema.parse({
                id: 'discharge-1',
            });
            expect(discharge.bedName).toBe('');
            expect(discharge.patientName).toBe('');
        });

        it('should accept both discharge statuses', () => {
            expect(DischargeDataSchema.parse({ id: '1', status: 'Vivo' }).status).toBe('Vivo');
            expect(DischargeDataSchema.parse({ id: '2', status: 'Fallecido' }).status).toBe('Fallecido');
        });
    });

    describe('TransferDataSchema', () => {
        it('should parse valid transfer data', () => {
            const transfer = TransferDataSchema.parse({
                id: 'transfer-1',
                bedName: 'M-05',
                patientName: 'María López',
                receivingCenter: 'Hospital Regional',
                evacuationMethod: 'Ambulancia',
            });
            expect(transfer.receivingCenter).toBe('Hospital Regional');
        });

        it('should apply defaults', () => {
            const transfer = TransferDataSchema.parse({ id: 'transfer-1' });
            expect(transfer.evacuationMethod).toBe('');
            expect(transfer.receivingCenter).toBe('');
        });
    });

    describe('CMADataSchema', () => {
        it('should parse valid CMA data', () => {
            const cma = CMADataSchema.parse({
                id: 'cma-1',
                patientName: 'Pedro García',
                diagnosis: 'Hernia inguinal',
                interventionType: 'Cirugía Mayor Ambulatoria',
            });
            expect(cma.interventionType).toBe('Cirugía Mayor Ambulatoria');
        });

        it('should apply defaults', () => {
            const cma = CMADataSchema.parse({ id: 'cma-1' });
            expect(cma.patientName).toBe('');
            expect(cma.diagnosis).toBe('');
        });
    });

    describe('DailyRecordSchema', () => {
        it('should parse valid daily record', () => {
            const record = DailyRecordSchema.parse({
                date: '2026-01-15',
                beds: {},
                discharges: [],
                transfers: [],
                cma: [],
            });
            expect(record.date).toBe('2026-01-15');
        });

        it('should apply defaults for missing arrays', () => {
            const record = DailyRecordSchema.parse({ date: '2026-01-15' });
            expect(record.beds).toEqual({});
            expect(record.discharges).toEqual([]);
            expect(record.transfers).toEqual([]);
            expect(record.nurses).toEqual(['', '']);
        });

        it('should parse record with beds', () => {
            const record = DailyRecordSchema.parse({
                date: '2026-01-15',
                beds: {
                    'uti_01': {
                        bedId: 'uti_01',
                        patientName: 'Test Patient',
                    },
                },
            });
            expect(record.beds['uti_01'].patientName).toBe('Test Patient');
        });

        it('should parse handoff checklists', () => {
            const record = DailyRecordSchema.parse({
                date: '2026-01-15',
                handoffDayChecklist: {
                    escalaBraden: true,
                    escalaRiesgoCaidas: false,
                },
            });
            expect(record.handoffDayChecklist?.escalaBraden).toBe(true);
        });
    });

    describe('safeParseDailyRecord', () => {
        it('should return parsed data for valid input', () => {
            const result = safeParseDailyRecord({
                date: '2026-01-15',
                beds: {},
            });
            expect(result).not.toBeNull();
            expect(result?.date).toBe('2026-01-15');
        });

        it('should return null for invalid input', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = safeParseDailyRecord({
                // Missing required 'date' field
                beds: 'invalid',
            });
            expect(result).toBeNull();
            consoleSpy.mockRestore();
        });

        it('should return null for completely invalid data', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = safeParseDailyRecord('not an object');
            expect(result).toBeNull();
            consoleSpy.mockRestore();
        });
    });

    describe('parseDailyRecordWithDefaults', () => {
        it('should parse valid data normally', () => {
            const result = parseDailyRecordWithDefaults(
                { date: '2026-01-15', beds: {} },
                '2026-01-15'
            );
            expect(result.date).toBe('2026-01-15');
        });

        it('should recover from partially invalid data', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = parseDailyRecordWithDefaults(
                { beds: 'invalid' }, // Invalid beds
                '2026-01-15'
            );
            expect(result.date).toBe('2026-01-15');
            expect(result.beds).toEqual({});
            consoleSpy.mockRestore();
        });

        it('should use docId as date fallback', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = parseDailyRecordWithDefaults({}, '2026-01-20');
            expect(result.date).toBe('2026-01-20');
            consoleSpy.mockRestore();
        });

        it('should preserve valid arrays', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = parseDailyRecordWithDefaults(
                {
                    date: '2026-01-15',
                    discharges: [{ id: '1', patientName: 'Test' }],
                },
                '2026-01-15'
            );
            expect(result.discharges).toHaveLength(1);
            consoleSpy.mockRestore();
        });

        it('should handle null input', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const result = parseDailyRecordWithDefaults(null, '2026-01-15');
            expect(result.date).toBe('2026-01-15');
            expect(result.beds).toEqual({});
            consoleSpy.mockRestore();
        });
    });
});
