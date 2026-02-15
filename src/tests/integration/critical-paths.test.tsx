/**
 * Critical Paths Integration Tests
 * 
 * Tests the full application flow for mission-critical operations:
 * 1. Patient Admission (Ingreso)
 * 2. Patient Discharge (Alta)
 * 3. Daily Census Save (Guardado)
 * 4. Handoff Signature (Firma)
 * 
 * key distinction: Uses REAL useDailyRecord hook logic with MOCKED Repository layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { AuditProvider } from '@/context/AuditContext';
import { DemoModeProvider } from '@/context/DemoModeContext';
import { DailyRecord, PatientStatus, Specialty } from '@/types';
import { DataFactory } from '../factories/DataFactory';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { wireStatefulDailyRecordRepoMock } from '@/tests/utils/dailyRecordRepositoryMockUtils';

// ============================================================================
// MOCKS (Repository Layer)
// ============================================================================

vi.mock('@/services/repositories/DailyRecordRepository', () => {
    const mockRepo = {
        getForDate: vi.fn(),
        save: vi.fn(),
        updatePartial: vi.fn(),
        subscribe: vi.fn(() => { return () => { }; }),
        syncWithFirestore: vi.fn().mockResolvedValue(null),
        getPreviousDay: vi.fn(),
        initializeDay: vi.fn(),
        setDemoModeActive: vi.fn()
    };
    return {
        ...mockRepo,
        DailyRecordRepository: mockRepo
    };
});

vi.mock('@/firebaseConfig', () => ({
    auth: {
        onAuthStateChanged: vi.fn((cb) => {
            cb({ uid: 'test-user-123', email: 'hospitalizados@hospitalhangaroa.cl' });
            return () => { };
        }),
    },
    db: {
        collection: vi.fn(() => ({
            doc: vi.fn(() => ({ get: vi.fn() }))
        }))
    }
}));

// Mock firebase/auth to override global setup and force correct email
vi.mock('firebase/auth', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        getAuth: vi.fn(),
        onAuthStateChanged: vi.fn((auth, callback) => {
            // Return user with static role email
            callback({
                uid: 'test-user-123',
                email: 'hospitalizados@hospitalhangaroa.cl',
                displayName: 'Test User',
                getIdToken: () => Promise.resolve('token')
            });
            return () => { };
        })
    };
});

// Mock firebase/firestore to prevent errors during Auth checks
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn()
}));

vi.mock('@/services/utils/errorService', () => ({
    logFirebaseError: vi.fn(),
    // Mock getUserFriendlyErrorMessage to return a simple string
    getUserFriendlyErrorMessage: (_err: any) => 'Error simulado',
}));

vi.mock('@/services/admin/auditService', () => ({
    logPatientAdmission: vi.fn(),
    logPatientDischarge: vi.fn(),
    logMedicalHandoffModified: vi.fn(),
    logEvent: vi.fn(),
    logDebouncedEvent: vi.fn(),
    logUserLogin: vi.fn()
}));

// ============================================================================
// TEST SETUP w/ REAL LOGIC
// ============================================================================

// ============================================================================
// TEST SETUP w/ REAL LOGIC
// ============================================================================

const createIntegrationWrapper = () => {
    const { wrapper } = createQueryClientTestWrapper({
        wrapChildren: (children) => (
            <UIProvider>
                <AuthProvider>
                    <AuditProvider userId="test-user">
                        <DemoModeProvider>
                            {/* We don't provide DailyRecordContext here because we verify the hook directly */}
                            {children}
                        </DemoModeProvider>
                    </AuditProvider>
                </AuthProvider>
            </UIProvider>
        ),
    });
    return wrapper;
};

// ============================================================================
// TESTS
// ============================================================================

