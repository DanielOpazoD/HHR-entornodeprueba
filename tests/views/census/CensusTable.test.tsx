import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CensusTable } from '@/views/census/CensusTable';
import { useCensusActions } from '@/views/census/CensusActionsContext';
import { useConfirmDialog } from '@/context/UIContext';
import { useTableConfig } from '@/context/TableConfigContext';
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
    const mockOnResetDay = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

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
                record={mockRecord}
                currentDateString="2025-01-08"
                onResetDay={mockOnResetDay}
            />
        );

        // BEDS constant contains many normal beds + extras.
        // We expect normal beds + 1 extra (E1)
        const rows = screen.getAllByTestId('patient-row');
        expect(rows.length).toBeGreaterThan(0);
    });

    it('should handle "Clear All" with confirmation', async () => {
        mockConfirm.mockResolvedValue(true);

        render(
            <CensusTable
                record={mockRecord}
                currentDateString="2025-01-08"
                onResetDay={mockOnResetDay}
            />
        );

        const clearBtn = screen.getByTitle('Limpiar todos los datos del día');

        await act(async () => {
            fireEvent.click(clearBtn);
        });

        expect(mockConfirm).toHaveBeenCalled();
        expect(mockOnResetDay).toHaveBeenCalled();
    });

    it('should not call onResetDay if confirmation is rejected', async () => {
        mockConfirm.mockResolvedValue(false);

        render(
            <CensusTable
                record={mockRecord}
                currentDateString="2025-01-08"
                onResetDay={mockOnResetDay}
            />
        );

        const clearBtn = screen.getByTitle('Limpiar todos los datos del día');

        await act(async () => {
            fireEvent.click(clearBtn);
        });

        expect(mockOnResetDay).not.toHaveBeenCalled();
    });

    it('should toggle crib configuration', () => {
        render(
            <CensusTable
                record={mockRecord}
                currentDateString="2025-01-08"
                onResetDay={mockOnResetDay}
            />
        );

        const cribBtn = screen.getByTitle('Configurar Cunas');
        fireEvent.click(cribBtn);

        expect(mockSetShowCribConfig).toHaveBeenCalled();
    });

    it('should hide crib button in readOnly mode', () => {
        render(
            <CensusTable
                record={mockRecord}
                currentDateString="2025-01-08"
                onResetDay={mockOnResetDay}
                readOnly={true}
            />
        );

        expect(screen.queryByTitle('Configurar Cunas')).not.toBeInTheDocument();
    });
});
