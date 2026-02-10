import { describe, it, expect } from 'vitest';
import { initializeDay } from '@/services/repositories/DailyRecordRepository';
import { PatientData, Specialty, PatientStatus } from '@/types';
import * as IndexedDBService from '@/services/storage/indexedDBService';
import * as FirestoreService from '@/services/storage/firestoreService';
import { vi } from 'vitest';

// Unmock the repository so we test the REAL logic
vi.unmock('../../services/repositories/DailyRecordRepository');

// Mock services
vi.mock('../../services/storage/indexedDBService');
vi.mock('../../services/storage/firestoreService');
vi.mock('../../services/storage/legacyFirebaseService', () => ({
    getLegacyRecord: vi.fn().mockResolvedValue(null),
    getLegacyNurseCatalog: vi.fn().mockResolvedValue([]),
    getLegacyTensCatalog: vi.fn().mockResolvedValue([]),
}));

describe('CIE-10 Copy Bug Reproduction', () => {
    it('should copy CIE-10 fields from previous day', async () => {
        const prevDate = '2026-01-17';
        const nextDate = '2026-01-18';

        const mockPatient: PatientData = {
            bedId: 'R1',
            patientName: 'Test Patient',
            rut: '12345678-9',
            age: '30',
            pathology: 'Test Pathology',
            cie10Code: 'A00.0',
            cie10Description: 'Cólera debido a Vibrio cholerae 01, biotipo cholerae',
            specialty: Specialty.MEDICINA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-01-10',
            hasWristband: true,
            devices: [],
            surgicalComplication: false,
            isUPC: false,
            bedMode: 'Cama',
            hasCompanionCrib: false,
            isBlocked: false,
            cudyr: { changeClothes: 1, mobilization: 1 } as any
        };

        const mockPrevRecord = {
            date: prevDate,
            beds: {
                'R1': mockPatient
            },
            discharges: [],
            transfers: [],
            cma: [],
            lastUpdated: new Date().toISOString()
        };

        // Configuration for mocks
        (IndexedDBService.getRecordForDate as any).mockImplementation(async (date: string) => {
            if (date === prevDate) return mockPrevRecord;
            if (date === nextDate) return null;
            return null;
        });
        (FirestoreService.getRecordFromFirestore as any).mockResolvedValue(null);
        (IndexedDBService.saveRecord as any).mockResolvedValue(undefined);

        // Execute initialization
        const newRecord = await initializeDay(nextDate, prevDate);

        // Verify
        const copiedPatient = newRecord.beds['R1'];
        expect(copiedPatient).toBeDefined();
        expect(copiedPatient.patientName).toBe('Test Patient');
        expect(copiedPatient.cie10Code).toBe('A00.0');
        expect(copiedPatient.cie10Description).toBe('Cólera debido a Vibrio cholerae 01, biotipo cholerae');
        expect(copiedPatient.cudyr).toBeUndefined();
    });

    it('should copy CIE-10 fields for nested clinical cribs', async () => {
        const prevDate = '2026-01-17';
        const nextDate = '2026-01-18';

        const mockCribPatient: PatientData = {
            bedId: 'R2',
            patientName: 'Sick Baby',
            rut: '23456789-0',
            age: '0',
            pathology: 'Neonatal Jaundice',
            cie10Code: 'P55',
            cie10Description: 'Enfermedad hemolítica del recién nacido',
            specialty: Specialty.PEDIATRIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-01-15',
            hasWristband: true,
            devices: [],
            surgicalComplication: false,
            isUPC: false,
            bedMode: 'Cuna',
            hasCompanionCrib: false,
            isBlocked: false,
            cudyr: { changeClothes: 1, mobilization: 1 } as any
        };

        const mockParentPatient: PatientData = {
            bedId: 'R2',
            patientName: 'Mother',
            rut: '12345678-9',
            age: '25',
            pathology: 'Postpartum',
            specialty: Specialty.GINECOBSTETRICIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-01-15',
            hasWristband: true,
            devices: [],
            surgicalComplication: false,
            isUPC: false,
            bedMode: 'Cama',
            hasCompanionCrib: false,
            isBlocked: false,
            clinicalCrib: mockCribPatient,
            cudyr: { changeClothes: 2, mobilization: 2 } as any
        };

        const mockPrevRecord = {
            date: prevDate,
            beds: {
                'R2': mockParentPatient
            },
            discharges: [],
            transfers: [],
            cma: [],
            lastUpdated: new Date().toISOString()
        };

        // Configuration for mocks
        (IndexedDBService.getRecordForDate as any).mockImplementation(async (date: string) => {
            if (date === prevDate) return mockPrevRecord;
            return null;
        });
        (FirestoreService.getRecordFromFirestore as any).mockResolvedValue(null);

        // Execute initialization
        const newRecord = await initializeDay(nextDate, prevDate);

        // Verify nested patient
        const copiedParent = newRecord.beds['R2'];
        expect(copiedParent).toBeDefined();
        const copiedCrib = copiedParent.clinicalCrib;

        expect(copiedCrib).toBeDefined();
        expect(copiedCrib?.patientName).toBe('Sick Baby');
        expect(copiedCrib?.cie10Code).toBe('P55');
        expect(copiedCrib?.cie10Description).toBe('Enfermedad hemolítica del recién nacido');

        // CRITICAL: Verify CUDYR reset for BOTH
        expect(copiedParent.cudyr).toBeUndefined();
        expect(copiedCrib?.cudyr).toBeUndefined();
    });
});
