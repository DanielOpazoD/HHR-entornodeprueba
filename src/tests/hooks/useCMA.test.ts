import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCMA } from '@/hooks/useCMA';
import { DataFactory } from '@/tests/factories/DataFactory';
import { DailyRecord } from '@/types';

describe('useCMA', () => {
    let mockRecord: DailyRecord;
    const saveAndUpdate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockRecord = DataFactory.createMockDailyRecord('2025-01-01');
    });

    it('should add a CMA entry with normalized data', () => {
        const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate));

        const cmaData: any = {
            bedName: 'CMA 1',
            patientName: 'john doe', // should be capitalized
            rut: '111111111', // should be formatted
            age: '45',
            diagnosis: 'Surgery',
            specialty: 'Surgery',
            interventionType: 'Cirugía Mayor Ambulatoria'
        };

        act(() => {
            result.current.addCMA(cmaData);
        });

        expect(saveAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
            cma: expect.arrayContaining([
                expect.objectContaining({
                    patientName: 'John Doe',
                    rut: '11.111.111-1',
                    bedName: 'CMA 1'
                })
            ])
        }));
    });

    it('should delete a CMA entry', () => {
        mockRecord.cma = [DataFactory.createMockCMA({ id: 'cma-1' })];
        const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate));

        act(() => {
            result.current.deleteCMA('cma-1');
        });

        expect(saveAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
            cma: []
        }));
    });

    it('should update a CMA entry with normalized data', () => {
        mockRecord.cma = [DataFactory.createMockCMA({ id: 'cma-1', patientName: 'Original' })];
        const { result } = renderHook(() => useCMA(mockRecord, saveAndUpdate));

        act(() => {
            result.current.updateCMA('cma-1', { patientName: 'updated name' });
        });

        expect(saveAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
            cma: [expect.objectContaining({
                id: 'cma-1',
                patientName: 'Updated Name'
            })]
        }));
    });

    it('should handle record being null', () => {
        const { result } = renderHook(() => useCMA(null, saveAndUpdate));

        act(() => {
            result.current.addCMA({} as any);
        });

        expect(saveAndUpdate).not.toHaveBeenCalled();
    });
});
