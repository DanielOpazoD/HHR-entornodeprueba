
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import { useCensusActions } from '@/features/census/components/CensusActionsContext';
import { useDailyRecordData, useDailyRecordActions, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@/features/census/components/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn(),
    useDailyRecordMovements: vi.fn()
}));

describe('TransfersSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();

    const mockTransfers = [
        DataFactory.createMockTransfer({
            id: 't1',
            bedName: 'R2',
            patientName: 'Jane Smith',
            receivingCenter: 'Hospital A',
            transferEscort: 'Nurse X'
        })
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusActions).mockReturnValue({ handleEditTransfer: mockHandleEdit } as any);
        (useDailyRecordActions as any).mockReturnValue({
            undoTransfer: mockOnUndo,
            deleteTransfer: mockOnDelete,
            updateTransfer: vi.fn()
        });
        (useDailyRecordMovements as any).mockReturnValue({
            transfers: []
        });
    });

    it('renders empty message when no transfers', () => {
        (useDailyRecordData as any).mockReturnValue({
            record: { transfers: [] }
        });

        render(<TransfersSection />);
        expect(screen.getByText(/No hay traslados registrados/)).toBeInTheDocument();
    });

    it('renders transfer list and triggers actions', () => {
        (useDailyRecordMovements as any).mockReturnValue({
            transfers: mockTransfers
        });

        render(<TransfersSection />);

        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('R2')).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('Nurse X'))).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        expect(mockOnUndo).toHaveBeenCalledWith('t1');

        fireEvent.click(screen.getByTitle('Editar'));
        expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

        fireEvent.click(screen.getByTitle('Eliminar Registro'));
        expect(mockOnDelete).toHaveBeenCalledWith('t1');
    });

    it('renders "Otro" receiving center and escort logic', () => {
        const customTransfers = [
            DataFactory.createMockTransfer({
                id: 't2',
                receivingCenter: 'Otro',
                receivingCenterOther: 'Custom Clinic',
                transferEscort: 'Medic Y',
                evacuationMethod: 'Ambulancia'
            }),
            DataFactory.createMockTransfer({
                id: 't3',
                receivingCenter: 'Hospital B',
                transferEscort: 'Medic Z',
                evacuationMethod: 'Aerocardal'
            })
        ];
        vi.mocked(useDailyRecordMovements).mockReturnValue({
            transfers: customTransfers,
            discharges: [],
            cma: []
        });

        render(<TransfersSection />);

        expect(screen.getByText('Custom Clinic')).toBeInTheDocument();
        expect(screen.getByText('Hospital B')).toBeInTheDocument();

        // Escort should show for t2 (Ambulancia) but NOT for t3 (Aerocardal)
        expect(screen.getByText(/Acompaña: Medic Y/)).toBeInTheDocument();
        expect(screen.queryByText(/Acompaña: Medic Z/)).not.toBeInTheDocument();
    });

    it('handles time changes', () => {
        const mockUpdate = vi.fn();
        vi.mocked(useDailyRecordActions).mockReturnValue({
            updateTransfer: mockUpdate,
            undoTransfer: vi.fn(),
            deleteTransfer: vi.fn()
        } as any);
        vi.mocked(useDailyRecordMovements).mockReturnValue({
            transfers: mockTransfers,
            discharges: [],
            cma: []
        });

        render(<TransfersSection />);

        const timeInput = screen.getByDisplayValue('12:00'); // Default from DataFactory
        fireEvent.change(timeInput, { target: { value: '14:30' } });

        expect(mockUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({
            time: '14:30'
        }));
    });

    it('returns null if transfers is null', () => {
        vi.mocked(useDailyRecordMovements).mockReturnValue({
            transfers: null as any,
            discharges: [],
            cma: []
        });
        const { container } = render(<TransfersSection />);
        expect(container.firstChild).toBeNull();
    });
});
