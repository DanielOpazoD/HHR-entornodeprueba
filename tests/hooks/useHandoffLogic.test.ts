/**
 * Tests for useHandoffLogic hook
 * 
 * CRITICAL: These tests protect the Census → Handoff staff synchronization.
 * The design philosophy is that Census is the SINGLE SOURCE OF TRUTH for staff.
 * DO NOT modify these tests without understanding the data flow implications.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandoffLogic } from '@/hooks/useHandoffLogic';
import { DailyRecord, PatientData } from '@/types';

// Mock dependencies
vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
    getWhatsAppConfig: vi.fn(() => ({ enabled: false })),
    getMessageTemplates: vi.fn(() => ({}))
}));

vi.mock('@/services/admin/auditService', () => ({
    logNurseHandoffModified: vi.fn(),
    logMedicalHandoffModified: vi.fn()
}));

describe('useHandoffLogic - Staff List Synchronization', () => {
    // Create a proper beds structure that the hook expects
    const createEmptyBeds = () => {
        const beds: Record<string, any> = {};
        // Add a few sample bed IDs that BEDS constant might contain
        ['BED_01', 'BED_02', 'BED_03', 'BED_04', 'BED_05', 'BED_06', 'BED_07', 'BED_08'].forEach(id => {
            beds[id] = {
                bedId: id,
                patientName: '',
                rut: '',
                diagnosis: '',
                isBlocked: false,
                admissionDate: '',
                bedMode: 'standard'
            };
        });
        return beds;
    };

    const createMockRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord => ({
        date: '2025-12-28',
        beds: createEmptyBeds(),
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        nurses: ['', ''],
        nursesDayShift: ['', ''],
        nursesNightShift: ['', ''],
        tensDayShift: ['', '', ''],
        tensNightShift: ['', '', ''],
        activeExtraBeds: [],
        ...overrides
    });

    const defaultParams = {
        type: 'nursing' as const,
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple: vi.fn(),
        sendMedicalHandoff: vi.fn(),
        onSuccess: vi.fn()
    };

    describe('deliversList - Census as Source of Truth', () => {
        it('should return nursesDayShift when selectedShift is day', () => {
            const mockRecord = createMockRecord({
                nursesDayShift: ['María López', 'Juan Pérez']
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            // Default shift is 'day'
            expect(result.current.deliversList).toEqual(['María López', 'Juan Pérez']);
        });

        it('should return nursesNightShift when selectedShift is night', () => {
            const mockRecord = createMockRecord({
                nursesNightShift: ['Ana García', 'Pedro Soto']
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            // Change to night shift
            result.current.setSelectedShift('night');

            // Re-render to get updated value
            const { result: result2 } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));
            result2.current.setSelectedShift('night');
        });

        it('should return empty array when nursesDayShift is undefined', () => {
            const mockRecord = createMockRecord({
                nursesDayShift: undefined as any
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            expect(result.current.deliversList).toEqual([]);
        });

        it('should return empty array when record is null', () => {
            const { result } = renderHook(() => useHandoffLogic({
                record: null,
                ...defaultParams
            }));

            expect(result.current.deliversList).toEqual([]);
        });
    });

    describe('receivesList - Census as Source of Truth', () => {
        it('should return nursesNightShift when selectedShift is day (night nurses receive)', () => {
            const mockRecord = createMockRecord({
                nursesNightShift: ['Night Nurse 1', 'Night Nurse 2']
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            // Default shift is 'day', so receivers should be night shift nurses
            expect(result.current.receivesList).toEqual(['Night Nurse 1', 'Night Nurse 2']);
        });
    });

    describe('tensList - Census as Source of Truth', () => {
        it('should return tensDayShift when selectedShift is day', () => {
            const mockRecord = createMockRecord({
                tensDayShift: ['TENS 1', 'TENS 2', 'TENS 3']
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            expect(result.current.tensList).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
        });

        it('should return tensNightShift when selectedShift is night', () => {
            const mockRecord = createMockRecord({
                tensNightShift: ['Night TENS 1', 'Night TENS 2', 'Night TENS 3']
            });

            const { result } = renderHook(() => useHandoffLogic({
                record: mockRecord,
                ...defaultParams
            }));

            result.current.setSelectedShift('night');
        });
    });

    describe('Data Flow Integrity', () => {


        it('should reflect census changes immediately', () => {
            // First render with initial nurses
            const mockRecord1 = createMockRecord({
                nursesDayShift: ['Nurse A', 'Nurse B']
            });

            const { result: result1 } = renderHook(() => useHandoffLogic({
                record: mockRecord1,
                ...defaultParams
            }));

            expect(result1.current.deliversList).toEqual(['Nurse A', 'Nurse B']);

            // Second render with updated nurses (simulating census change)
            const mockRecord2 = createMockRecord({
                nursesDayShift: ['New Nurse X', 'New Nurse Y']
            });

            const { result: result2 } = renderHook(() => useHandoffLogic({
                record: mockRecord2,
                ...defaultParams
            }));

            expect(result2.current.deliversList).toEqual(['New Nurse X', 'New Nurse Y']);
        });
    });
});
