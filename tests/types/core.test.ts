/**
 * Tests for core.ts type definitions
 * Tests enums and type structure
 */

import { describe, it, expect } from 'vitest';
import {
    BedType,
    Specialty,
    PatientStatus,
    PatientData,
    DischargeData,
    TransferData,
    CMAData,
    DailyRecord,
    Statistics,
    CudyrScore,
} from '@/types/core';

describe('core types', () => {
    describe('BedType enum', () => {
        it('should have UTI type', () => {
            expect(BedType.UTI).toBe('UTI');
        });

        it('should have MEDIA type', () => {
            expect(BedType.MEDIA).toBe('MEDIA');
        });

        it('should have exactly 2 bed types', () => {
            const values = Object.values(BedType);
            expect(values).toHaveLength(2);
        });
    });

    describe('Specialty enum', () => {
        it('should have Medicina Interna', () => {
            expect(Specialty.MEDICINA).toBe('Med Interna');
        });

        it('should have Cirugía', () => {
            expect(Specialty.CIRUGIA).toBe('Cirugía');
        });

        it('should have Ginecobstetricia', () => {
            expect(Specialty.GINECOBSTETRICIA).toBe('Ginecobstetricia');
        });

        it('should have Pediatría', () => {
            expect(Specialty.PEDIATRIA).toBe('Pediatría');
        });

        it('should have Psiquiatría', () => {
            expect(Specialty.PSIQUIATRIA).toBe('Psiquiatría');
        });

        it('should have Otro', () => {
            expect(Specialty.OTRO).toBe('Otro');
        });

        it('should have empty option', () => {
            expect(Specialty.EMPTY).toBe('');
        });
    });

    describe('PatientStatus enum', () => {
        it('should have Grave status', () => {
            expect(PatientStatus.GRAVE).toBe('Grave');
        });

        it('should have De cuidado status', () => {
            expect(PatientStatus.DE_CUIDADO).toBe('De cuidado');
        });

        it('should have Estable status', () => {
            expect(PatientStatus.ESTABLE).toBe('Estable');
        });

        it('should have empty option', () => {
            expect(PatientStatus.EMPTY).toBe('');
        });

        it('should have exactly 4 statuses', () => {
            const values = Object.values(PatientStatus);
            expect(values).toHaveLength(4);
        });
    });

    describe('PatientData interface structure', () => {
        it('should allow creating valid patient data', () => {
            const patient: PatientData = {
                bedId: 'R1',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                patientName: 'Juan Pérez',
                rut: '12.345.678-9',
                pathology: 'Neumonía',
                specialty: Specialty.MEDICINA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2026-01-15',
                admissionTime: '10:00',
                age: '45',
            };
            expect(patient.patientName).toBe('Juan Pérez');
            expect(patient.specialty).toBe('Med Interna');
        });

        it('should allow blocked bed', () => {
            const bed: PatientData = {
                bedId: 'R2',
                isBlocked: true,
                blockedReason: 'Mantención',
                bedMode: 'Cama',
                hasCompanionCrib: false,
                patientName: '',
                rut: '',
                pathology: '',
                specialty: Specialty.EMPTY,
                status: PatientStatus.EMPTY,
                admissionDate: '',
                admissionTime: '',
                age: '',
            };
            expect(bed.isBlocked).toBe(true);
            expect(bed.blockedReason).toBe('Mantención');
        });

        it('should allow patient with CUDYR score', () => {
            const patient: PatientData = {
                bedId: 'H1C1',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                patientName: 'María López',
                rut: '11.111.111-1',
                pathology: 'Test',
                specialty: Specialty.CIRUGIA,
                status: PatientStatus.DE_CUIDADO,
                admissionDate: '2026-01-10',
                admissionTime: '08:00',
                age: '60',
                cudyr: {
                    changeClothes: 2,
                    mobilization: 3,
                    feeding: 1,
                    elimination: 2,
                    psychosocial: 1,
                    surveillance: 2,
                    vitalSigns: 2,
                    fluidBalance: 1,
                    oxygenTherapy: 0,
                    airway: 0,
                    proInterventions: 1,
                    skinCare: 2,
                    pharmacology: 2,
                    invasiveElements: 1,
                },
            };
            expect(patient.cudyr?.changeClothes).toBe(2);
            expect(patient.cudyr?.mobilization).toBe(3);
        });
    });

    describe('DischargeData structure', () => {
        it('should allow Vivo status', () => {
            const discharge: DischargeData = {
                id: 'discharge-1',
                bedName: 'R1',
                bedId: 'R1',
                bedType: 'UTI',
                patientName: 'Test Patient',
                rut: '12.345.678-9',
                diagnosis: 'Recuperado',
                time: '10:00',
                status: 'Vivo',
            };
            expect(discharge.status).toBe('Vivo');
        });

        it('should allow Fallecido status', () => {
            const discharge: DischargeData = {
                id: 'discharge-2',
                bedName: 'H1C1',
                bedId: 'H1C1',
                bedType: 'MEDIA',
                patientName: 'Test Patient',
                rut: '11.111.111-1',
                diagnosis: 'Complicaciones',
                time: '15:00',
                status: 'Fallecido',
            };
            expect(discharge.status).toBe('Fallecido');
        });
    });

    describe('TransferData structure', () => {
        it('should include receiving center', () => {
            const transfer: TransferData = {
                id: 'transfer-1',
                bedName: 'UTI-01',
                bedId: 'R1',
                bedType: 'UTI',
                patientName: 'Transfer Patient',
                rut: '12.345.678-9',
                diagnosis: 'Requiere cirugía mayor',
                time: '12:00',
                evacuationMethod: 'Ambulancia',
                receivingCenter: 'Hospital Regional',
            };
            expect(transfer.receivingCenter).toBe('Hospital Regional');
            expect(transfer.evacuationMethod).toBe('Ambulancia');
        });
    });

    describe('CMAData structure', () => {
        it('should include intervention type', () => {
            const cma: CMAData = {
                id: 'cma-1',
                bedName: 'CMA',
                patientName: 'CMA Patient',
                rut: '12.345.678-9',
                age: '50',
                diagnosis: 'Hernia inguinal',
                specialty: 'Cirugía',
                interventionType: 'Cirugía Mayor Ambulatoria',
            };
            expect(cma.interventionType).toBe('Cirugía Mayor Ambulatoria');
        });
    });

    describe('DailyRecord structure', () => {
        it('should include all required fields', () => {
            const record: DailyRecord = {
                date: '2026-01-15',
                beds: {},
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: new Date().toISOString(),
                nurses: ['Enfermera 1', 'Enfermera 2'],
                activeExtraBeds: [],
            };
            expect(record.date).toBe('2026-01-15');
            expect(record.nurses).toHaveLength(2);
        });
    });

    describe('Statistics structure', () => {
        it('should include capacity metrics', () => {
            const stats: Statistics = {
                occupiedBeds: 15,
                occupiedCribs: 2,
                clinicalCribsCount: 1,
                companionCribs: 1,
                totalCribsUsed: 2,
                totalHospitalized: 17,
                blockedBeds: 1,
                serviceCapacity: 18,
                availableCapacity: 2,
            };
            expect(stats.occupiedBeds).toBe(15);
            expect(stats.serviceCapacity).toBe(18);
        });
    });
});
