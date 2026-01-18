
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/views/census/TransfersSection';
import { useCensusActions } from '@/views/census/CensusActionsContext';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';

vi.mock('@/views/census/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn()
}));

describe('TransfersSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();

    const mockTransfers = [
        {
            id: 't1',
            bedName: 'R2',
            bedType: 'MEDIA',
            patientName: 'Jane Smith',
            rut: '2-2',
            diagnosis: 'Transfer Test',
            evacuationMethod: 'Avión comercial',
            receivingCenter: 'Hospital A',
            transferEscort: 'Nurse X'
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusActions).mockReturnValue({ handleEditTransfer: mockHandleEdit } as any);
        (useDailyRecordActions as any).mockReturnValue({
            undoTransfer: mockOnUndo,
            deleteTransfer: mockOnDelete
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
        (useDailyRecordData as any).mockReturnValue({
            record: { transfers: mockTransfers }
        });

        render(<TransfersSection />);

        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('R2')).toBeInTheDocument();
        expect(screen.getByText('Nurse X')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        expect(mockOnUndo).toHaveBeenCalledWith('t1');

        fireEvent.click(screen.getByTitle('Editar'));
        expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

        fireEvent.click(screen.getByTitle('Eliminar Registro'));
        expect(mockOnDelete).toHaveBeenCalledWith('t1');
    });
});