describe('Critical Integration Paths', () => {
    // State for the mock repository
    let currentRecord: DailyRecord | null = null;
    const mockDate = '2025-01-04';

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();

        // Initialize State
        currentRecord = DataFactory.createMockDailyRecord(mockDate, {
            beds: {
                'bed-1': DataFactory.createMockPatient('bed-1')
            }
        });

        const mockRepo = DailyRecordRepository.DailyRecordRepository;

        wireStatefulDailyRecordRepoMock(mockRepo, {
            getCurrentRecord: () => currentRecord,
            setCurrentRecord: (record) => {
                currentRecord = record;
            },
        });
    });

    it('FLOW 1: Patient Admission (Ingreso)', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createIntegrationWrapper() });

        // Wait for load
        await waitFor(() => {
            expect(result.current.record).not.toBeNull();
        });

        // 1. Simulate Input: Admit Patient to Bed 1
        await act(async () => {
            result.current.updatePatientMultiple('bed-1', {
                patientName: 'Juan Perez',
                rut: '12.345.678-9',
                age: '45',
                specialty: Specialty.CIRUGIA,
                status: PatientStatus.GRAVE,
                pathology: 'Apendicitis',
                admissionDate: '2025-01-04'
            });
        });

        // 2. Verify State Update (Optimistic)
        await waitFor(() => {
            const bed = result.current.record?.beds['bed-1'];
            expect(bed?.patientName).toBe('Juan Perez');
            expect(bed?.specialty).toBe(Specialty.CIRUGIA);
        });

        // 3. Verify Repository Update (Persistence)
        const mockRepo = DailyRecordRepository.DailyRecordRepository;
        expect(mockRepo.updatePartial).toHaveBeenCalled();
    });

    it('FLOW 2: Patient Discharge (Alta)', async () => {
        // Pre-load with a patient
        const initialRecord = DataFactory.createMockDailyRecord(mockDate, {
            beds: {
                'bed-1': DataFactory.createMockPatient('bed-1', {
                    patientName: 'Maria Silva',
                    rut: '11.111.111-1'
                })
            }
        });
        // Ensure stateful mock is also initialized!
        currentRecord = JSON.parse(JSON.stringify(initialRecord));
        // mocked getForDate will use currentRecord automatically

        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createIntegrationWrapper() });
        await waitFor(() => expect(result.current.record?.beds['bed-1'].patientName).toBe('Maria Silva'));

        // 1. Execute Discharge
        await act(async () => {
            await result.current.addDischarge('bed-1', 'Vivo', undefined, 'Domicilio', undefined, '12:00');
        });

        // 2. Verify Bed Cleared
        await waitFor(() => {
            expect(result.current.record?.beds['bed-1'].patientName).toBe('');
            expect(result.current.record?.discharges).toHaveLength(1);
        });

        // 3. Verify Discharge Record Created
        expect(result.current.record?.discharges[0].patientName).toBe('Maria Silva');

        // 4. Verify Persistence
        const mockRepo = DailyRecordRepository.DailyRecordRepository;
        expect(mockRepo.save).toHaveBeenCalled();
    });

    it('FLOW 3: Census Modify & Save', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createIntegrationWrapper() });
        await waitFor(() => expect(result.current.record).not.toBeNull());

        // 1. Modify multiple fields (Simulating dragging/typing in Census)
        await act(async () => {
            result.current.updatePatient('bed-1', 'pathology', 'Fiebre');
        });

        // 2. Verify State Update (Optimistic)
        await waitFor(() => {
            expect(result.current.record?.beds['bed-1'].pathology).toBe('Fiebre');
        });

        // 3. Expect Partial Update
        const mockRepo = DailyRecordRepository.DailyRecordRepository;
        expect(mockRepo.updatePartial).toHaveBeenCalled();
    });

    it('FLOW 4: Medical Handoff Signature', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createIntegrationWrapper() });
        await waitFor(() => expect(result.current.record).not.toBeNull());

        // 1. Sign
        await act(async () => {
            await result.current.updateMedicalSignature('Dr. House');
        });

        // 2. Verify State
        await waitFor(() => {
            expect(result.current.record?.medicalSignature?.doctorName).toBe('Dr. House');
        });

        // 3. Verify Async Persistence
        const mockRepo = DailyRecordRepository.DailyRecordRepository;
        expect(mockRepo.save).toHaveBeenCalled();
    });
});
