import { describe, it, expect } from 'vitest';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { PatientData, Specialty, PatientStatus } from '@/types';
import { BEDS } from '@/constants';

describe('statsCalculator.ts - Critical Calculations', () => {
    describe('calculateStats', () => {
        const createEmptyMockBeds = (): Record<string, PatientData> => {
            const beds: Record<string, PatientData> = {};
            BEDS.forEach(bed => {
                beds[bed.id] = {
                    bedId: bed.id,
                    isBlocked: false,
                    bedMode: 'Cama',
                    hasCompanionCrib: false,
                    patientName: '',
                    rut: '',
                    age: '',
                    pathology: '',
                    specialty: Specialty.MEDICINA,
                    status: PatientStatus.ESTABLE,
                    admissionDate: '2025-01-01',
                    hasWristband: false,
                    devices: [],
                    surgicalComplication: false,
                    isUPC: false
                };
            });
            return beds;
        };

        it('should return zero stats for empty beds', () => {
            const emptyBeds = createEmptyMockBeds();
            const stats = calculateStats(emptyBeds);

            expect(stats.occupiedBeds).toBe(0);
            expect(stats.occupiedCribs).toBe(0);
            expect(stats.totalHospitalized).toBe(0);
            expect(stats.blockedBeds).toBe(0);
            expect(stats.companionCribs).toBe(0);
            expect(stats.clinicalCribsCount).toBe(0);
        });

        it('should count occupied beds correctly', () => {
            const beds = createEmptyMockBeds();

            // Occupy 3 beds using REAL IDs from BEDS constant
            const ids = BEDS.map(b => b.id);
            beds[ids[0]].patientName = 'Juan Pérez';
            beds[ids[1]].patientName = 'María González';
            beds[ids[2]].patientName = 'Pedro López';

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(3);
            expect(stats.totalHospitalized).toBe(3);
        });

        it('should count blocked beds correctly', () => {
            const beds = createEmptyMockBeds();

            // Block 2 beds
            const ids = BEDS.map(b => b.id);
            beds[ids[0]].isBlocked = true;
            beds[ids[1]].isBlocked = true;

            const stats = calculateStats(beds);

            expect(stats.blockedBeds).toBe(2);
            expect(stats.availableCapacity).toBe(stats.serviceCapacity - 2);
        });

        it('should count clinical cribs (Cuna mode) correctly', () => {
            const beds = createEmptyMockBeds();

            // Patient in Cuna mode
            const ids = BEDS.map(b => b.id);
            beds[ids[0]].patientName = 'Bebé López';
            beds[ids[0]].bedMode = 'Cuna';

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(1);
            expect(stats.clinicalCribsCount).toBe(1); // Main is Cuna = clinical crib
            expect(stats.totalCribsUsed).toBe(1);
        });

        it('should count nested clinical cribs correctly', () => {
            const beds = createEmptyMockBeds();

            // Mother in bed + baby in clinical crib
            const ids = BEDS.map(b => b.id);
            beds[ids[0]].patientName = 'Madre López';
            beds[ids[0]].bedMode = 'Cama';
            beds[ids[0]].clinicalCrib = {
                bedId: `${ids[0]}-crib`,
                isBlocked: false,
                bedMode: 'Cuna',
                hasCompanionCrib: false,
                patientName: 'Bebé López',
                rut: '',
                age: '0',
                pathology: 'RN',
                specialty: Specialty.PEDIATRIA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2025-01-01',
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            };

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(1); // Mother
            expect(stats.occupiedCribs).toBe(1); // Baby (nested)
            expect(stats.totalHospitalized).toBe(2); // Mother + Baby
            expect(stats.clinicalCribsCount).toBe(1); // One clinical crib
            expect(stats.totalCribsUsed).toBe(1); // One physical crib
        });

        it('should count companion cribs (RN Sano) correctly', () => {
            const beds = createEmptyMockBeds();

            // Mother with companion crib
            const ids = BEDS.map(b => b.id);
            beds[ids[0]].patientName = 'Madre González';
            beds[ids[0]].hasCompanionCrib = true;

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(1);
            expect(stats.companionCribs).toBe(1);
            expect(stats.totalCribsUsed).toBe(1); // Companion uses a crib resource
        });

        it('should handle complex scenario: mix of beds, cribs, blocked', () => {
            const beds = createEmptyMockBeds();

            const ids = BEDS.map(b => b.id);
            // 1. Regular patient
            beds[ids[0]].patientName = 'Paciente Regular';

            // 2. Blocked bed
            beds[ids[1]].isBlocked = true;

            // 3. Mother with nested clinical crib
            beds[ids[2]].patientName = 'Madre con Bebé';
            beds[ids[2]].clinicalCrib = {
                bedId: `${ids[2]}-crib`,
                isBlocked: false,
                bedMode: 'Cuna',
                hasCompanionCrib: false,
                patientName: 'Bebé Clínico',
                rut: '',
                age: '0',
                pathology: 'RN',
                specialty: Specialty.PEDIATRIA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2025-01-01',
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            };

            // 4. Mother with companion crib (RN Sano)
            // Use something like 'H1C1'
            const h1c1 = ids.find(id => id === 'H1C1') || ids[3];
            beds[h1c1].patientName = 'Madre con RN Sano';
            beds[h1c1].hasCompanionCrib = true;

            // 5. Patient in Cuna mode
            const h2c1 = ids.find(id => id === 'H2C1') || ids[4];
            beds[h2c1].patientName = 'Bebé en Cuna';
            beds[h2c1].bedMode = 'Cuna';

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(4);
            expect(stats.totalHospitalized).toBe(5);
            expect(stats.blockedBeds).toBe(1);
            expect(stats.companionCribs).toBe(1);
            expect(stats.clinicalCribsCount).toBe(2);
            expect(stats.totalCribsUsed).toBe(3);
        });

        it('should not count blocked beds in occupancy calculations', () => {
            const beds = createEmptyMockBeds();
            const ids = BEDS.map(b => b.id);

            // Blocked bed with patient name (should not count as occupied)
            beds[ids[0]].isBlocked = true;
            beds[ids[0]].patientName = 'This should not count';

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(0);
            expect(stats.blockedBeds).toBe(1);
        });

        // === EDGE CASES ===

        it('should handle all beds blocked scenario', () => {
            const beds = createEmptyMockBeds();

            // Block ALL beds
            BEDS.forEach(bed => {
                beds[bed.id].isBlocked = true;
            });

            const stats = calculateStats(beds);

            expect(stats.blockedBeds).toBe(BEDS.length);
            expect(stats.occupiedBeds).toBe(0);
            expect(stats.availableCapacity).toBe(stats.serviceCapacity - BEDS.length);
        });

        it('should handle Cuna mode with empty patient name (resource usage)', () => {
            const beds = createEmptyMockBeds();
            const ids = BEDS.map(b => b.id);

            // Empty bed in Cuna mode - uses physical crib but no patient
            beds[ids[0]].bedMode = 'Cuna';
            beds[ids[0]].patientName = '';

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(0);
            expect(stats.clinicalCribsCount).toBe(0); // No clinical patient
            expect(stats.totalCribsUsed).toBe(1); // But crib resource is used
        });

        it('should calculate full capacity correctly', () => {
            const beds = createEmptyMockBeds();

            // Occupy ALL beds
            BEDS.forEach(bed => {
                beds[bed.id].patientName = `Patient in ${bed.id}`;
            });

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(BEDS.length);
            expect(stats.totalHospitalized).toBe(BEDS.length);
            expect(stats.availableCapacity).toBe(stats.serviceCapacity - BEDS.length);
        });

        it('should handle Cuna mode bed with nested clinical crib (double crib)', () => {
            const beds = createEmptyMockBeds();
            const ids = BEDS.map(b => b.id);

            // Baby in Cuna mode + nested clinical crib (rare but possible)
            beds[ids[0]].patientName = 'Bebé Principal';
            beds[ids[0]].bedMode = 'Cuna';
            beds[ids[0]].clinicalCrib = {
                bedId: `${ids[0]}-crib`,
                isBlocked: false,
                bedMode: 'Cuna',
                hasCompanionCrib: false,
                patientName: 'Bebé Secundario',
                rut: '',
                age: '0',
                pathology: 'RN',
                specialty: Specialty.PEDIATRIA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2025-01-01',
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            };

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(1);
            expect(stats.occupiedCribs).toBe(1);
            expect(stats.totalHospitalized).toBe(2);
            expect(stats.clinicalCribsCount).toBe(2); // Main Cuna + Nested
            expect(stats.totalCribsUsed).toBe(2); // Two physical cribs
        });

        it('should count multiple companion cribs across different beds', () => {
            const beds = createEmptyMockBeds();
            const ids = BEDS.map(b => b.id);

            // Three mothers with companion cribs
            beds[ids[0]].patientName = 'Madre 1';
            beds[ids[0]].hasCompanionCrib = true;

            beds[ids[1]].patientName = 'Madre 2';
            beds[ids[1]].hasCompanionCrib = true;

            beds[ids[2]].patientName = 'Madre 3';
            beds[ids[2]].hasCompanionCrib = true;

            const stats = calculateStats(beds);

            expect(stats.occupiedBeds).toBe(3);
            expect(stats.companionCribs).toBe(3);
            expect(stats.totalCribsUsed).toBe(3);
        });
    });
});
