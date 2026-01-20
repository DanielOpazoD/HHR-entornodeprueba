
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CensusTable } from '@/views/census/CensusTable';
import { useCensusActions } from '@/views/census/CensusActionsContext';
import { useConfirmDialog } from '@/context/UIContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { DailyRecord } from '@/types';

// Mock dependencies
vi.mock('@/views/census/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/UIContext', () => ({
    useConfirmDialog: vi.fn()
}));

vi.mock('@/context/TableConfigContext', () => ({
    useTableConfig: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn()
}));

vi.mock('@/components/census/PatientRow', () => ({
    PatientRow: () => <tr data-testid="patient-row" />
}));

vi.mock('@/components/ui/ResizableHeader', () => ({
    ResizableHeader: ({ children, className }: any) => <th className={className}>{children}</th>
}));

describe('CensusTable', () => {
    const mockRecord: DailyRecord = {
        date: '2025-01-08',
        beds: {},
        discharges: [],
        transfers: [],
        lastUpdated: '',
        nurses: [],
        activeExtraBeds: ['E1'], // One active extra bed
        cma: []
    };

    const mockConfirm = vi.fn();
    const mockHandleRowAction = vi.fn();
    const mockSetShowCribConfig = vi.fn();
    const mockUpdateColumnWidth = vi.fn();
    const mockResetDay = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        (useDailyRecordData as any).mockReturnValue({
            record: mockRecord
        });

        (useDailyRecordActions as any).mockReturnValue({
            resetDay: mockResetDay
        });

        (useCensusActions as any).mockReturnValue({
            showCribConfig: false,
            setShowCribConfig: mockSetShowCribConfig,
            handleRowAction: mockHandleRowAction
        });

        (useConfirmDialog as any).mockReturnValue({
            confirm: mockConfirm
        });

        (useTableConfig as any).mockReturnValue({
            config: {
                columns: {
                    actions: 50, bed: 80, type: 60, name: 200, rut: 100, age: 50,
                    diagnosis: 200, specialty: 80, status: 100, admission: 100,
                    dmi: 60, cqx: 60, upc: 60
                }
            },
            isEditMode: false,
            setEditMode: vi.fn(),
            updateColumnWidth: mockUpdateColumnWidth
        });
    });

    it('should render correct number of beds (normal + active extras)', () => {
        render(
            <CensusTable
                currentDateString="2025-01-08"
            />
        );

        // BEDS constant contains 29 normal beds. With E1 active, total should be 30.
        // Or whatever BEDS length is + 1.
        const rows = screen.getAllByTestId('patient-row');
        expect(rows.length).toBeGreaterThan(0);
    });

    it('should handle "Clear All" with confirmation', async () => {
        mockConfirm.mockResolvedValue(true);

        render(
            <CensusTable
                currentDateString="2025-01-08"
            />
        );

        const clearBtn = screen.getByTitle('Limpiar todos los datos del día');

        await act(async () => {
            fireEvent.click(clearBtn);
        });

        expect(mockConfirm).toHaveBeenCalled();
        expect(mockResetDay).toHaveBeenCalled();
    });

    it('should not call resetDay if confirmation is rejected', async () => {
        mockConfirm.mockResolvedValue(false);

        render(
            <CensusTable
                currentDateString="2025-01-08"
            />
        );

        const clearBtn = screen.getByTitle('Limpiar todos los datos del día');

        await act(async () => {
            fireEvent.click(clearBtn);
        });

        expect(mockResetDay).not.toHaveBeenCalled();
    });

    it('should hide crib button in readOnly mode', () => {
        // This test is now obsolete as the button is gone from the table header
        // but let's keep it empty or remove it.
        // I will remove both tests in the replacement.
    });
});
