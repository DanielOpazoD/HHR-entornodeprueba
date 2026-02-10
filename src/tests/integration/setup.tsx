// Import global mocks before any other imports
import '../setup';
import React from 'react';
import { render as rtlRender, RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Unmock DailyRecordContext to use real provider with custom values in integration tests
vi.unmock('@/context/DailyRecordContext');
vi.unmock('../context/DailyRecordContext');

// Explicit mocks for hooks that need to be available in integration tests
vi.mock('@/hooks/useStabilityRules', () => ({
    useStabilityRules: () => ({
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
        lockReason: undefined,
    }),
}));

vi.mock('@/hooks/useAuthState', () => ({
    useAuthState: () => ({
        role: 'admin',
        isEditor: true,
        isViewer: false,
        isAuthenticated: true,
        isLoading: false,
    }),
}));

// Types
import { DailyRecord, Specialty, PatientStatus, PatientData } from '@/types';
import { DailyRecordContextType } from '@/hooks/useDailyRecordTypes';

// Providers
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { StaffProvider } from '@/context/StaffContext';
import { DemoModeProvider } from '@/context/DemoModeContext';
import { AuthProvider } from '@/context/AuthContext';
import { AuditProvider } from '@/context/AuditContext';
import { UIProvider } from '@/context/UIContext';
import { VersionProvider } from '@/context/VersionContext';
import { UseUIStateReturn } from '@/hooks/useUIState';
import { UseModalReturn } from '@/hooks/useModal';

// ============================================================================
// Mock Data Factories
// ============================================================================

export const createMockRecord = (date: string = '2024-12-11'): DailyRecord => ({
    date,
    lastUpdated: new Date().toISOString(),
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    medicalHandoffDoctor: ''
});

export const createMockPatient = (overrides = {}): PatientData => ({
    bedId: 'R1',
    isBlocked: false,
    bedMode: 'Cama' as const,
    hasCompanionCrib: false,
    patientName: 'TEST PATIENT',
    rut: '12.345.678-9',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    age: '30',
    pathology: 'Pathology Test',
    admissionDate: '2024-12-01',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    cudyr: {
        changeClothes: 0,
        mobilization: 0,
        feeding: 0,
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
        invasiveElements: 0
    },
    ...overrides
});

/**
 * Creates a fully populated mock DailyRecordContext for testing.
 * Includes all methods required by DailyRecordContextType.
 */
export const createMockDailyRecordContext = (record: DailyRecord | null): DailyRecordContextType => ({
    // Core State
    record,
    syncStatus: 'idle',
    lastSyncTime: null,

    // Stability Rules - Required for PatientInputCells
    stabilityRules: {
        isDateLocked: false,
        isDayShiftLocked: false,
        isNightShiftLocked: false,
        canEditField: () => true,
        canPerformActions: true,
        lockReason: undefined,
    },

    // Inventory - Required for data context
    inventory: {
        occupiedBeds: [],
        freeBeds: [],
        blockedBeds: [],
        occupiedCount: 0,
        blockedCount: 0,
        availableCount: 0,
        occupancyRate: 0,
        isFull: false
    },

    // Day Management
    createDay: vi.fn(),
    generateDemo: vi.fn(),
    resetDay: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),

    // Bed Management
    updatePatient: vi.fn().mockResolvedValue(undefined),
    updatePatientMultiple: vi.fn().mockResolvedValue(undefined),
    updateClinicalCrib: vi.fn(),
    updateClinicalCribMultiple: vi.fn(),
    updateClinicalCribCudyr: vi.fn(),
    updateClinicalCribCudyrMultiple: vi.fn(),
    updateCudyr: vi.fn(),
    updateCudyrMultiple: vi.fn(),
    clearPatient: vi.fn(),
    clearAllBeds: vi.fn(),
    moveOrCopyPatient: vi.fn(),
    toggleBlockBed: vi.fn(),
    updateBlockedReason: vi.fn(),
    toggleExtraBed: vi.fn(),
    toggleBedType: vi.fn(),
    copyPatientToDate: vi.fn().mockResolvedValue(undefined),

    // Nurse/TENS Management
    updateNurse: vi.fn(),
    updateTens: vi.fn(),

    // Discharges
    addDischarge: vi.fn(),
    updateDischarge: vi.fn(),
    deleteDischarge: vi.fn(),
    undoDischarge: vi.fn(),

    // Transfers
    addTransfer: vi.fn(),
    updateTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
    undoTransfer: vi.fn(),

    // CMA (Day Hospitalization)
    addCMA: vi.fn(),
    deleteCMA: vi.fn(),
    updateCMA: vi.fn(),

    // Handoff Management
    updateHandoffChecklist: vi.fn(),
    updateHandoffNovedades: vi.fn(),
    updateHandoffStaff: vi.fn(),
    updateMedicalSignature: vi.fn().mockResolvedValue(undefined),
    updateMedicalHandoffDoctor: vi.fn().mockResolvedValue(undefined),
    markMedicalHandoffAsSent: vi.fn().mockResolvedValue(undefined),
    sendMedicalHandoff: vi.fn().mockResolvedValue(undefined),

    // Validation helpers
    validateRecordSchema: vi.fn(() => ({ isValid: true, errors: [] })),
    canMovePatient: vi.fn(() => ({ canMove: true })),
    canDischargePatient: vi.fn(() => true),

    // Professional coverage
    updateOnDutyProfessional: vi.fn(),
    updateOnDutyProfessionalsFull: vi.fn(),
});

