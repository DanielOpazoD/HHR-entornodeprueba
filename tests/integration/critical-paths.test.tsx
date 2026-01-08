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
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { CudyrView } from '@/views/cudyr/CudyrView';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { AuditProvider } from '@/context/AuditContext';
import { DemoModeProvider } from '@/context/DemoModeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DailyRecord, PatientData, PatientStatus, Specialty } from '@/types';

// ============================================================================
// MOCKS (Repository Layer)
// ============================================================================

const mockRepository = vi.hoisted(() => ({
    getForDate: vi.fn(),
    save: vi.fn(),
    updatePartial: vi.fn(),
    subscribe: vi.fn((date, cb) => { return () => { }; }),
    syncWithFirestore: vi.fn(),
    getPreviousDay: vi.fn(),
    setDemoModeActive: vi.fn()
}));

vi.mock('@/services/repositories/DailyRecordRepository', () => ({
    ...mockRepository,
    getForDate: (d: string) => mockRepository.getForDate(d),
    save: (r: any) => mockRepository.save(r),
    updatePartial: (d: string, p: any) => mockRepository.updatePartial(d, p),
    getPreviousDay: (d: string) => mockRepository.getPreviousDay(d),
    initializeDay: vi.fn(),
    subscribe: (d: string, cb: any) => mockRepository.subscribe(d, cb),
    syncWithFirestore: (d: string) => mockRepository.syncWithFirestore(d),
    setDemoModeActive: (active: boolean) => mockRepository.setDemoModeActive(active)
}));

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
    getUserFriendlyErrorMessage: (err: any) => 'Error simulado',
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

const createMockRecord = (date: string): DailyRecord => ({
    date,
    beds: {
        'bed-1': {
            bedId: 'bed-1',
            patientName: '',
            rut: '',
            age: '',
            pathology: '',
            admissionDate: '',
            bedMode: 'Cama',
            hasCompanionCrib: false,
            isBlocked: false,
            devices: [],
            specialty: Specialty.MEDICINA,
            status: PatientStatus.ESTABLE,
            hasWristband: true,
            surgicalComplication: false,
            isUPC: false,
            cudyr: {
                changeClothes: 0, mobilization: 0, feeding: 0, elimination: 0,
                psychosocial: 0, surveillance: 0, vitalSigns: 0, fluidBalance: 0,
                oxygenTherapy: 0, airway: 0, proInterventions: 0, skinCare: 0,
                pharmacology: 0, invasiveElements: 0
            }
        }
    },
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated: new Date().toISOString(),
} as unknown as DailyRecord); // Simplified cast

const IntegrationWrapper = ({ children }: { children: React.ReactNode }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    return (
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
    );
};

// ============================================================================
// TESTS
// ============================================================================

describe('Critical Integration Paths', () => {
    // State for the mock repository
    let currentRecord: DailyRecord | null = null;

    // Helper to deeply set value by path "beds.bed-1.field"
    const setByPath = (obj: any, path: string, value: any) => {
        const parts = path.split('.');
        const last = parts.pop();
        let current = obj;
        for (const part of parts) {
            if (!current[part]) current[part] = {};
            current = current[part];
        }
        if (last) current[last] = value;
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock localStorage
        const localStorageMock = (function () {
            let store: Record<string, string> = {};
            return {
                getItem: (key: string) => store[key] || null,
                setItem: (key: string, value: string) => { store[key] = value.toString(); },
                clear: () => { store = {}; },
                removeItem: (key: string) => { delete store[key]; }
            };
        })();
        Object.defineProperty(window, 'localStorage', { value: localStorageMock });

        // Mock crypto.randomUUID
        Object.defineProperty(global, 'crypto', {
            value: {
                randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(2)
            }
        });

        // Initialize State
        currentRecord = createMockRecord('2025-01-04');

        // Configure Repository Mocks to be Stateful
        mockRepository.getForDate.mockImplementation(async () => currentRecord);

        mockRepository.save.mockImplementation(async (r: DailyRecord) => {
            currentRecord = { ...r };
            return undefined;
        });

        mockRepository.updatePartial.mockImplementation(async (date: string, partial: any) => {
            if (currentRecord) {
                // Clone to avoid reference issues
                const next = JSON.parse(JSON.stringify(currentRecord));
                Object.entries(partial).forEach(([key, val]) => {
                    setByPath(next, key, val);
                });
                currentRecord = next;
            }
            return undefined;
        });

        mockRepository.syncWithFirestore.mockResolvedValue(null);
    });

    it('FLOW 1: Patient Admission (Ingreso)', async () => {
        const { result } = renderHook(() => useDailyRecord('2025-01-04'), { wrapper: IntegrationWrapper });

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
        expect(mockRepository.updatePartial).toHaveBeenCalled();
    });

    it('FLOW 2: Patient Discharge (Alta)', async () => {
        // Pre-load with a patient
        const initialRecord = createMockRecord('2025-01-04');
        initialRecord.beds['bed-1'].patientName = 'Maria Silva';
        initialRecord.beds['bed-1'].rut = '11.111.111-1';
        // Ensure stateful mock is also initialized!
        currentRecord = JSON.parse(JSON.stringify(initialRecord));
        // mocked getForDate will use currentRecord automatically

        const { result } = renderHook(() => useDailyRecord('2025-01-04'), { wrapper: IntegrationWrapper });
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
        expect(mockRepository.save).toHaveBeenCalled();
    });

    it('FLOW 3: Census Modify & Save', async () => {
        const { result } = renderHook(() => useDailyRecord('2025-01-04'), { wrapper: IntegrationWrapper });
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
        expect(mockRepository.updatePartial).toHaveBeenCalled();
    });

    it('FLOW 4: Medical Handoff Signature', async () => {
        const { result } = renderHook(() => useDailyRecord('2025-01-04'), { wrapper: IntegrationWrapper });
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
        expect(mockRepository.save).toHaveBeenCalled();
    });
});
