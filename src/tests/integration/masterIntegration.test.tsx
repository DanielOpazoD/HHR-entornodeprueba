import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import { UIProvider } from '@/context/UIContext';
import type { DailyRecord } from '@/types';
import React from 'react';
import { DataFactory } from '../factories/DataFactory';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { wireStatefulDailyRecordRepoMock } from '@/tests/utils/dailyRecordRepositoryMockUtils';

// Mock Repositories and Services
vi.mock('@/services/repositories/DailyRecordRepository', () => {
    const mockRepo = {
        getPreviousDay: vi.fn(),
        initializeDay: vi.fn(),
        save: vi.fn(),
        deleteDay: vi.fn(),
        getForDate: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        updatePartial: vi.fn().mockResolvedValue(undefined),
        syncWithFirestore: vi.fn().mockResolvedValue(null)
    };
    return { ...mockRepo, DailyRecordRepository: mockRepo };
});

vi.mock('@/services/storage/localStorageService', () => ({ saveRecordToLocalStorage: vi.fn(), getRecordFromLocalStorage: vi.fn() }));
vi.mock('@/context/UIContext', () => ({
    useNotification: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
    useUI: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), confirm: vi.fn(), alert: vi.fn() }),
    UIProvider: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock('@/context/VersionContext', () => ({
    useVersion: () => ({ checkVersion: vi.fn(), currentVersion: '1.0.0' }),
    VersionProvider: ({ children }: { children: React.ReactNode }) => children
}));

const createWrapper = () => {
    const { wrapper } = createQueryClientTestWrapper({
        config: {
            defaultOptions: { queries: { retry: false, staleTime: Infinity } }
        },
        wrapChildren: (children) => (
            <UIProvider>{children}</UIProvider>
        ),
    });
    return wrapper;
};

describe('Master Integration Suite', () => {
    let currentRecord: DailyRecord | null = null;

    afterEach(() => {
        vi.useRealTimers();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        currentRecord = null;
        const mockRepo = DailyRecordRepository.DailyRecordRepository;

        vi.mocked(mockRepo.initializeDay).mockImplementation(async (date) => {
            currentRecord = DataFactory.createMockDailyRecord(date, {
                beds: { 'R1': DataFactory.createMockPatient('R1', { patientName: 'INITIAL' }) }
            });
            return currentRecord;
        });
        wireStatefulDailyRecordRepoMock(mockRepo, {
            getCurrentRecord: () => currentRecord,
            setCurrentRecord: (record) => {
                currentRecord = record;
            },
        });
    });

    describe('Scenario 1: Full Patient Lifecycle', () => {
        it('should handle admission, categorization, and discharge', async () => {
            const { result } = renderHook(() => useDailyRecord('2025-01-25'), { wrapper: createWrapper() });
            await act(async () => { await result.current.createDay(false); });
            await waitFor(() => expect(result.current.record).not.toBeNull());

            // 1. Admission (Tests capitalization)
            act(() => { result.current.updatePatient('R1', 'patientName', 'juan perez'); });
            await waitFor(() => expect(result.current.record?.beds['R1'].patientName).toBe('Juan Perez'));

            // 2. CUDYR
            act(() => { result.current.updatePatient('R1', 'cudyr', DataFactory.createMockCudyr({ changeClothes: 4 })); });
            await waitFor(() => expect(result.current.record?.beds['R1'].cudyr?.changeClothes).toBe(4));

            // 3. Discharge
            act(() => { result.current.addDischarge('R1', 'Vivo', undefined, 'Domicilio'); });
            await waitFor(() => {
                expect(result.current.record?.beds['R1'].patientName).toBe('');
                expect(result.current.record?.discharges.length).toBe(1);
            });
        });
    });

    describe('Scenario 2: Transfers and System Consistency', () => {
        it('should handle patient transfer and undo', async () => {
            const { result } = renderHook(() => useDailyRecord('2025-01-26'), { wrapper: createWrapper() });
            await act(async () => { await result.current.createDay(false); });
            await waitFor(() => expect(result.current.record).not.toBeNull());

            act(() => { result.current.updatePatient('R1', 'patientName', 'Maria Garcia'); });
            await waitFor(() => expect(result.current.record?.beds['R1'].patientName).toBe('Maria Garcia'));

            // Transfer
            act(() => { result.current.addTransfer('R1', 'Ambulancia', 'Hospital Regional', ''); });
            await waitFor(() => {
                expect(result.current.record?.beds['R1'].patientName).toBe('');
                expect(result.current.record?.transfers.length).toBe(1);
            });

            // Undo transfer
            const transferId = result.current.record?.transfers[0].id;
            act(() => { if (transferId) result.current.undoTransfer(transferId); });
            await waitFor(() => {
                expect(result.current.record?.beds['R1'].patientName).toBe('Maria Garcia');
                expect(result.current.record?.transfers.length).toBe(0);
            });
        });
    });

    describe('Scenario 3: Clinical Crib Lifecycle', () => {
        it('should handle clinical crib creation and newborn admission', async () => {
            const { result } = renderHook(() => useDailyRecord('2025-01-27'), { wrapper: createWrapper() });
            await act(async () => { await result.current.createDay(false); });
            await waitFor(() => expect(result.current.record).not.toBeNull());

            act(() => { result.current.updateClinicalCrib('R1', 'create'); });
            await waitFor(() => expect(result.current.record?.beds['R1'].clinicalCrib).toBeDefined());

            act(() => { result.current.updateClinicalCrib('R1', 'patientName', 'Baby Test'); });
            await waitFor(() => expect(result.current.record?.beds['R1'].clinicalCrib?.patientName).toBe('Baby Test'));

            const stats = calculateStats(result.current.record?.beds || {});
            expect(stats.totalHospitalized).toBeGreaterThanOrEqual(2); // Mother + Newborn
        });
    });

    describe('Scenario 4: High-Frequency Update Concurrency', () => {
        it('should handle rapid concurrent updates without data loss', async () => {
            const { result } = renderHook(() => useDailyRecord('2025-01-28'), { wrapper: createWrapper() });
            await act(async () => { await result.current.createDay(false); });
            await waitFor(() => expect(result.current.record).not.toBeNull());

            // Post multiple updates in the same act to stress the optimistic logic
            act(() => {
                result.current.updatePatient('R1', 'patientName', 'concurrent one');
                result.current.updatePatient('R1', 'rut', '1-1');
                result.current.updatePatient('R1', 'age', '99');
            });

            await waitFor(() => {
                const p = result.current.record?.beds['R1'];
                expect(p?.patientName).toBe('Concurrent One');
                expect(p?.rut).toBe('1-1');
                expect(p?.age).toBe('99');
            }, { timeout: 3000 });
        });
    });
});