export const createMockModal = (overrides: Partial<UseModalReturn<any>> = {}): UseModalReturn<any> => ({
    isOpen: false,
    data: null,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    ...overrides
});

export const createMockUIState = (overrides: Partial<UseUIStateReturn> = {}): UseUIStateReturn => ({
    currentModule: 'CENSUS',
    setCurrentModule: vi.fn(),
    censusViewMode: 'REGISTER',
    setCensusViewMode: vi.fn(),
    settingsModal: createMockModal(),
    bedManagerModal: createMockModal(),
    demoModal: createMockModal(),
    isTestAgentRunning: false,
    setIsTestAgentRunning: vi.fn(),
    selectedShift: 'day',
    setSelectedShift: vi.fn(),
    censusLocalViewMode: 'TABLE',
    setCensusLocalViewMode: vi.fn(),
    showPrintButton: true,
    showBookmarksBar: true,
    setShowBookmarksBar: vi.fn(),
    ...overrides
});

// ============================================================================
// Test Wrapper with All Providers
// ============================================================================

interface CustomRenderOptions extends RenderOptions {
    contextValue?: DailyRecordContextType;
}

/**
 * Return type for customRender - includes the mockContext for assertions
 */
interface CustomRenderResult extends ReturnType<typeof rtlRender> {
    mockContext: DailyRecordContextType;
}

/**
 * Specialized render function for HHR components.
 * Wraps the component with all necessary domain providers and mocks.
 * 
 * IMPORTANT: Returns the mockContext that was actually used, so tests can
 * verify mock function calls correctly by using the returned context:
 * 
 * @example
 * const { mockContext } = render(<Component />, { contextValue: createMockDailyRecordContext(record) });
 * fireEvent.click(button);
 * expect(mockContext.updatePatient).toHaveBeenCalled(); // ✅ Works!
 */
function customRender(
    ui: React.ReactElement,
    options: CustomRenderOptions = {}
): CustomRenderResult {
    const { contextValue, ...renderOptions } = options;

    // Use provided contextValue directly, or create a default one
    // DO NOT merge - this ensures tests can verify calls on their own mocks
    const mockContext = contextValue || createMockDailyRecordContext(createMockRecord());

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
            },
        },
    });

    const AllProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        return (
            <QueryClientProvider client={queryClient}>
                <UIProvider>
                    <AuthProvider>
                        <VersionProvider>
                            <AuditProvider userId="test-user">
                                <DemoModeProvider>
                                    <StaffProvider>
                                        <DailyRecordProvider value={mockContext}>
                                            {children}
                                        </DailyRecordProvider>
                                    </StaffProvider>
                                </DemoModeProvider>
                            </AuditProvider>
                        </VersionProvider>
                    </AuthProvider>
                </UIProvider>
            </QueryClientProvider>
        );
    };

    return {
        ...rtlRender(ui, { wrapper: AllProviders, ...renderOptions }),
        mockContext  // Return the context so tests can verify mock calls
    };
}

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override render method
export { customRender as render };
