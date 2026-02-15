import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getTodayISO } from '@/utils/dateUtils';
import { BedType } from '@/types';
import { useCensusTableModel } from '@/features/census/hooks/useCensusTableModel';
import { DataFactory } from '@/tests/factories/DataFactory';

const TEST_COLUMNS = {
    actions: 50,
    bed: 80,
    type: 60,
    name: 200,
    rut: 100,
    age: 50,
    diagnosis: 200,
    specialty: 80,
    status: 100,
    admission: 100,
    dmi: 60,
    cqx: 60,
    upc: 60
};

describe('useCensusTableModel', () => {
    it('builds rows, bed types and width totals', () => {
        const warning = vi.fn();
        const confirm = vi.fn();
        const resetDay = vi.fn();
        const today = getTodayISO();

        const beds = {
            R1: DataFactory.createMockPatient('R1', {
                patientName: 'Paciente',
                clinicalCrib: DataFactory.createMockPatient('R1-cuna', {
                    patientName: 'RN'
                })
            }),
            R2: DataFactory.createMockPatient('R2', {
                patientName: ''
            })
        };

        const { result } = renderHook(() => useCensusTableModel({
            currentDateString: today,
            role: 'admin',
            beds,
            activeExtraBeds: ['E1'],
            overrides: {
                R1: BedType.UCI
            },
            columns: TEST_COLUMNS,
            resetDay,
            confirm,
            warning
        }));

        expect(result.current.canDeleteRecord).toBe(true);
        expect(result.current.occupiedRows.map((row) => row.id)).toContain('R1-cuna');
        expect(result.current.emptyBeds.some((bed) => bed.id === 'R2')).toBe(true);
        expect(result.current.bedTypes.R1).toBe(BedType.UCI);
        expect(result.current.totalWidth).toBe(Object.values(TEST_COLUMNS).reduce((sum, width) => sum + width, 0));
    });

    it('warns and skips confirm flow when deletion is denied', async () => {
        const warning = vi.fn();
        const confirm = vi.fn();
        const resetDay = vi.fn();

        const { result } = renderHook(() => useCensusTableModel({
            currentDateString: '2000-01-01',
            role: 'nurse_hospital',
            beds: {},
            activeExtraBeds: [],
            overrides: {},
            columns: TEST_COLUMNS,
            resetDay,
            confirm,
            warning
        }));

        await act(async () => {
            await result.current.handleClearAll();
        });

        expect(warning).toHaveBeenCalledWith(
            'Acceso Denegado',
            expect.stringContaining('Solo el administrador puede eliminar registros de días anteriores')
        );
        expect(confirm).not.toHaveBeenCalled();
        expect(resetDay).not.toHaveBeenCalled();
    });

    it('confirms and resets day when deletion is allowed', async () => {
        const warning = vi.fn();
        const confirm = vi.fn().mockResolvedValue(true);
        const resetDay = vi.fn();

        const { result } = renderHook(() => useCensusTableModel({
            currentDateString: getTodayISO(),
            role: 'admin',
            beds: {},
            activeExtraBeds: [],
            overrides: {},
            columns: TEST_COLUMNS,
            resetDay,
            confirm,
            warning
        }));

        await act(async () => {
            await result.current.handleClearAll();
        });

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(resetDay).toHaveBeenCalledTimes(1);
        expect(warning).not.toHaveBeenCalled();
    });

    it('does not reset when user cancels confirmation', async () => {
        const warning = vi.fn();
        const confirm = vi.fn().mockResolvedValue(false);
        const resetDay = vi.fn();

        const { result } = renderHook(() => useCensusTableModel({
            currentDateString: getTodayISO(),
            role: 'admin',
            beds: {},
            activeExtraBeds: [],
            overrides: {},
            columns: TEST_COLUMNS,
            resetDay,
            confirm,
            warning
        }));

        await act(async () => {
            await result.current.handleClearAll();
        });

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(resetDay).not.toHaveBeenCalled();
        expect(warning).not.toHaveBeenCalled();
    });

    it('warns with fallback message when confirm dialog fails', async () => {
        const warning = vi.fn();
        const confirm = vi.fn().mockRejectedValue(new Error('dialog failure'));
        const resetDay = vi.fn();

        const { result } = renderHook(() => useCensusTableModel({
            currentDateString: getTodayISO(),
            role: 'admin',
            beds: {},
            activeExtraBeds: [],
            overrides: {},
            columns: TEST_COLUMNS,
            resetDay,
            confirm,
            warning
        }));

        await act(async () => {
            await result.current.handleClearAll();
        });

        expect(resetDay).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledWith(
            'No se pudo reiniciar',
            expect.stringContaining('No se pudo confirmar el reinicio del registro')
        );
    });
});
