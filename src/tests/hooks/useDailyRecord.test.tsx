import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import { DailyRecord } from '@/types';
import { UIProvider } from '@/context/UIContext';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';


// Mock dependencies
vi.mock('@/services/repositories/DailyRecordRepository', () => {
    const repo = {
        getForDate: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        save: vi.fn().mockResolvedValue(undefined),
        updatePartial: vi.fn().mockResolvedValue(undefined),
        initializeDay: vi.fn().mockResolvedValue(null), // Changed to null to force init
        deleteDay: vi.fn().mockResolvedValue(undefined),
        getPreviousDay: vi.fn().mockResolvedValue(null),
        syncWithFirestore: vi.fn().mockResolvedValue(null),
        copyPatientToDate: vi.fn().mockResolvedValue(undefined)
    };
    return {
        DailyRecordRepository: repo,
        ...repo
    };
});

const createWrapper = () => {
    const { wrapper } = createQueryClientTestWrapper({
        config: {
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0,
                    staleTime: 0,
                },
            },
        },
        wrapChildren: (children) => <UIProvider>{children}</UIProvider>,
    });
    return wrapper;
};

describe('useDailyRecord', () => {
    const mockDate = '2025-01-01';
    let recordsMap: Record<string, DailyRecord> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        recordsMap = {
            [mockDate]: DataFactory.createMockDailyRecord(mockDate)
        };

        const repo = DailyRecordRepository.DailyRecordRepository;

        vi.mocked(repo.getForDate).mockImplementation(async (date) => {
            return recordsMap[date] || null;
        });

        vi.mocked(repo.initializeDay).mockImplementation(async (date) => {
            const rec = DataFactory.createMockDailyRecord(date);
            recordsMap[date] = rec;
            return rec;
        });

        vi.mocked(repo.updatePartial).mockImplementation(async (date, partial) => {
            if (recordsMap[date]) {
                recordsMap[date] = applyPatches(recordsMap[date], partial);
            }
        });

        vi.mocked(repo.save).mockImplementation(async (record) => {
            recordsMap[record.date] = record;
        });
    });

    it('should initialize with record for the given date', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.record).not.toBeNull();
            expect(result.current.record?.date).toBe(mockDate);
        });
        expect(DailyRecordRepository.DailyRecordRepository.getForDate).toHaveBeenCalledWith(mockDate);
    });

    it('should update record when date changes', async () => {
        const { result, rerender } = renderHook(({ date }) => useDailyRecord(date), {
            initialProps: { date: mockDate },
            wrapper: createWrapper()
        });

        await waitFor(() => expect(result.current.record).not.toBeNull());

        const newDate = '2025-01-02';
        recordsMap[newDate] = DataFactory.createMockDailyRecord(newDate);

        rerender({ date: newDate });

        await waitFor(() => {
            expect(result.current.record?.date).toBe(newDate);
        });
    });

    it('should create a new day', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

        // Wait for initial load (which might be null if currentRecord setup failed or similar)
        // But in our mock it returns currentRecord.

        await waitFor(() => expect(result.current.record).not.toBeNull());

        await act(async () => {
            await result.current.createDay(false);
        });

        expect(DailyRecordRepository.DailyRecordRepository.initializeDay).toHaveBeenCalledWith(mockDate, undefined);
        await waitFor(() => {
            expect(result.current.record?.date).toBe(mockDate);
        });
    });

    it('should not move patient if source bed is empty', async () => {
        recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
            beds: {
                'R1': DataFactory.createMockPatient('R1', { patientName: '' }),
                'R2': DataFactory.createMockPatient('R2', { patientName: '' })
            }
        });

        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.record?.beds['R1']).toBeDefined());

        act(() => {
            result.current.moveOrCopyPatient('move', 'R1', 'R2');
        });

        // Should NOT call updatePartial/save because source was empty
        expect(DailyRecordRepository.DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
    });

    it('should not update admissionDate to a future date', async () => {
        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.record).not.toBeNull());

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 2);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        act(() => {
            result.current.updatePatient('R1', 'admissionDate', futureDateStr);
        });

        expect(DailyRecordRepository.DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
    });

    it('should not create clinical crib in empty bed', async () => {
        recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
            beds: {
                'R1': DataFactory.createMockPatient('R1', { patientName: '' })
            }
        });

        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.record?.beds['R1']).toBeDefined());

        act(() => {
            result.current.updateClinicalCrib('R1', 'create');
        });

        expect(DailyRecordRepository.DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
    });

    it('should not update crib admissionDate to a future date', async () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 2);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
            beds: {
                'R1': DataFactory.createMockPatient('R1', {
                    patientName: 'Mom',
                    clinicalCrib: DataFactory.createMockPatient('R1', {
                        patientName: 'Baby',
                        admissionDate: '2025-01-01'
                    })
                })
            }
        });

        const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.record?.beds['R1'].clinicalCrib).toBeDefined());

        act(() => {
            result.current.updateClinicalCrib('R1', 'admissionDate', futureDateStr);
        });

        expect(DailyRecordRepository.DailyRecordRepository.updatePartial).not.toHaveBeenCalled();
    });

    describe('copyPatientToDate', () => {
        // TODO: This test needs refactoring - the hook implementation uses DailyRecordRepository.copyPatientToDate
        // but the current mock setup doesn't correctly handle the repository method delegation.
        // The test verifies getForDate is called with targetDate, but the hook calls it first with sourceDate.
        it('should copy patient to a future date and specific bed', async () => {
            // Setup source record
            recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
                beds: {
                    'R1': DataFactory.createMockPatient('R1', {
                        patientName: 'John Doe',
                        rut: '12345678-9'
                    })
                }
            });

            // Setup target record (future date, empty bed)
            const targetDate = '2025-01-02';
            recordsMap[targetDate] = DataFactory.createMockDailyRecord(targetDate);

            const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

            // Wait for initial load
            await waitFor(() => expect(result.current.record?.beds).toBeDefined());

            await act(async () => {
                await result.current.copyPatientToDate('R1', targetDate, 'R2');
            });

            // Verify copyPatientToDate called with correct arguments
            expect(DailyRecordRepository.DailyRecordRepository.copyPatientToDate).toHaveBeenCalledWith(
                mockDate,
                'R1',
                targetDate,
                'R2'
            );
        });
    });
});
