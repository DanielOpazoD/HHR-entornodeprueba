
/**
 * useCensusLogic Hook Tests
 * Tests for census view logic and data management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import * as statsCalculator from '@/services/calculations/statsCalculator';

// Mock contexts with correct hook names
vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: () => ({
        record: {
            date: '2025-01-10',
            beds: {
                R1: { patientName: 'Patient 1', status: 'ESTABLE' },
                R2: { patientName: 'Patient 2', status: 'CRITICO' }
            }
        }
    }),
    useDailyRecordActions: () => ({
        createDay: vi.fn(),
        resetDay: vi.fn(),
        updateNurse: vi.fn(),
        updateTens: vi.fn(),
        undoDischarge: vi.fn(),
        deleteDischarge: vi.fn(),
        undoTransfer: vi.fn(),
        deleteTransfer: vi.fn()
    })
}));

vi.mock('@/context/StaffContext', () => ({
    useStaffContext: () => ({
        nursesList: ['Nurse A', 'Nurse B'],
        tensList: ['Tens A', 'Tens B']
    })
}));

vi.mock('@/services/repositories/DailyRecordRepository');
vi.mock('@/services/calculations/statsCalculator');

describe('useCensusLogic', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mocks
        vi.mocked(DailyRecordRepository.getPreviousDay).mockResolvedValue({
            date: '2025-01-09',
            beds: {}
        } as any);
        vi.mocked(DailyRecordRepository.getAvailableDates).mockResolvedValue([
            '2025-01-08', '2025-01-09', '2025-01-10'
        ]);
        vi.mocked(statsCalculator.calculateStats).mockReturnValue({
            totalBeds: 20,
            occupiedBeds: 10,
            occupancyRate: 50
        } as any);
    });

    describe('Initial State', () => {
        it('should return record from context', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(result.current.record).toBeDefined();
            expect(result.current.record?.date).toBe('2025-01-10');
        });

        it('should return staff lists from context', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(result.current.nursesList).toEqual(['Nurse A', 'Nurse B']);
            expect(result.current.tensList).toEqual(['Tens A', 'Tens B']);
        });

        it('should calculate stats from record', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(result.current.stats).toBeDefined();
            expect(statsCalculator.calculateStats).toHaveBeenCalled();
        });
    });

    describe('Previous Day Check', () => {
        it('should check for previous day on mount', async () => {
            renderHook(() => useCensusLogic('2025-01-10'));

            await waitFor(() => {
                expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalledWith('2025-01-10');
            });
        });

        it('should set previousRecordAvailable when previous exists', async () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            await waitFor(() => {
                expect(result.current.previousRecordAvailable).toBe(true);
                expect(result.current.previousRecordDate).toBe('2025-01-09');
            });
        });

        it('should set previousRecordAvailable to false when no previous', async () => {
            vi.mocked(DailyRecordRepository.getPreviousDay).mockResolvedValue(null);

            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            await waitFor(() => {
                expect(result.current.previousRecordAvailable).toBe(false);
            });
        });
    });

    describe('Available Dates', () => {
        it('should fetch available dates on mount', async () => {
            renderHook(() => useCensusLogic('2025-01-10'));

            await waitFor(() => {
                expect(DailyRecordRepository.getAvailableDates).toHaveBeenCalled();
            });
        });

        it('should filter out current date from available dates', async () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            await waitFor(() => {
                expect(result.current.availableDates).not.toContain('2025-01-10');
                expect(result.current.availableDates).toContain('2025-01-08');
                expect(result.current.availableDates).toContain('2025-01-09');
            });
        });
    });

    describe('Actions', () => {
        it('should expose createDay action', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(typeof result.current.createDay).toBe('function');
        });

        it('should expose resetDay action', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(typeof result.current.resetDay).toBe('function');
        });

        it('should expose all CRUD actions', () => {
            const { result } = renderHook(() => useCensusLogic('2025-01-10'));

            expect(typeof result.current.updateNurse).toBe('function');
            expect(typeof result.current.updateTens).toBe('function');
            expect(typeof result.current.undoDischarge).toBe('function');
            expect(typeof result.current.deleteDischarge).toBe('function');
            expect(typeof result.current.undoTransfer).toBe('function');
            expect(typeof result.current.deleteTransfer).toBe('function');
        });
    });
});
